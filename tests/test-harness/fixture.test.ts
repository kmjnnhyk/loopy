import { expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { defineLoopy, workflow, step, node, io, lastChannel, END, ReplayDivergence } from "loopy";
import { replayFixture } from "../../src/test";
import { goldenPath, goldenExists } from "../../src/test/golden";

const TMP = "/tmp/loopy-fixture-test";
const cleanup = () => rmSync(`${TMP}/__golden__`, { recursive: true, force: true });

// A toy workflow whose router branch is data-driven, so a variant can flip it.
const dbl = step({ name: "dbl", input: io<{ n: number }>(), output: io<{ n: number }>(), run: async (i) => ({ n: i.n * 2 }) });
const mkFlow = (goHigh: boolean) =>
  workflow({
    name: "toy",
    state: { out: lastChannel<{ n: number } | null>(null) },
    input: io<{ n: number }>(),
    output: io<{ n: number }>(),
  })
    .nodes({ dbl: node(dbl, { reads: (s) => ({ n: goHigh ? s.input.n + 100 : s.input.n }), writes: "out" }) })
    .flow((b) => b.start("dbl").edge("dbl", END))
    .returns((s) => ({ n: s.out?.n ?? -1 }));

const mkRuntime = (goHigh: boolean) =>
  defineLoopy({ agents: {}, workflows: { toy: mkFlow(goHigh) }, deps: {} as never });

test("first run records the golden and returns the recorded output", async () => {
  cleanup();
  try {
    const f = replayFixture(mkRuntime(false), { dir: TMP });
    const r = await f.replay("toy", { n: 5 });
    expect(r.output).toEqual({ n: 10 });
    expect(goldenExists(goldenPath(TMP, "toy"))).toBe(true);
  } finally {
    cleanup();
  }
});

test("second run replays green (no re-record) and matches", async () => {
  cleanup();
  try {
    await replayFixture(mkRuntime(false), { dir: TMP }).replay("toy", { n: 5 }); // record
    const r = await replayFixture(mkRuntime(false), { dir: TMP }).replay("toy", { n: 5 }); // replay
    expect(r.output).toEqual({ n: 10 });
  } finally {
    cleanup();
  }
});

test("orchestration change (flipped reads) → replay throws ReplayDivergence", async () => {
  cleanup();
  try {
    await replayFixture(mkRuntime(false), { dir: TMP }).replay("toy", { n: 5 }); // record baseline
    const f = replayFixture(mkRuntime(true), { dir: TMP }); // variant: reads(n+100)
    await expect(f.replay("toy", { n: 5 })).rejects.toBeInstanceOf(ReplayDivergence);
  } finally {
    cleanup();
  }
});

test("update:true re-records even when a (stale) golden exists", async () => {
  cleanup();
  try {
    await replayFixture(mkRuntime(false), { dir: TMP }).replay("toy", { n: 5 }); // golden: {n:10}
    // variant would diverge on plain replay; update re-records instead of throwing.
    const r = await replayFixture(mkRuntime(true), { dir: TMP, update: true }).replay("toy", { n: 5 });
    expect(r.output).toEqual({ n: 210 }); // (5+100)*2
    // subsequent plain replay of the variant is now green
    const r2 = await replayFixture(mkRuntime(true), { dir: TMP }).replay("toy", { n: 5 });
    expect(r2.output).toEqual({ n: 210 });
  } finally {
    cleanup();
  }
});

test("goldenKey decouples the golden file from the dispatch entry name", async () => {
  cleanup();
  try {
    // same entry "toy", but goldenKey routes the golden to a distinct file
    await replayFixture(mkRuntime(false), { dir: TMP, goldenKey: "scenario-A" }).replay("toy", { n: 5 });
    expect(goldenExists(goldenPath(TMP, "scenario-A"))).toBe(true);
    expect(goldenExists(goldenPath(TMP, "toy"))).toBe(false); // NOT keyed by the entry name
  } finally {
    cleanup();
  }
});
