import { expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { goldenPath, goldenExists, readGolden, writeGolden } from "../../src/test/golden";
import type { Event } from "../../src/runtime/events";

const TMP = "/tmp/loopy-golden-test";

function ev(seq: number): Event {
  return { seq, threadId: "abc" as never, runId: "r" as never, ts: "2026-07-04T00:00:00.000Z", node: "", type: "RunEnded", output: { ok: true } } as Event;
}

test("goldenPath sanitizes the test name and nests under __golden__", () => {
  const p = goldenPath(TMP, "designFlow: figma → PR");
  expect(p).toBe(`${TMP}/__golden__/designFlow_figma-PR.json`);
});

test("write then read round-trips entry/input/events", () => {
  const p = goldenPath(TMP, "rt");
  try {
    writeGolden(p, { entry: "toy", input: { n: 1 }, events: [ev(0)] });
    expect(goldenExists(p)).toBe(true);
    const g = readGolden(p);
    expect(g.loopyGoldenVersion).toBe(1);
    expect(g.entry).toBe("toy");
    expect(g.input).toEqual({ n: 1 });
    expect(g.events.length).toBe(1);
    expect(g.events[0]!.type).toBe("RunEnded");
  } finally {
    rmSync(`${TMP}/__golden__`, { recursive: true, force: true });
  }
});

test("ts is normalized to empty string on write (stable diffs)", () => {
  const p = goldenPath(TMP, "ts");
  try {
    writeGolden(p, { entry: "toy", input: null, events: [ev(0)] });
    const g = readGolden(p);
    expect(g.events[0]!.ts).toBe("");
  } finally {
    rmSync(`${TMP}/__golden__`, { recursive: true, force: true });
  }
});
