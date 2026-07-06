import { describe, expect, test } from "bun:test";
import { sqliteStore } from "../../src/sqlite";
import { threadId } from "../../src/runtime/events";
import { ev } from "./store.test";

describe("sqliteStore", () => {
  test("append idempotent + readLog ordered", async () => {
    const s = sqliteStore(":memory:");
    await s.appendEvents(threadId("t"), [ev(0), ev(1)]);
    await s.appendEvents(threadId("t"), [ev(1), ev(2)]);
    expect((await s.readLog(threadId("t"))).map((e) => e.seq)).toEqual([0, 1, 2]);
  });
  test("snapshot save/load", async () => {
    const s = sqliteStore(":memory:");
    await s.appendEvents(threadId("t"), [ev(0)]);
    await s.save(threadId("t"), { status: "done", cursor: 0 });
    expect((await s.load(threadId("t")))?.snapshot?.status).toBe("done");
  });
  test("survives reopen from same file (process-restart equivalent)", async () => {
    const file = `/tmp/loopy-test-${Math.random().toString(36).slice(2)}.db`;
    const a = sqliteStore(file);
    await a.appendEvents(threadId("t"), [ev(0), ev(1)]);
    await a.save(threadId("t"), { status: "suspended", cursor: 1, pending: { effectId: 1, resumeKey: "k", payload: null } });
    const b = sqliteStore(file); // fresh connection = fresh process equivalent
    const loaded = await b.load(threadId("t"));
    expect(loaded?.events.length).toBe(2);
    expect(loaded?.snapshot?.pending?.resumeKey).toBe("k");
  });
});
