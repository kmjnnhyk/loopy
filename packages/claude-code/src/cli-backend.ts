// claudeCliBackend() — model B's default DelegateBackend: one whole agent-node
// delegation = one `claude -p` run wired to the in-process MCP bridge.
// ⚠️ Flag contract (mcpServers shape / --tools "" / --allowedTools naming /
//    --permission-mode) is verified live by scripts/delegate-smoke.ts (Task 4).
//    Any CLI-drift fix lands HERE (+ cli-args.test.ts) only.
import { runClaude, type ClaudeCliResult, type ClaudeCodeOpts } from "./spawn.ts";

export interface DelegateRequest {
  readonly prompt: string;
  readonly system: string;
  /** `--model` value: alias ("opus"|"sonnet"|…) or full ID — NOT a loopy registry key. */
  readonly model: string;
  readonly mcpUrl: string;
  /** fully-qualified MCP tool names (mcp__loopy__<tool>) — explicit list, no wildcard. */
  readonly allowedTools: readonly string[];
  readonly maxTurns?: number;
}

export interface DelegateBackend {
  /** resolves to the FINAL assistant text (to be parsed against the output schema). */
  run(req: DelegateRequest): Promise<string>;
}

export function buildDelegateArgs(req: DelegateRequest): string[] {
  const mcpConfig = JSON.stringify({ mcpServers: { loopy: { type: "http", url: req.mcpUrl } } });
  return [
    "-p",
    "--output-format", "json",
    "--model", req.model,
    "--system-prompt", req.system,
    "--mcp-config", mcpConfig,
    "--strict-mcp-config",             // 우리 서버만 — 사용자 .mcp.json 무시
    "--tools", "",                     // 빌트인(Read/Bash/…) 전부 차단
    "--allowedTools", req.allowedTools.join(","),
    "--permission-mode", "dontAsk", // unattended: auto-deny anything not in --allowedTools (defense-in-depth over --tools "")
    ...(req.maxTurns !== undefined ? ["--max-turns", String(req.maxTurns)] : []),
  ];
}

export function claudeCliBackend(opts: ClaudeCodeOpts = {}): DelegateBackend {
  return {
    async run(req: DelegateRequest): Promise<string> {
      const stdout = await runClaude(req.prompt, buildDelegateArgs(req), opts);
      const raw = JSON.parse(stdout) as ClaudeCliResult;
      if (raw.is_error) throw new Error(`claude -p (delegate) returned error: ${raw.result}`);
      return raw.result;
    },
  };
}
