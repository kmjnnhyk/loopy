import { expect, test } from "bun:test";
import { agent, defineLoopy, io } from "@loopyjs/core";
import { delegatedAgent, type DelegateBackend } from "@loopyjs/claude-code";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readFile } from "../../examples/tools";
import type { GitRepo } from "../../examples/deps";

const repo: GitRepo = { read: async (p) => `content-of-${p}`, write: async () => {}, find: async () => [] };

test("통합: fake-claude가 MCP로 loopy tool 호출 → 실행은 loopy 프로세스, 최종 output은 스키마 파싱", async () => {
  const backend: DelegateBackend = {
    async run(req) {
      // delegatedAgent가 조립한 요청 계약 검증
      expect(req.system).toContain("Read the file and summarize.");
      expect(req.system).toContain("single JSON object");            // JSON directive 자동 append
      expect(req.model).toBe("sonnet");
      expect(req.allowedTools).toEqual(["mcp__loopy__readFile"]);
      expect(JSON.parse(req.prompt)).toEqual({ path: "src/a.ts" }); // input → stableStringify → prompt

      // "가짜 claude": 진짜 MCP 클라이언트로 브리지에 접속해 tool을 부른다
      const client = new Client({ name: "fake-claude", version: "0" });
      await client.connect(new StreamableHTTPClientTransport(new URL(req.mcpUrl)));
      const r = await client.callTool({ name: "readFile", arguments: JSON.parse(req.prompt) });
      await client.close();
      const text = (r.content as readonly { text: string }[])[0]!.text;
      return JSON.stringify({ summary: `saw ${text}` });
    },
  };
  const summarizer = delegatedAgent({
    name: "summarizer", model: "sonnet",
    instructions: "Read the file and summarize.",
    input: io<{ path: string }>(), output: io<{ summary: string }>(),
    tools: [readFile],
    claude: { backend },
  });
  const rt = defineLoopy({ agents: { summarizer }, workflows: {}, deps: { repo } });
  const out = await rt.run("summarizer", { path: "src/a.ts" });
  expect(out).toEqual({ summary: 'saw {"content":"content-of-src/a.ts"}' }); // repo dep 실주입 증명
});

test("backend 에러 → run이 reject (effect 실패로 기록될 경로)", async () => {
  const boom: DelegateBackend = { run: async () => { throw new Error("claude exited 1"); } };
  const d = delegatedAgent({
    name: "d1", model: "sonnet", instructions: "x",
    input: io<{ q: number }>(), output: io<{ ok: boolean }>(), claude: { backend: boom },
  });
  const rt = defineLoopy({ agents: { d1: d }, workflows: {}, deps: {} });
  await expect(rt.run("d1", { q: 1 })).rejects.toThrow("claude exited 1");
});

test("최종 텍스트가 JSON이 아니면 ParseError로 fail loud (v1: 재시도 없음)", async () => {
  const chatty: DelegateBackend = { run: async () => "I could not produce JSON, sorry!" };
  const d = delegatedAgent({
    name: "d2", model: "sonnet", instructions: "x",
    input: io<{ q: number }>(), output: io<{ ok: boolean }>(), claude: { backend: chatty },
  });
  const rt = defineLoopy({ agents: { d2: d }, workflows: {}, deps: {} });
  await expect(rt.run("d2", { q: 1 })).rejects.toThrow(/no balanced JSON/);
});

test("tools에 sub-agent가 들어오면 authoring 시점에 거부 (v1)", () => {
  const sub = agent({ name: "sub", model: "m", instructions: "", input: io<{ a: 1 }>(), output: io<{ b: 1 }>() });
  expect(() =>
    delegatedAgent({
      name: "bad", model: "sonnet", instructions: "",
      input: io<{ q: 1 }>(), output: io<{ r: 1 }>(),
      tools: [sub],
    }),
  ).toThrow(/sub-agents inside a delegated agent are unsupported/);
});
