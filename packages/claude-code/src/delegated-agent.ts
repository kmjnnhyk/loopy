// delegatedAgent() — model B: hand a WHOLE tool-using agent node to Claude Code
// (`claude -p`, subscription auth). loopy records the node as ONE effect
// ({input → final parsed output}); the inner Claude Code turns are a black box,
// but every tool the delegate calls executes IN THIS PROCESS via the MCP bridge,
// against loopy's real deps.
//
// Replay: the single ctx.callTool effect memoizes — on replay the recorded
// output is fed back and NOTHING here runs (no spawn, no bridge, no tools).
//
// ⚠️ ToS: personal subscription = local dev / dogfooding / internal tooling only.
import {
  agent, END, lastChannel,
  type Agent, type AnyStep, type IO, type LoopyDeps,
  type NoDuplicateTools, type ToolDepKeys,
} from "@loopyjs/core";
import {
  parseStructured, rawChannel, stableStringify,
  type Driver, type RunnableNode, type RuntimeCtx, type ToolLike,
} from "@loopyjs/core/internal";
import { claudeCliBackend, type DelegateBackend } from "./cli-backend.ts";
import { startToolBridge } from "./mcp-bridge.ts";

export interface ClaudeDelegateOpts {
  /** CLI binary; override if `claude` isn't on PATH. */
  readonly bin?: string;
  /** Strip ANTHROPIC_API_KEY from the child env so the subscription login wins. Default true. */
  readonly forceSubscription?: boolean;
  /** hard cap on the delegate's internal turns (`--max-turns`). */
  readonly maxTurns?: number;
  /** test seam — replaces the `claude -p` subprocess entirely. */
  readonly backend?: DelegateBackend;
}

export interface DelegatedAgent<
  Name extends string,
  In extends IO<any, any>,
  Out extends IO<any, any>,
  Deps extends keyof LoopyDeps,
  Tools extends readonly AnyStep[],
> extends Agent<Name, In, Out, Deps, Tools, never> {
  readonly "~driverFactory": () => Driver;
}

/** agentDriver.renderSystem과 같은 문구 — output shape 자체는 instructions에 적어야 한다
 *  (모델 A e2e와 동일한 주의점). */
function renderDelegateSystem(instructions: string): string {
  return `${instructions}\n\nWhen you are done, respond with a single JSON object as the final answer.`;
}

interface DelegateRt {
  readonly name: string;
  readonly model: string;
  readonly instructions: string;
  readonly output: IO<any, any>;
  readonly tools: readonly AnyStep[];
  readonly "~depKeys"?: readonly string[];
}

function delegationDriver(a: DelegateRt, opts: ClaudeDelegateOpts): Driver {
  const backend: DelegateBackend =
    opts.backend ?? claudeCliBackend({ bin: opts.bin, forceSubscription: opts.forceSubscription });

  // callTool이 이 키들로 kernel deps를 슬라이스해 tool ctx에 준다 — sub-tool 전체의 합집합.
  const depKeys: readonly string[] = [
    ...new Set([...(a["~depKeys"] ?? []), ...a.tools.flatMap((t) => t["~depKeys"] ?? [])]),
  ];

  const delegationTool: ToolLike = {
    name: `delegate:${a.name}`,
    "~depKeys": depKeys,
    run: (async (input: unknown, tctx: { deps: Record<string, unknown> }): Promise<unknown> => {
      const bridge = await startToolBridge(a.tools, tctx.deps);
      try {
        const text = await backend.run({
          prompt: stableStringify(input),
          system: renderDelegateSystem(a.instructions),
          model: a.model,
          mcpUrl: bridge.url,
          allowedTools: a.tools.map((t) => `mcp__loopy__${t.name}`),
          maxTurns: opts.maxTurns,
        });
        return parseStructured(a.output, text);
      } finally {
        await bridge.close();
      }
    }) as ToolLike["run"],
  };

  const run: RunnableNode = {
    reads: (s) => s.input,
    run: (input: unknown, ctx: RuntimeCtx) => ctx.callTool(delegationTool, input),
  };

  return {
    channels: {
      input: rawChannel<unknown>(),
      output: rawChannel<unknown>(),
      phase: lastChannel<"run" | "done">("run"),
    },
    seed: (input) => ({ input }),
    next: (s) => (s.phase === "done" ? END : "run"),
    onSelected: () => null,
    node: () => run,
    updatesFor: (_name, output) => ({ output, phase: "done" }),
    output: (s) => ({ output: s.output }), // agent envelope 규약 — unwrapEntryOutput이 .output을 벗김
    guard: () => {},
  };
}

export function delegatedAgent<
  const Name extends string,
  In extends IO<any, any>,
  Out extends IO<any, any>,
  const Tools extends readonly AnyStep[] = [],
  const D extends readonly (keyof LoopyDeps)[] = [],
>(def: {
  name: Name;
  /** claude CLI `--model` value (alias or full ID) — NOT a loopy models-registry key. */
  model: string;
  instructions: string;
  input: In;
  output: Out;
  tools?: Tools & NoDuplicateTools<Tools>;
  deps?: D;
  claude?: ClaudeDelegateOpts;
}): DelegatedAgent<Name, In, Out, D[number] | ToolDepKeys<Tools>, Tools> {
  for (const t of (def.tools ?? []) as readonly AnyStep[]) {
    if ((t as { "~kind"?: string })["~kind"] !== "tool") {
      throw new Error(
        `delegatedAgent "${def.name}": tool "${t.name}" is not a plain tool — sub-agents inside a delegated agent are unsupported (v1)`,
      );
    }
  }
  const base = agent({
    name: def.name, model: def.model, instructions: def.instructions,
    input: def.input, output: def.output, tools: def.tools, deps: def.deps,
  });
  const rt: DelegateRt = {
    name: def.name, model: def.model, instructions: def.instructions,
    output: def.output, tools: base.tools as readonly AnyStep[], "~depKeys": base["~depKeys"],
  };
  return {
    ...base,
    "~driverFactory": (): Driver => delegationDriver(rt, def.claude ?? {}),
  } as DelegatedAgent<Name, In, Out, D[number] | ToolDepKeys<Tools>, Tools>;
}
