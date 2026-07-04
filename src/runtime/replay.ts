import { Memo, EventSession, ReplayDivergence } from "./effects";
import { runGraph, type Driver, type KernelCtx } from "./scheduler";
import { memoryStore } from "./store";
import { digest, runId as mkRunId, stableStringify, threadId as mkThreadId, type Event } from "./events";
import type { ModelClient, ModelResponse } from "./model";

export interface ReplayDivergenceInfo {
  readonly kind: "effect" | "output";
  readonly pos: string;
  readonly expected: string;
  readonly actual: string;
}
export interface ReplayResult {
  readonly output: unknown;
  readonly divergence: ReplayDivergenceInfo | null;
}

/** Any model alias resolves to this; it is never actually called (memo short-circuits
 *  before io()). If replay ever does call a model, it fails loud — proof of hermeticity. */
const neverModel: ModelClient = {
  complete(): Promise<ModelResponse> {
    throw new Error("replay: a model was called — golden log incomplete or effect not memoized");
  },
};
const neverModels = new Proxy({} as Record<string, ModelClient>, { get: () => neverModel });

/**
 * Test replay = a FRESH graph walk (re-executes routers/reads/returns/channel-folds/
 * agent-loops from the start) with the golden log injected as the memo, so every effect
 * replays from the recording. `replay: true` makes a memo miss a divergence. A throwaway
 * store + neverModels make it hermetic (0 network, 0 tool/dep I/O).
 */
export async function replayThread(o: {
  driver: Driver;
  goldenEvents: readonly Event[];
  entry: string;
  input: unknown;
}): Promise<ReplayResult> {
  const last = o.goldenEvents[o.goldenEvents.length - 1];
  if (!last || last.type !== "RunEnded") {
    throw new Error("replayThread: golden log is not a completed run (no trailing RunEnded)");
  }
  const goldenOutput = last.output;

  const store = memoryStore(); // throwaway — replay's own writes are never read back
  const tid = mkThreadId("__replay__");
  const session = new EventSession(store, tid, mkRunId("__replay__#run"), 0);
  await session.write({ type: "RunStarted", entry: o.entry, input: o.input, node: "" });

  const k: KernelCtx = {
    session,
    memo: Memo.fromEvents(o.goldenEvents),
    loadedEvents: [], // empty → runGraph seeds and walks from the start (re-executes user code)
    deps: {}, // hermetic: workflow node bodies are memoized as single tool effects; never run here
    models: neverModels,
    replay: true,
  };

  try {
    const output = await runGraph(o.driver, "", k, o.input);
    if (stableStringify(output) !== stableStringify(goldenOutput)) {
      return {
        output,
        divergence: { kind: "output", pos: "<run-output>", expected: digest(goldenOutput), actual: digest(output) },
      };
    }
    return { output, divergence: null };
  } catch (err) {
    if (err instanceof ReplayDivergence) {
      return { output: undefined, divergence: { kind: "effect", pos: err.pos, expected: err.expected, actual: err.actual } };
    }
    throw err; // genuine infra/domain error — fail loud
  }
}
