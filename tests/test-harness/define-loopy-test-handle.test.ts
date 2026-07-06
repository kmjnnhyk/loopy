import { expect, test } from "bun:test";
import { defineLoopy, stubModel } from "@loopyjs/core";
import { designFlow } from "../../examples/workflows";
import { classifier, sufficiency, fileAnalyzer, verifier, codeGen } from "../../examples/agents";
import { stubDeps } from "../anchors/designflow.test";

const answer = (o: unknown) => ({ text: JSON.stringify(o), stopReason: "end_turn" });
const mkRuntime = () =>
  defineLoopy({
    agents: { classifier, sufficiency, fileAnalyzer, verifier, codeGen },
    workflows: { designFlow },
    deps: stubDeps,
    models: {
      haiku: stubModel([answer({ paths: ["src/a.ts"] }), answer({ passed: true, notes: "lgtm" })]),
      sonnet: stubModel([answer({ applied: ["src/a.ts"], failed: [] })]),
    },
  });

test("~test.record returns a completed log (ends in RunEnded)", async () => {
  const rt = mkRuntime();
  const log = await rt["~test"]!.record("designFlow", { message: "add /healthz" });
  expect(log[log.length - 1]!.type).toBe("RunEnded");
  expect(log.some((e) => e.type === "ModelCallRequested")).toBe(true);
});

test("~test.replay against a fresh recording is green and output matches run()", async () => {
  const golden = await mkRuntime()["~test"]!.record("designFlow", { message: "add /healthz" });
  const r = await mkRuntime()["~test"]!.replay("designFlow", { message: "add /healthz" }, golden);
  expect(r.divergence).toBeNull();
  expect(r.output).toEqual({ prUrl: "https://d.example/pull/9" });
});
