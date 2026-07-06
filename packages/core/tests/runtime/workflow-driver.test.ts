import { describe, expect, test } from "bun:test";
import { workflow, step, node, tool, io, lastChannel, END } from "@loopyjs/core";
import { workflowDriver } from "../../src/runtime/drivers/workflow";
import { runThread, RunSuspended } from "../../src/runtime/scheduler";
import { memoryStore } from "../../src/runtime/store";
import { threadId } from "../../src/runtime/events";

let buildCalls = 0;
const buildT = tool({
  name: "buildT", description: "build",
  input: io<{ n: number }>(), output: io<{ ok: boolean; n: number }>(),
  run: async (i) => ({ ok: ++buildCalls >= 2, n: i.n }), // 첫 방문 실패 → 사이클 → 두 번째 성공
});
const approve = step({
  name: "approve",
  input: io<{ n: number }>(), output: io<{ approved: boolean }>(),
  run: async (_i, ctx) => ctx.interrupt<{ approved: boolean }>({ ask: "ship?" }),
});
const wf = workflow({
  name: "cycleFlow",
  state: {
    build: lastChannel<{ ok: boolean; n: number } | null>(null),
    approval: lastChannel<{ approved: boolean } | null>(null),
  },
  input: io<{ n: number }>(),
  output: io<{ shipped: boolean; n: number }>(),
})
  .nodes({
    build: node(buildT, { reads: (s) => ({ n: s.input.n }), writes: "build" }),
    approve: node(approve, { reads: (s) => ({ n: s.build?.n ?? 0 }), writes: "approval" }),
  })
  .flow((b) => b.start("build").branch("build", (s) => (s.build?.ok ? "approve" : "build")).edge("approve", END))
  .returns((s) => ({ shipped: s.approval?.approved ?? false, n: s.build?.n ?? 0 }));

describe("workflowDriver", () => {
  test("cycle → interrupt → resume → returns projection; effects replay on resume", async () => {
    buildCalls = 0;
    const store = memoryStore();
    const d = workflowDriver(wf as never);
    await expect(
      runThread({ driver: d, store, threadId: "w1", entry: "cycleFlow", input: { n: 7 } }),
    ).rejects.toThrow(RunSuspended);
    expect(buildCalls).toBe(2); // build#1 실패 → build#2 성공 (epoch별 별도 memo)
    const out = await runThread({
      driver: d, store, threadId: "w1", entry: "cycleFlow", resume: { value: { approved: true } },
    });
    expect(out).toEqual({ shipped: true, n: 7 });
    expect(buildCalls).toBe(2); // ← resume이 buildT를 재실행하지 않음
    const starts = (await store.readLog(threadId("w1"))).filter((e) => e.type === "StepStarted").map((e) => e.node);
    expect(starts).toEqual(["build#1", "build#2", "approve#1"]);
  });
  test("undefined transition → loud error", async () => {
    const broken = workflow({
      name: "noflow", state: { a: lastChannel<number>(0) }, input: io<{ x: number }>(), output: io<{ y: number }>(),
    })
      .nodes({ only: node(buildT, { reads: (s) => ({ n: s.input.x }) }) })
      .flow((b) => b.start("only")); // edge 없음 → "only" 완료 후 전이 불가
    const d = workflowDriver(broken as never);
    await expect(
      runThread({ driver: d, store: memoryStore(), threadId: "w2", entry: "noflow", input: { x: 1 } }),
    ).rejects.toThrow(/no edge or branch/);
  });
  test("missing .returns() → loud error at completion", async () => {
    const noReturns = workflow({
      name: "noReturns", state: { a: lastChannel<number>(0) }, input: io<{ x: number }>(), output: io<{ y: number }>(),
    })
      .nodes({ only: node(buildT, { reads: (s) => ({ n: s.input.x }) }) })
      .flow((b) => b.start("only").edge("only", END)); // 유효한 edge로 END 도달 — .returns() 미호출
    const d = workflowDriver(noReturns as never);
    await expect(
      runThread({ driver: d, store: memoryStore(), threadId: "w3", entry: "noReturns", input: { x: 1 } }),
    ).rejects.toThrow(/needs .returns/);
  });
});
