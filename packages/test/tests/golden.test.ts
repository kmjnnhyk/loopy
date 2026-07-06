import { expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { goldenPath, goldenExists, readGolden, writeGolden } from "../src/golden.ts";
import { digest, type RuntimeEvent as Event } from "@loopyjs/core";

const TMP = "/tmp/loopy-golden-test";

function ev(seq: number): Event {
  return { seq, threadId: "abc" as never, runId: "r" as never, ts: "2026-07-04T00:00:00.000Z", node: "", type: "RunEnded", output: { ok: true } } as Event;
}

test("goldenPath sanitizes the test name, appends a digest, and nests under __golden__", () => {
  const name = "designFlow: figma → PR";
  const p = goldenPath(TMP, name);
  expect(p).toBe(`${TMP}/__golden__/designFlow_figma-PR.${digest(name).slice(0, 8)}.json`);
});

test("names that sanitize to the same stem still get distinct paths (digest suffix)", () => {
  // both sanitize to "a_b"; pre-fix they collided onto one golden file
  const p1 = goldenPath(TMP, "a: b");
  const p2 = goldenPath(TMP, "a / b");
  expect(p1).not.toBe(p2);
  expect(p1).toContain("/a_b."); // same sanitized stem...
  expect(p2).toContain("/a_b."); // ...distinct digest suffix
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

test("readGolden rejects an unsupported loopyGoldenVersion", () => {
  // Hand-write a raw golden (writeGolden always stamps version 1, so bypass it).
  const p = `${TMP}/__golden__/v2.json`;
  try {
    mkdirSync(`${TMP}/__golden__`, { recursive: true });
    writeFileSync(p, JSON.stringify({ loopyGoldenVersion: 2, entry: "toy", input: null, events: [] }));
    expect(() => readGolden(p)).toThrow(/unsupported loopyGoldenVersion 2/);
  } finally {
    rmSync(`${TMP}/__golden__`, { recursive: true, force: true });
  }
});
