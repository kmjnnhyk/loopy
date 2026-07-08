import { expect, test } from "bun:test";
import { defineLoopy, loopy, stubModel, type RuntimeEvent } from "@loopyjs/core";
import { designFlow } from "../../../../examples/workflows";
import { classifier, sufficiency, fileAnalyzer, verifier, codeGen } from "../../../../examples/agents";
import { stubDeps } from "../../../../tests/anchors/designflow.test";

const answer = (o: unknown) => ({ text: JSON.stringify(o), stopReason: "end_turn" });
const mkRuntime = (onEvent?: (e: RuntimeEvent) => void) =>
  defineLoopy({
    agents: { classifier, sufficiency, fileAnalyzer, verifier, codeGen },
    workflows: { designFlow },
    deps: stubDeps,
    models: {
      haiku: stubModel([answer({ paths: ["src/a.ts"] }), answer({ passed: true, notes: "lgtm" })]),
      sonnet: stubModel([answer({ applied: ["src/a.ts"], failed: [] })]),
    },
    onEvent,
  });

test("~dev.subscribe receives the run's events in seq order", async () => {
  const rt = mkRuntime();
  const seen: RuntimeEvent[] = [];
  const off = rt["~dev"]!.subscribe((e) => seen.push(e));
  await rt.run("designFlow", { message: "add /healthz" });
  off();
  expect(seen[0]!.type).toBe("RunStarted");
  expect(seen[seen.length - 1]!.type).toBe("RunEnded");
  expect(seen.map((e) => e.seq)).toEqual([...seen.map((e) => e.seq)].sort((a, b) => a - b));
});

test("~dev fan-out preserves the app's own onEvent (composition)", async () => {
  const appSaw: RuntimeEvent[] = [];
  const rt = mkRuntime((e) => appSaw.push(e));
  const devSaw: RuntimeEvent[] = [];
  rt["~dev"]!.subscribe((e) => devSaw.push(e));
  await rt.run("designFlow", { message: "add /healthz" });
  expect(appSaw.length).toBeGreaterThan(0);
  expect(devSaw.length).toBe(appSaw.length);
});

test("~dev.subscribe unsubscribe stops delivery", async () => {
  const rt = mkRuntime();
  const seen: RuntimeEvent[] = [];
  const off = rt["~dev"]!.subscribe((e) => seen.push(e));
  off();
  await rt.run("designFlow", { message: "add /healthz" });
  expect(seen.length).toBe(0);
});

test("~dev.entries lists registered names + kinds", () => {
  const rt = mkRuntime();
  const entries = rt["~dev"]!.entries();
  expect(entries).toContainEqual({ name: "designFlow", kind: "workflow" });
  expect(entries.some((e) => e.name === "codeGen" && e.kind === "agent")).toBe(true);
});

test("~dev.topology returns a workflow's static skeleton; agent → null", () => {
  const rt = mkRuntime();
  const topo = rt["~dev"]!.topology("designFlow");
  expect(topo).not.toBeNull();
  expect(topo!.kind).toBe("workflow");
  expect(topo!.start.length).toBeGreaterThan(0);
  expect(topo!.nodes.length).toBeGreaterThan(0);
  // unconditional edges are present; branch sources are listed separately (targets not enumerated)
  expect(Array.isArray(topo!.edges)).toBe(true);
  expect(Array.isArray(topo!.branchSources)).toBe(true);
  expect(rt["~dev"]!.topology("codeGen")).toBeNull(); // agent entry has no ~graph
});

test("loopy() builder runtime has no ~dev (parallel to ~test)", () => {
  const built = loopy({
    agents: { classifier, sufficiency, fileAnalyzer, verifier, codeGen },
    workflows: { designFlow },
  });
  expect((built as unknown as { "~dev"?: unknown })["~dev"]).toBeUndefined();
});
