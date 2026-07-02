import { describe, expect, test } from "bun:test";
import { END } from "loopy";
import { runThread, RunSuspended, type Driver, type RunnableNode } from "../../src/runtime/scheduler";
import { rawChannel } from "../../src/runtime/channels";
import { memoryStore } from "../../src/runtime/store";
import { threadId } from "../../src/runtime/events";
import { makeCtx, type RuntimeCtx } from "../../src/runtime/effects";

// toy 2-node driver: a(tool 실행) → b(interrupt) → END
function toyDriver(counters: { aTool: number }): Driver {
  const doubler = { name: "doubler", run: async (i: { n: number }) => ((counters.aTool++), { n: i.n * 2 }) };
  const nodes: Record<string, RunnableNode> = {
    a: {
      reads: (s) => ({ n: (s.input as { n: number }).n }),
      run: async (input, ctx) => ctx.callTool(doubler as never, input),
    },
    b: {
      reads: (s) => s.a,
      run: async (input, ctx) => {
        const ok = await ctx.interrupt<{ approved: boolean }>({ ask: "ok?", input });
        return { done: ok.approved };
      },
    },
  };
  return {
    channels: { input: rawChannel(), a: rawChannel(), b: rawChannel() },
    seed: (input) => ({ input }),
    next: (_s, last) => (last === null ? "a" : last === "a" ? "b" : END),
    onSelected: () => null,
    node: (name) => nodes[name]!,
    updatesFor: (name, output) => ({ [name]: output }),
    output: (s) => s.b,
    guard: () => {},
  };
}

describe("runThread", () => {
  test("fresh → suspends at b with RunSuspended; snapshot pending recorded", async () => {
    const store = memoryStore();
    const c = { aTool: 0 };
    await expect(
      runThread({ driver: toyDriver(c), store, threadId: "t1", entry: "toy", input: { n: 3 } }),
    ).rejects.toThrow(RunSuspended);
    expect(c.aTool).toBe(1);
    const snap = (await store.load(threadId("t1")))?.snapshot;
    expect(snap?.status).toBe("suspended");
    expect(snap?.pending?.resumeKey).toContain("b#1");
  });

  test("resume: prior effects replay (tool not re-run), completes with output", async () => {
    const store = memoryStore();
    const c = { aTool: 0 };
    await runThread({ driver: toyDriver(c), store, threadId: "t1", entry: "toy", input: { n: 3 } }).catch((e) => {
      if (!(e instanceof RunSuspended)) throw e;
    });
    const out = await runThread({
      driver: toyDriver(c), store, threadId: "t1", entry: "toy", resume: { value: { approved: true } },
    });
    expect(out).toEqual({ done: true });
    expect(c.aTool).toBe(1); // ← replay: doubler NOT re-executed
    const types = (await store.readLog(threadId("t1"))).map((e) => e.type);
    expect(types[0]).toBe("RunStarted");
    expect(types[types.length - 1]).toBe("RunEnded");
    expect(types.filter((t) => t === "ToolCalled").length).toBe(1);
  });

  test("event shape: seed patch, epoch-scoped steps", async () => {
    const store = memoryStore();
    await runThread({ driver: toyDriver({ aTool: 0 }), store, threadId: "t2", entry: "toy", input: { n: 1 } }).catch(() => {});
    const log = await store.readLog(threadId("t2"));
    expect(log.map((e) => `${e.type}@${e.node}`).slice(0, 6)).toEqual([
      "RunStarted@", "StatePatched@", "StepStarted@a#1", "ToolCalled@a#1", "ToolReturned@a#1", "StatePatched@",
    ]);
  });

  test("re-run of live thread rejected; resume of non-suspended rejected", async () => {
    const store = memoryStore();
    const d = toyDriver({ aTool: 0 });
    await runThread({ driver: d, store, threadId: "t3", entry: "toy", input: { n: 1 } }).catch(() => {});
    await expect(runThread({ driver: d, store, threadId: "t3", entry: "toy", input: { n: 1 } })).rejects.toThrow("already exists");
    await expect(
      runThread({ driver: d, store, threadId: "t-none", entry: "toy", resume: { value: 1 } }),
    ).rejects.toThrow("not suspended");
  });

  test("cycle revisit gets a new epoch (separate memo)", async () => {
    const store = memoryStore();
    const c = { aTool: 0 };
    const d = toyDriver(c);
    // a를 두 번 돌게: a → a → END
    d.next = (_s, last) => (last === null ? "a" : c.aTool < 2 ? "a" : END);
    d.output = (s) => s.a;
    await runThread({ driver: d, store, threadId: "t4", entry: "toy", input: { n: 2 } });
    expect(c.aTool).toBe(2); // epoch a#1, a#2 — memo 충돌 없이 각각 실행
    const starts = (await store.readLog(threadId("t4"))).filter((e) => e.type === "StepStarted").map((e) => e.node);
    expect(starts).toEqual(["a#1", "a#2"]);
  });

  test("node throw → RunErrored appended + rethrow", async () => {
    const store = memoryStore();
    const d = toyDriver({ aTool: 0 });
    const boom: RunnableNode = { reads: () => null, run: async () => { throw new RangeError("nope"); } };
    d.node = () => boom;
    await expect(runThread({ driver: d, store, threadId: "t5", entry: "toy", input: { n: 1 } })).rejects.toThrow("nope");
    const log = await store.readLog(threadId("t5"));
    expect(log[log.length - 1]!.type).toBe("RunErrored");
    expect((await store.load(threadId("t5")))?.snapshot?.status).toBe("error");
  });
});
