import { expect, test } from "bun:test";
import { EventSession, Memo, makeCtx, ReplayDivergence } from "../../src/runtime/effects";
import { memoryStore } from "../../src/runtime/store";
import { runId, threadId, type Event } from "../../src/runtime/events";
import type { ModelClient, ModelRequest, ModelResponse } from "../../src/runtime/model";

const neverModel: ModelClient = {
  complete(): Promise<ModelResponse> {
    throw new Error("model must not be called in replay mode");
  },
};

function ctxWith(events: readonly Event[], replay: boolean) {
  const store = memoryStore();
  const session = new EventSession(store, threadId("t"), runId("t#run"), events.length);
  return makeCtx({ scope: "n#1", session, memo: Memo.fromEvents(events), deps: {}, replay });
}

test("replay mode: memo miss on a model effect → ReplayDivergence (never calls the model)", async () => {
  const ctx = ctxWith([], /* replay */ true); // empty memo → guaranteed miss
  const req: ModelRequest = { model: "m", messages: [{ role: "user", content: "hi" }] };
  await expect(ctx.callModel(neverModel, req)).rejects.toBeInstanceOf(ReplayDivergence);
});

test("replay mode: memo miss on a tool effect → ReplayDivergence (never runs the tool)", async () => {
  const ctx = ctxWith([], true);
  const tool = { name: "t", run: async () => { throw new Error("tool must not run in replay"); } };
  await expect(ctx.callTool(tool as never, { a: 1 })).rejects.toBeInstanceOf(ReplayDivergence);
});

test("replay mode: interrupt with no recorded Resumed → ReplayDivergence (does not suspend)", async () => {
  const ctx = ctxWith([], true);
  await expect(ctx.interrupt({ ask: "x" })).rejects.toBeInstanceOf(ReplayDivergence);
});

test("replay mode: memo miss on sleep → ReplayDivergence (async reject)", async () => {
  const ctx = ctxWith([], true);
  await expect(ctx.sleep(1)).rejects.toBeInstanceOf(ReplayDivergence);
});

test("replay mode: memo miss on now() → ReplayDivergence (sync throw)", () => {
  const ctx = ctxWith([], true);
  expect(() => ctx.now()).toThrow(ReplayDivergence);
});

test("replay mode: memo miss on random() → ReplayDivergence (sync throw)", () => {
  const ctx = ctxWith([], true);
  expect(() => ctx.random()).toThrow(ReplayDivergence);
});

test("normal mode is unchanged: memo miss re-issues the effect for real", async () => {
  const ctx = ctxWith([], /* replay */ false);
  const model: ModelClient = { async complete() { return { text: "ok", stopReason: "end_turn" }; } };
  const res = await ctx.callModel(model, { model: "m", messages: [] });
  expect(res.text).toBe("ok"); // real issue path still works
});
