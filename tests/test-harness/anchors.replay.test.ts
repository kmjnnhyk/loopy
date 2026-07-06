import { expect } from "bun:test";
import { defineLoopy, stubModel } from "loopy";
import { defineLoopyTest } from "loopy/test";
import { designFlow } from "../../examples/workflows";
import { classifier, sufficiency, fileAnalyzer, verifier, codeGen } from "../../examples/agents";
import { stubDeps } from "../anchors/designflow.test";

const answer = (o: unknown) => ({ text: JSON.stringify(o), stopReason: "end_turn" });

// Record path uses stub models (deterministic). CI replays the committed golden → 0 model calls.
const runtime = defineLoopy({
  agents: { classifier, sufficiency, fileAnalyzer, verifier, codeGen },
  workflows: { designFlow },
  deps: stubDeps,
  models: {
    haiku: stubModel([answer({ paths: ["src/a.ts"] }), answer({ passed: true, notes: "lgtm" })]),
    sonnet: stubModel([answer({ applied: ["src/a.ts"], failed: [] })]),
  },
});

const { test } = defineLoopyTest(runtime, { dir: import.meta.dir });

test("designFlow_replay", async (t) => {
  const r = await t.replay("designFlow", { message: "add /healthz" });
  expect(r.output).toEqual({ prUrl: "https://d.example/pull/9" });
});
