// ─────────────────────────────────────────────────────────────────────────────
// claudeCode() — a ModelClient backed by the Claude Code CLI in headless mode
// (`claude -p`), authenticated by the user's Pro/Max SUBSCRIPTION instead of an
// external ANTHROPIC_API_KEY.
//
// `claude -p` is constrained to a SINGLE tool-less turn, so it behaves like a
// plain text completion. loopy still owns the reducer graph, the tool loop, and
// replay — this client only fills the `complete()` contract, exactly like the
// @loopyjs/anthropic client does.
//
// ⚠️ Scope: because tools are disabled here, `complete()` never returns
//    `toolCalls`. Attach this model ONLY to tool-less nodes (classifiers,
//    judges, extractors…). A tool-using agent pointed at it stalls the loop.
//
// ⚠️ ToS: a personal subscription is fine for local dev / dogfooding / internal
//    tooling. Backing a service you offer to others violates Anthropic's
//    consumer terms — use org API keys there.
// ─────────────────────────────────────────────────────────────────────────────
import type { ModelClient, ModelMsg, ModelRequest, ModelResponse } from "@loopyjs/core";
import { runClaude, type ClaudeCliResult, type ClaudeCodeOpts } from "./spawn.ts";

// Model A takes a single prompt, so a multi-turn history is flattened with role
// labels. For the tool-less nodes this client is meant for, `messages` is
// usually just one user turn — the assistant/tool branches are defensive.
function flattenPrompt(msgs: readonly ModelMsg[]): string {
  return msgs
    .map((m) => {
      if (m.role === "user") return m.content;
      if (m.role === "assistant") return `[assistant]\n${m.content}`;
      return `[tool result]\n${m.content}`;
    })
    .join("\n\n");
}

/**
 * @param cliModel  the `--model` value passed to the CLI: an alias ("opus" |
 *                  "sonnet" | "fable" | "haiku") or a full ID. This is separate
 *                  from `req.model`, which is loopy's registry key used to route
 *                  to this client — same split as anthropic(modelId, …).
 */
export function claudeCode(cliModel: string, opts: ClaudeCodeOpts = {}): ModelClient {
  return {
    async complete(req: ModelRequest): Promise<ModelResponse> {
      const args: string[] = [
        "-p",
        "--output-format",
        "json",
        "--model",
        cliModel,
        // Replace (not append) the system prompt so Claude Code's own coding-
        // oriented system prompt doesn't leak into a plain completion.
        ...(req.system ? ["--system-prompt", req.system] : []),
        // Disable all tools so it's one turn, no agentic loop.
        // req.tools is intentionally ignored: this model never runs tools.
        "--allowedTools",
        "",
      ];
      const stdout = await runClaude(flattenPrompt(req.messages), args, opts);
      const raw = JSON.parse(stdout) as ClaudeCliResult;
      if (raw.is_error) throw new Error(`claude -p returned error: ${raw.result}`);
      return {
        text: raw.result || undefined,
        stopReason: raw.stop_reason ?? "end_turn",
        usage: raw.usage
          ? { inputTokens: raw.usage.input_tokens, outputTokens: raw.usage.output_tokens }
          : undefined,
      };
    },
  };
}

export type { ClaudeCodeOpts } from "./spawn.ts";

export { buildDelegateArgs, claudeCliBackend } from "./cli-backend.ts";
export type { DelegateBackend, DelegateRequest } from "./cli-backend.ts";

export { startToolBridge } from "./mcp-bridge.ts";
export type { ToolBridge } from "./mcp-bridge.ts";

export { delegatedAgent } from "./delegated-agent.ts";
export type { ClaudeDelegateOpts, DelegatedAgent } from "./delegated-agent.ts";
