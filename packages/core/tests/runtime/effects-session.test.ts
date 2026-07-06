import { describe, expect, test } from "bun:test";
import { EventSession, Memo } from "../../src/runtime/effects";
import { memoryStore } from "../../src/runtime/store";
import { threadId, runId, posKey, type Event } from "../../src/runtime/events";

const T = threadId("t"), R = runId("r");

describe("EventSession", () => {
  test("reserve is sync-monotonic; concurrent writes land in seq order", async () => {
    const store = memoryStore();
    const seen: number[] = [];
    const s = new EventSession(store, T, R, 0, (e) => seen.push(e.seq));
    const a = s.reserve(); // 0
    const b = s.reserve(); // 1
    // write b first — session must still persist in seq order
    await Promise.all([
      s.writeReserved(b, { type: "StepEnded", node: "" }),
      s.writeReserved(a, { type: "StepStarted", node: "" }),
    ]);
    const log = await store.readLog(T);
    expect(log.map((e) => e.seq)).toEqual([0, 1]);
    expect(seen).toEqual([0, 1]); // onEvent fires in order too
  });

  test("store failure rejects the write and fails the session loudly", async () => {
    const broken = {
      ...memoryStore(),
      async appendEvents(): Promise<void> {
        throw new Error("disk full");
      },
    };
    const s = new EventSession(broken, T, R, 0);
    await expect(s.write({ type: "StepStarted", node: "" })).rejects.toThrow("disk full");
    // session is failed: later writes reject with the same error instead of hanging
    await expect(s.write({ type: "StepEnded", node: "" })).rejects.toThrow("disk full");
  });

  test("queued writes behind a failure are rejected too", async () => {
    const broken = {
      ...memoryStore(),
      async appendEvents(): Promise<void> {
        throw new Error("disk full");
      },
    };
    const s = new EventSession(broken, T, R, 0);
    const a = s.reserve(); // 0
    const b = s.reserve(); // 1
    const pb = s.writeReserved(b, { type: "StepEnded", node: "" }); // queued behind a
    const pa = s.writeReserved(a, { type: "StepStarted", node: "" }); // fails first
    // allSettled attaches handlers to both up front (no unhandled-rejection window)
    const [ra, rb] = await Promise.allSettled([pa, pb]);
    expect(ra.status).toBe("rejected");
    expect(rb.status).toBe("rejected");
    expect((ra as PromiseRejectedResult).reason).toEqual(new Error("disk full"));
    expect((rb as PromiseRejectedResult).reason).toEqual(new Error("disk full"));
  });
});

describe("Memo.fromEvents", () => {
  const base = { threadId: T, runId: R, ts: "", node: "n#1" };
  test("paired effect → entry with result; digest kept", () => {
    const events: Event[] = [
      { ...base, seq: 3, type: "ToolCalled", effectId: 3, posKey: posKey("n#1", 0, "tool:runBuild"), argsDigest: "abc", tool: "runBuild", args: { d: 1 } },
      { ...base, seq: 4, type: "ToolReturned", effectId: 3, ok: true, value: { ok: true } },
    ];
    const m = Memo.fromEvents(events);
    const e = m.effect(posKey("n#1", 0, "tool:runBuild"));
    expect(e?.argsDigest).toBe("abc");
    expect(e?.result).toEqual({ ok: true, value: { ok: true } });
  });
  test("dangling call (no Returned) → entry without result", () => {
    const events: Event[] = [
      { ...base, seq: 3, type: "ToolCalled", effectId: 3, posKey: posKey("n#1", 0, "tool:x"), argsDigest: "abc", tool: "x", args: {} },
    ];
    expect(Memo.fromEvents(events).effect(posKey("n#1", 0, "tool:x"))?.result).toBeUndefined();
  });
  test("interrupt/resume pairing by resumeKey", () => {
    const events: Event[] = [
      { ...base, seq: 5, type: "InterruptRaised", effectId: 5, posKey: posKey("n#1", 1, "interrupt"), payload: { q: 1 }, resumeKey: "n#1|1|interrupt" },
      { ...base, seq: 6, type: "Resumed", resumeKey: "n#1|1|interrupt", value: { approved: true }, node: "" },
    ];
    const m = Memo.fromEvents(events);
    expect(m.resume("n#1|1|interrupt")).toEqual({ found: true, value: { approved: true } });
    expect(m.resume("other").found).toBe(false);
  });
  test("hasStepStarted/hasStepEnded by scope", () => {
    const events: Event[] = [
      { ...base, seq: 0, node: "a#1", type: "StepStarted" },
    ];
    const m = Memo.fromEvents(events);
    expect(m.hasStepStarted("a#1")).toBe(true);
    expect(m.hasStepEnded("a#1")).toBe(false);
  });
});
