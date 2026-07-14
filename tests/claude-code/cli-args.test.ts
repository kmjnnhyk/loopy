import { expect, test } from "bun:test";
import { buildDelegateArgs, type DelegateRequest } from "@loopyjs/claude-code";

const req: DelegateRequest = {
  prompt: '{"a":1}',
  system: "sys",
  model: "sonnet",
  mcpUrl: "http://127.0.0.1:4321/mcp",
  allowedTools: ["mcp__loopy__readFile", "mcp__loopy__writeFile"],
};

test("buildDelegateArgs: 필수 플래그 전부 포함", () => {
  const args = buildDelegateArgs(req);
  expect(args.slice(0, 3)).toEqual(["-p", "--output-format", "json"]);
  const flag = (name: string) => args[args.indexOf(name) + 1];
  expect(flag("--model")).toBe("sonnet");
  expect(flag("--system-prompt")).toBe("sys");
  expect(flag("--allowedTools")).toBe("mcp__loopy__readFile,mcp__loopy__writeFile");
  expect(flag("--permission-mode")).toBe("dontAsk");
  expect(args).toContain("--strict-mcp-config");
  // 빌트인 전부 차단
  const toolsIdx = args.indexOf("--tools");
  expect(toolsIdx).toBeGreaterThan(-1);
  expect(args[toolsIdx + 1]).toBe("");
});

test("buildDelegateArgs: --mcp-config는 inline JSON, http 타입 + url", () => {
  const args = buildDelegateArgs(req);
  const cfg = JSON.parse(args[args.indexOf("--mcp-config") + 1]!);
  expect(cfg).toEqual({ mcpServers: { loopy: { type: "http", url: "http://127.0.0.1:4321/mcp" } } });
});

test("buildDelegateArgs: maxTurns는 있을 때만", () => {
  expect(buildDelegateArgs(req)).not.toContain("--max-turns");
  const args = buildDelegateArgs({ ...req, maxTurns: 5 });
  expect(args[args.indexOf("--max-turns") + 1]).toBe("5");
});
