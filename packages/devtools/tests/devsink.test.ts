import { expect, test } from "bun:test";
import type { RuntimeEvent } from "@loopyjs/core";
import { createDevSink } from "../src/devsink.ts";

const ev = (seq: number, threadId: string): RuntimeEvent =>
  ({ seq, threadId, runId: "r", ts: "", type: "StepStarted", node: "a#1" } as unknown as RuntimeEvent);

test("ingest accumulates and threadLog filters by threadId + fromSeq", () => {
  const sink = createDevSink();
  sink.ingest(ev(0, "t1")); sink.ingest(ev(1, "t2")); sink.ingest(ev(2, "t1"));
  expect(sink.log().length).toBe(3);
  expect(sink.threadLog("t1").map((e) => e.seq)).toEqual([0, 2]);
  expect(sink.threadLog("t1", 2).map((e) => e.seq)).toEqual([2]);
});

test("onBroadcast fires per ingest; unsubscribe stops it", () => {
  const sink = createDevSink();
  const seen: number[] = [];
  const off = sink.onBroadcast((e) => seen.push(e.seq));
  sink.ingest(ev(0, "t1"));
  off();
  sink.ingest(ev(1, "t1"));
  expect(seen).toEqual([0]);
});
