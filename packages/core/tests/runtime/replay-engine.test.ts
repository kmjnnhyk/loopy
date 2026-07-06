import { expect, test } from "bun:test";
import { replayThread } from "../../src/runtime/replay";
import { runThread, type Driver, type RunnableNode } from "../../src/runtime/scheduler";
import { memoryStore } from "../../src/runtime/store";
import { threadId } from "../../src/runtime/events";
import { rawChannel } from "../../src/runtime/channels";
import { lastChannel } from "@loopyjs/core";

// A toy 2-node workflow-shaped driver: node "a" (a tool effect) then a router to END.
// The tool multiplies the seed by 10. Router always goes a → END.
function toyDriver(): Driver {
  const tool = { name: "mul", run: async (i: { n: number }) => ({ n: i.n * 10 }) };
  const only: RunnableNode = {
    reads: (s) => ({ n: (s.input as { n: number }).n }),
    run: (input, ctx) => ctx.callTool(tool as never, input),
  };
  return {
    channels: { input: rawChannel(), out: lastChannel<{ n: number } | null>(null) },
    seed: (input) => ({ input }),
    next: (_s, last) => (last === null ? "a" : "~end"),
    onSelected: () => null,
    node: () => only,
    updatesFor: (name, output) => ({ out: output }),
    output: (s) => ({ result: (s.out as { n: number } | null)?.n ?? -1 }),
    guard: () => {},
  } as unknown as Driver;
}

async function record(driver: Driver, input: unknown) {
  const store = memoryStore();
  await runThread({ driver, store, threadId: "g", entry: "toy", input });
  return store.readLog(threadId("g"));
}

test("green replay: re-executes user code, effect from memo, output matches", async () => {
  const golden = await record(toyDriver(), { n: 5 });
  const r = await replayThread({ driver: toyDriver(), goldenEvents: golden, entry: "toy", input: { n: 5 } });
  expect(r.divergence).toBeNull();
  expect(r.output).toEqual({ result: 50 });
});

test("effect-arg divergence: different input → tool args digest mismatch, localized", async () => {
  const golden = await record(toyDriver(), { n: 5 });
  const r = await replayThread({ driver: toyDriver(), goldenEvents: golden, entry: "toy", input: { n: 6 } });
  expect(r.divergence?.kind).toBe("effect");
  expect(r.divergence?.pos).toContain("a#1"); // the diverging node position
  // ⓒ: the divergence surfaces the recorded-vs-live values, not just their digests
  expect(r.divergence?.expectedPreview).toContain('"n":5');
  expect(r.divergence?.actualPreview).toContain('"n":6');
});

test("new-branch divergence: a router that visits an unrecorded node → miss divergence", async () => {
  const golden = await record(toyDriver(), { n: 5 });
  // variant: router sends a → "b" (a node absent from the golden) instead of END.
  const variant = toyDriver();
  const patched: Driver = {
    ...variant,
    next: (_s, last) => (last === null ? "a" : last === "a" ? "b" : "~end"),
    node: (name) =>
      name === "b"
        ? ({ reads: (s) => s, run: (_i, ctx) => ctx.callTool({ name: "other", run: async () => ({}) } as never, {}) } as RunnableNode)
        : variant.node(name),
  };
  const r = await replayThread({ driver: patched, goldenEvents: golden, entry: "toy", input: { n: 5 } });
  expect(r.divergence?.kind).toBe("effect");
  expect(r.divergence?.pos).toContain("b#1");
});

test("output divergence: same effects, different returns projection → output mismatch", async () => {
  const golden = await record(toyDriver(), { n: 5 });
  const variant = toyDriver();
  const patched: Driver = { ...variant, output: (s) => ({ result: ((s.out as { n: number } | null)?.n ?? -1) + 1 }) };
  const r = await replayThread({ driver: patched, goldenEvents: golden, entry: "toy", input: { n: 5 } });
  expect(r.divergence?.kind).toBe("output");
  expect(r.divergence?.pos).toBe("<run-output>");
  // ⓒ: output divergence shows both projections, not just digests
  expect(r.divergence?.expectedPreview).toContain('"result":50');
  expect(r.divergence?.actualPreview).toContain('"result":51');
});

// ⓒ: a replay that requests a clock/random/sleep effect the golden lacks used to report
// actual="" — meaningless. It now names the op (resolving the empty-actual label).
test("effect-miss on a clock read → actual names the op (now()), not empty", async () => {
  const golden = await record(toyDriver(), { n: 5 });
  const variant = toyDriver();
  const patched: Driver = {
    ...variant,
    node: () =>
      ({
        reads: (s) => ({ n: (s.input as { n: number }).n }),
        run: async (i, ctx) => {
          ctx.now(); // an effect absent from the golden → first divergence
          return i;
        },
      }) as RunnableNode,
  };
  const r = await replayThread({ driver: patched, goldenEvents: golden, entry: "toy", input: { n: 5 } });
  expect(r.divergence?.kind).toBe("effect");
  expect(r.divergence?.actual).toBe("now()");
});

test("effect-miss on a sleep → actual label carries the duration", async () => {
  const golden = await record(toyDriver(), { n: 5 });
  const variant = toyDriver();
  const patched: Driver = {
    ...variant,
    node: () =>
      ({
        reads: (s) => ({ n: (s.input as { n: number }).n }),
        run: async (i, ctx) => {
          await ctx.sleep(500);
          return i;
        },
      }) as RunnableNode,
  };
  const r = await replayThread({ driver: patched, goldenEvents: golden, entry: "toy", input: { n: 5 } });
  expect(r.divergence?.actual).toBe("sleep(500ms)");
});

test("guard: an empty golden log → rejects (not a completed run)", async () => {
  await expect(
    replayThread({ driver: toyDriver(), goldenEvents: [], entry: "toy", input: { n: 5 } }),
  ).rejects.toThrow(/not a completed run/);
});

test("guard: a golden log not ending in RunEnded → rejects (not a completed run)", async () => {
  const golden = await record(toyDriver(), { n: 5 });
  const truncated = golden.slice(0, -1); // drop the trailing RunEnded
  expect(truncated[truncated.length - 1]!.type).not.toBe("RunEnded"); // precondition: last is a non-terminal event
  await expect(
    replayThread({ driver: toyDriver(), goldenEvents: truncated, entry: "toy", input: { n: 5 } }),
  ).rejects.toThrow(/not a completed run/);
});
