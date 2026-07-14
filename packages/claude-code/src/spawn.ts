// Shared `claude -p` subprocess plumbing — used by BOTH model A (claudeCode())
// and model B (claudeCliBackend()). Moved verbatim from index.ts; behavior-identical.
import { spawn } from "node:child_process";

// The subset of `claude -p --output-format json` we consume. The CLI emits more
// fields (session_id, total_cost_usd, modelUsage, num_turns, …) — we only read
// what maps onto ModelResponse.
export interface ClaudeCliResult {
  readonly result: string;
  readonly stop_reason?: string;
  readonly is_error?: boolean;
  readonly usage?: { readonly input_tokens: number; readonly output_tokens: number };
}

export interface ClaudeCodeOpts {
  /** CLI binary; override if `claude` isn't on PATH. */
  readonly bin?: string;
  /** Strip ANTHROPIC_API_KEY from the child env so the subscription login wins. Default true. */
  readonly forceSubscription?: boolean;
}

export function runClaude(prompt: string, args: readonly string[], opts: ClaudeCodeOpts): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (opts.forceSubscription ?? true) delete env.ANTHROPIC_API_KEY;
    const child = spawn(opts.bin ?? "claude", [...args], { env });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`claude exited ${code}: ${err}`))));
    // Prompt via stdin (not argv) — avoids ARG_MAX limits on long histories.
    child.stdin.write(prompt);
    child.stdin.end();
  });
}
