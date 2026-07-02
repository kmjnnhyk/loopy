import { describe, expect, test } from "bun:test";
import { memoryStore } from "../../src/runtime/store";
import { threadId, runId, type Event } from "../../src/runtime/events";

export function ev(seq: number, type: "StepStarted" | "StepEnded" = "StepStarted"): Event {
  return { seq, threadId: threadId("t"), runId: runId("r"), ts: "", node: "", type } as Event;
}

describe("memoryStore", () => {
  test("append + readLog roundtrip, fromSeq filter", async () => {
    const s = memoryStore();
    await s.appendEvents(threadId("t"), [ev(0), ev(1), ev(2)]);
    expect((await s.readLog(threadId("t"))).length).toBe(3);
    expect((await s.readLog(threadId("t"), 2)).map((e) => e.seq)).toEqual([2]);
  });
  test("idempotent append: duplicate seq ignored", async () => {
    const s = memoryStore();
    await s.appendEvents(threadId("t"), [ev(0), ev(1)]);
    await s.appendEvents(threadId("t"), [ev(1), ev(2)]); // crash-mid-flush replay
    expect((await s.readLog(threadId("t"))).map((e) => e.seq)).toEqual([0, 1, 2]);
  });
  test("idempotent append: duplicate seq within a single batch ignored", async () => {
    const s = memoryStore();
    await s.appendEvents(threadId("t"), [ev(0), ev(1), ev(1, "StepEnded")]);
    expect((await s.readLog(threadId("t"))).map((e) => e.seq)).toEqual([0, 1]);
  });
  test("load returns snapshot + full events; unknown thread → null", async () => {
    const s = memoryStore();
    expect(await s.load(threadId("nope"))).toBeNull();
    await s.appendEvents(threadId("t"), [ev(0)]);
    await s.save(threadId("t"), { status: "suspended", cursor: 0, pending: { effectId: 0, resumeKey: "k", payload: 1 } });
    const loaded = await s.load(threadId("t"));
    expect(loaded?.snapshot?.status).toBe("suspended");
    expect(loaded?.events.length).toBe(1);
  });
});
