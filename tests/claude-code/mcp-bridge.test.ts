import { expect, test } from "bun:test";
import { io, tool } from "@loopyjs/core";
import { startToolBridge } from "@loopyjs/claude-code";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readFile } from "../../examples/tools";
import type { GitRepo } from "../../examples/deps";

const repo: GitRepo = {
  read: async (p) => `content-of-${p}`,
  write: async () => {},
  find: async () => [],
};

const boom = tool({
  name: "boom", description: "always throws",
  input: io<{ x: number }>(), output: io<{ never: true }>(),
  run: async () => { throw new Error("kaboom"); },
});

async function connect(url: string): Promise<Client> {
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}

test("bridge: tools/list가 이름+설명 노출, tools/call이 loopy 프로세스에서 dep로 실행", async () => {
  const bridge = await startToolBridge([readFile, boom], { repo });
  try {
    const client = await connect(bridge.url);
    const list = await client.listTools();
    expect(list.tools.map((t) => t.name).sort()).toEqual(["boom", "readFile"]);
    expect(list.tools.find((t) => t.name === "readFile")!.description).toBe("Read a file's contents.");

    const r = await client.callTool({ name: "readFile", arguments: { path: "src/a.ts" } });
    const text = (r.content as readonly { type: string; text: string }[])[0]!.text;
    expect(JSON.parse(text)).toEqual({ content: "content-of-src/a.ts" }); // ← repo dep이 진짜 주입됨
    await client.close();
  } finally {
    await bridge.close();
  }
});

test("bridge: 도메인 에러는 isError content로 피드백 (서버 생존)", async () => {
  const bridge = await startToolBridge([boom], {});
  try {
    const client = await connect(bridge.url);
    const r = await client.callTool({ name: "boom", arguments: { x: 1 } });
    expect(r.isError).toBe(true);
    const text = (r.content as readonly { text: string }[])[0]!.text;
    expect(text).toContain("ERROR boom: kaboom");
    // 서버가 죽지 않았음 — 후속 호출 가능
    const list = await client.listTools();
    expect(list.tools.length).toBe(1);
    await client.close();
  } finally {
    await bridge.close();
  }
});

test("bridge: 미등록 툴 → isError", async () => {
  const bridge = await startToolBridge([], {});
  try {
    const client = await connect(bridge.url);
    const r = await client.callTool({ name: "nope", arguments: {} });
    expect(r.isError).toBe(true);
    await client.close();
  } finally {
    await bridge.close();
  }
});

test("bridge: 중복 tool 이름은 런타임에 throw (public entry 가드)", async () => {
  const first = tool({
    name: "dup", description: "first",
    input: io<{ x: number }>(), output: io<{ ok: true }>(),
    run: async () => ({ ok: true as const }),
  });
  const second = tool({
    name: "dup", description: "second",
    input: io<{ y: number }>(), output: io<{ ok: true }>(),
    run: async () => ({ ok: true as const }),
  });
  await expect(startToolBridge([first, second], {})).rejects.toThrow('duplicate tool name "dup"');
});
