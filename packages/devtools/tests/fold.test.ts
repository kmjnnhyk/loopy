import { expect, test } from "bun:test";
import type { RuntimeEvent } from "@loopyjs/core";
import { fold } from "../src/fold.ts";

const base = { threadId: "th_1", runId: "r_1", ts: "2026-07-08T00:00:00Z" };
const log: RuntimeEvent[] = [
  { ...base, seq: 0, type: "RunStarted", entry: "wf", input: { message: "hi" }, node: "" },
  { ...base, seq: 1, type: "StepStarted", node: "fetch#1" },
  { ...base, seq: 2, type: "ToolCalled", node: "fetch#1", effectId: 1, posKey: "fetch#1|0|tool", argsDigest: "d", tool: "fetchFigma", args: { id: "n1" } },
  { ...base, seq: 3, type: "ToolReturned", node: "fetch#1", effectId: 1, ok: true, value: { frames: [] } },
  { ...base, seq: 4, type: "StatePatched", node: "fetch#1", update: { design: {} } },
  { ...base, seq: 5, type: "StepEnded", node: "fetch#1" },
  { ...base, seq: 6, type: "StepStarted", node: "gen#1" },
  { ...base, seq: 7, type: "ModelCallRequested", node: "gen#1", effectId: 2, posKey: "gen#1|0|model", argsDigest: "d", req: { system: "s" } },
  { ...base, seq: 8, type: "ModelCallReturned", node: "gen#1", effectId: 2, ok: true, value: { text: "{}" } },
  { ...base, seq: 9, type: "StepEnded", node: "gen#1" },
  { ...base, seq: 10, type: "RunEnded", node: "", output: { prUrl: "x" } },
] as unknown as RuntimeEvent[];

test("fold produces a timeline row per top-level step with status", () => {
  const vm = fold(log);
  expect(vm.status).toBe("done");
  expect(vm.entry).toBe("wf");
  expect(vm.threadId).toBe("th_1");
  const names = vm.timeline.filter((r) => r.depth === 1).map((r) => r.name);
  expect(names).toEqual(["fetch", "gen"]);
  expect(vm.timeline.find((r) => r.name === "fetch")!.status).toBe("done");
});

test("step detail captures tool call, model call, and patched channels", () => {
  const vm = fold(log);
  expect(vm.details["fetch#1"]!.tools).toEqual([{ tool: "fetchFigma", args: { id: "n1" }, value: { frames: [] }, ok: true }]);
  expect(vm.details["fetch#1"]!.patchedChannels).toEqual(["design"]);
  expect(vm.details["gen#1"]!.model).toEqual({ request: { system: "s" }, response: { text: "{}" }, ok: true });
});

test("uptoSeq scrubs to a point in time (read-only time travel)", () => {
  const vm = fold(log, 3); // through ToolReturned of fetch, before StepEnded
  expect(vm.status).toBe("running");
  expect(vm.timeline.find((r) => r.name === "fetch")!.status).toBe("running");
  expect(vm.timeline.some((r) => r.name === "gen")).toBe(false); // gen not started yet
  expect(vm.lastSeq).toBe(3);
});

test("RunErrored → status errored, in-flight step errored", () => {
  const errLog = log.slice(0, 7).concat([{ ...base, seq: 7, type: "RunErrored", node: "", error: { name: "E", message: "boom" } } as unknown as RuntimeEvent]);
  const vm = fold(errLog);
  expect(vm.status).toBe("errored");
  expect(vm.timeline.find((r) => r.name === "gen")!.status).toBe("errored");
});
