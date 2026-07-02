import { describe, expect, test } from "bun:test";
import { EventSession, Memo, makeCtx, Suspend, isSuspend, ReplayDivergence } from "../../src/runtime/effects";
import { memoryStore } from "../../src/runtime/store";
import { threadId, runId } from "../../src/runtime/events";
import { stubModel } from "../../src/runtime/model";

const T = threadId("t"), R = runId("r");

function fresh(scope = "n#1") {
  const store = memoryStore();
  const session = new EventSession(store, T, R, 0);
  const ctx = makeCtx({ scope, session, memo: Memo.fromEvents([]), deps: { repo: "REPO" } });
  return { store, session, ctx };
}
async function replayCtx(store: ReturnType<typeof memoryStore>, scope = "n#1") {
  const events = await store.readLog(T);
  const session = new EventSession(store, T, R, events.length ? events[events.length - 1]!.seq + 1 : 0);
  return { ctx: makeCtx({ scope, session, memo: Memo.fromEvents(events), deps: { repo: "REPO" } }), events };
}
const echoTool = {
  name: "echo",
  "~depKeys": ["repo"] as const,
  run: async (i: { x: number }, c: { deps: Record<string, unknown> }) => ({ x: i.x, dep: c.deps.repo }),
};

describe("callTool", () => {
  test("fresh: writes pair, returns value, slices deps", async () => {
    const { store, ctx } = fresh();
    const out = await ctx.callTool(echoTool as never, { x: 1 });
    expect(out).toEqual({ x: 1, dep: "REPO" });
    const types = (await store.readLog(T)).map((e) => e.type);
    expect(types).toEqual(["ToolCalled", "ToolReturned"]);
  });
  test("replay: memo hit → no run, no new events", async () => {
    const { store, ctx } = fresh();
    await ctx.callTool(echoTool as never, { x: 1 });
    const before = (await store.readLog(T)).length;
    let ran = false;
    const spy = { ...echoTool, run: async () => ((ran = true), { x: 0, dep: "" }) };
    const { ctx: rctx } = await replayCtx(store);
    const out = await rctx.callTool(spy as never, { x: 1 });
    expect(out).toEqual({ x: 1, dep: "REPO" });
    expect(ran).toBe(false);
    expect((await store.readLog(T)).length).toBe(before);
  });
  test("replay with changed args → ReplayDivergence", async () => {
    const { store, ctx } = fresh();
    await ctx.callTool(echoTool as never, { x: 1 });
    const { ctx: rctx } = await replayCtx(store);
    await expect(rctx.callTool(echoTool as never, { x: 2 })).rejects.toThrow(ReplayDivergence);
  });
  test("tool error: recorded ok:false + rethrown; replay rethrows without running", async () => {
    const { store, ctx } = fresh();
    const bad = { name: "bad", run: async () => { throw new RangeError("kaput"); } };
    await expect(ctx.callTool(bad as never, {})).rejects.toThrow("kaput");
    let ran = false;
    const spy = { name: "bad", run: async () => ((ran = true), null) };
    const { ctx: rctx } = await replayCtx(store);
    await expect(rctx.callTool(spy as never, {})).rejects.toThrow("kaput");
    expect(ran).toBe(false);
  });
  test("Promise.all: ordinals follow source order", async () => {
    const { store, ctx } = fresh();
    const slow = { name: "slow", run: async () => { await new Promise((r) => setTimeout(r, 20)); return "s"; } };
    const fastT = { name: "fast", run: async () => "f" };
    await Promise.all([ctx.callTool(slow as never, {}), ctx.callTool(fastT as never, {})]);
    const calls = (await store.readLog(T)).filter((e) => e.type === "ToolCalled") as Array<{ posKey: string; tool: string }>;
    expect(calls.map((c) => c.posKey)).toEqual(["n#1|0|tool:slow", "n#1|1|tool:fast"]);
  });
});

describe("interrupt", () => {
  test("fresh: InterruptRaised appended then Suspend thrown", async () => {
    const { store, ctx } = fresh();
    try {
      await ctx.interrupt({ ask: "ok?" });
      throw new Error("unreachable");
    } catch (e) {
      expect(isSuspend(e)).toBe(true);
      expect((e as Suspend).resumeKey).toBe("n#1|0|interrupt");
    }
    expect((await store.readLog(T)).map((e) => e.type)).toEqual(["InterruptRaised"]);
  });
  test("with Resumed in memo: returns resume value, no Suspend", async () => {
    const { store, ctx } = fresh();
    await ctx.interrupt({ ask: "ok?" }).catch(() => {});
    const session2 = new EventSession(store, T, R, 1);
    await session2.write({ type: "Resumed", resumeKey: "n#1|0|interrupt", value: { approved: true }, node: "" });
    const { ctx: rctx } = await replayCtx(store);
    expect(await rctx.interrupt({ ask: "ok?" })).toEqual({ approved: true });
  });
});

describe("callModel / now / random", () => {
  test("model call recorded and replayed with 0 client calls", async () => {
    const { store, ctx } = fresh();
    const m = stubModel([{ text: "hi", stopReason: "end_turn" }]);
    const req = { model: "stub", messages: [{ role: "user" as const, content: "q" }] };
    expect((await ctx.callModel(m, req)).text).toBe("hi");
    const { ctx: rctx } = await replayCtx(store);
    expect((await rctx.callModel(m, req)).text).toBe("hi");
    expect(m.calls.length).toBe(1); // replay did NOT hit the client
  });
  test("now/random replay recorded values", async () => {
    const { store, ctx } = fresh();
    const n = ctx.now(), r = ctx.random();
    await new Promise((res) => setTimeout(res, 5)); // let writes flush
    const { ctx: rctx } = await replayCtx(store);
    expect(rctx.now()).toBe(n);
    expect(rctx.random()).toBe(r);
  });
});
