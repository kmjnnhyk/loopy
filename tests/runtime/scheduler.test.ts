import { describe, expect, test } from "bun:test";
import { END } from "loopy";
import { runThread, RunSuspended, type Driver, type RunnableNode } from "../../src/runtime/scheduler";
import { rawChannel } from "../../src/runtime/channels";
import { memoryStore } from "../../src/runtime/store";
import { threadId, type Event, type ThreadId } from "../../src/runtime/events";
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

  test("RunEnded write failure surfaces as the store error, not RunErrored", async () => {
    const inner = memoryStore();
    const store = {
      ...inner,
      async appendEvents(t: ThreadId, es: readonly Event[]): Promise<void> {
        if (es.some((e) => e.type === "RunEnded")) throw new Error("disk full");
        return inner.appendEvents(t, es);
      },
    };
    const c = { aTool: 0 };
    await runThread({ driver: toyDriver(c), store, threadId: "t6", entry: "toy", input: { n: 3 } }).catch((e) => {
      if (!(e instanceof RunSuspended)) throw e;
    });
    await expect(
      runThread({ driver: toyDriver(c), store, threadId: "t6", entry: "toy", resume: { value: { approved: true } } }),
    ).rejects.toThrow("disk full");
    const types = (await inner.readLog(threadId("t6"))).map((e) => e.type);
    expect(types).not.toContain("RunErrored"); // store 에러가 도메인 에러로 둔갑하지 않음
  });

  test("domain error survives store failure during RunErrored recording", async () => {
    const inner = memoryStore();
    let failing = false;
    const store = {
      ...inner,
      async appendEvents(t: ThreadId, es: readonly Event[]): Promise<void> {
        if (failing) throw new Error("disk full");
        return inner.appendEvents(t, es);
      },
    };
    const d = toyDriver({ aTool: 0 });
    const boom: RunnableNode = {
      reads: () => null,
      run: async () => { failing = true; throw new RangeError("bad state"); },
    };
    d.node = () => boom;
    await expect(runThread({ driver: d, store, threadId: "t7", entry: "toy", input: { n: 1 } })).rejects.toThrow("bad state");
  });

  test("errored thread cannot be re-run", async () => {
    const store = memoryStore();
    const d = toyDriver({ aTool: 0 });
    const boom: RunnableNode = { reads: () => null, run: async () => { throw new RangeError("nope"); } };
    d.node = () => boom;
    await runThread({ driver: d, store, threadId: "t8", entry: "toy", input: { n: 1 } }).catch(() => {});
    await expect(
      runThread({ driver: d, store, threadId: "t8", entry: "toy", input: { n: 1 } }),
    ).rejects.toThrow("already exists");
  });

  test("resume recovers pending from the log when the snapshot was never saved (crash mode ①)", async () => {
    const inner = memoryStore();
    // save가 조용히 사라짐 — InterruptRaised는 로그에 남았지만 suspended snapshot 저장 전 크래시
    const crashy = { ...inner, async save(): Promise<void> {} };
    const c = { aTool: 0 };
    await runThread({ driver: toyDriver(c), store: crashy, threadId: "t9", entry: "toy", input: { n: 3 } }).catch((e) => {
      if (!(e instanceof RunSuspended)) throw e;
    });
    expect((await inner.load(threadId("t9")))?.snapshot).toBeNull(); // 스냅샷 부재 확인
    const out = await runThread({
      driver: toyDriver(c), store: inner, threadId: "t9", entry: "toy", resume: { value: { approved: true } },
    });
    expect(out).toEqual({ done: true });
    expect(c.aTool).toBe(1); // 로그 복구 resume에서도 effect는 replay
  });

  test("stale suspended snapshot cannot double-apply a committed patch (log is the authority)", async () => {
    const inner = memoryStore();
    const c = { aTool: 0 };
    await runThread({ driver: toyDriver(c), store: inner, threadId: "t10", entry: "toy", input: { n: 3 } }).catch((e) => {
      if (!(e instanceof RunSuspended)) throw e;
    });
    // resume#1: patch(StatePatched)는 커밋되지만 StepEnded 기록이 실패 —
    // save(error)도 도달 못 해 snapshot은 suspended로 낡은 채 남음
    const flaky = {
      ...inner,
      async appendEvents(t: ThreadId, es: readonly Event[]): Promise<void> {
        if (es.some((e) => e.type === "StepEnded")) throw new Error("disk full");
        return inner.appendEvents(t, es);
      },
    };
    await expect(
      runThread({ driver: toyDriver(c), store: flaky, threadId: "t10", entry: "toy", resume: { value: { approved: true } } }),
    ).rejects.toThrow("disk full");
    expect((await inner.load(threadId("t10")))?.snapshot?.status).toBe("suspended"); // 낡은 snapshot
    const patchesBefore = (await inner.readLog(threadId("t10"))).filter((e) => e.type === "StatePatched").length;
    // 재시도 resume: 낡은 snapshot의 pending이 아닌 로그가 판정 — 무음 이중 적용 대신 명시적 거부
    await expect(
      runThread({ driver: toyDriver(c), store: inner, threadId: "t10", entry: "toy", resume: { value: { approved: true } } }),
    ).rejects.toThrow("not suspended");
    const patchesAfter = (await inner.readLog(threadId("t10"))).filter((e) => e.type === "StatePatched").length;
    expect(patchesAfter).toBe(patchesBefore); // 커밋된 patch가 이중 적용되지 않음
  });

  test("terminal thread with a swallowed Suspend cannot be resumed", async () => {
    const store = memoryStore();
    const d = toyDriver({ aTool: 0 });
    // 사용자 실수 시뮬레이션: 노드가 Suspend를 삼켜 완주 — RunEnded와 미해소 InterruptRaised가 공존
    const swallower: RunnableNode = {
      reads: () => null,
      run: async (_i, ctx) => {
        try {
          await ctx.interrupt({ ask: "x" });
        } catch {
          /* swallowed */
        }
        return { done: false };
      },
    };
    d.node = () => swallower;
    const out = await runThread({ driver: d, store, threadId: "t11", entry: "toy", input: { n: 1 } });
    expect(out).toEqual({ done: false });
    const types = (await store.readLog(threadId("t11"))).map((e) => e.type);
    expect(types).toContain("InterruptRaised"); // 미해소 interrupt가 로그에 남아 있음
    expect(types[types.length - 1]).toBe("RunEnded"); // 그런데 스레드는 터미널
    await expect(
      runThread({ driver: d, store, threadId: "t11", entry: "toy", resume: { value: { approved: true } } }),
    ).rejects.toThrow("not suspended");
  });
});
