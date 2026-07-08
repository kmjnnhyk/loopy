import { expect, test } from "bun:test";
import type { RuntimeEvent, DevTopology } from "@loopyjs/core";
import { buildGraphModel, parseScope } from "../src/graph.ts";

const ev = (seq: number, type: string, node: string): RuntimeEvent =>
  ({ seq, type, node, threadId: "t", runId: "r", ts: "" } as unknown as RuntimeEvent);

const topo: DevTopology = {
  entry: "wf", kind: "workflow", start: "a",
  nodes: [{ name: "a", kind: "tool" }, { name: "b", kind: "agent" }, { name: "c", kind: "tool" }],
  edges: [{ from: "a", to: "b" }],       // a→b unconditional
  branchSources: ["b"],                   // b has a conditional exit (target unknown statically)
};

test("parseScope splits name#epoch and depth", () => {
  expect(parseScope("codeGen#2")).toEqual({ name: "codeGen", epoch: 2, depth: 1 });
  expect(parseScope("codeGen#2/think#3")).toEqual({ name: "think", epoch: 3, depth: 2 });
  expect(parseScope("")).toEqual({ name: "", epoch: 0, depth: 0 });
});

test("static skeleton: all topology nodes present, idle before any event", () => {
  const g = buildGraphModel(topo, []);
  expect(g.nodes.map((n) => n.name).sort()).toEqual(["a", "b", "c"]);
  expect(g.nodes.every((n) => n.state === "idle")).toBe(true);
  expect(g.edges).toContainEqual({ from: "a", to: "b", observed: false, conditional: false });
});

test("observed path lights nodes and adds branch edges ONLY when seen (no phantom edges)", () => {
  const log = [
    ev(0, "RunStarted", ""),
    ev(1, "StepStarted", "a#1"), ev(2, "StepEnded", "a#1"),
    ev(3, "StepStarted", "b#1"), ev(4, "StepEnded", "b#1"),
    ev(5, "StepStarted", "c#1"),                            // c running, not ended
  ];
  const g = buildGraphModel(topo, log);
  const byName = Object.fromEntries(g.nodes.map((n) => [n.name, n.state]));
  expect(byName).toEqual({ a: "visited", b: "visited", c: "running" });
  // b→c was observed (branch target discovered from the log), marked conditional (b is a branchSource)
  expect(g.edges).toContainEqual({ from: "b", to: "c", observed: true, conditional: true });
  // a→b (static, unconditional) is now observed
  expect(g.edges).toContainEqual({ from: "a", to: "b", observed: true, conditional: false });
  // NO phantom b→a or b→(other) edge exists — only what topology declared or the log showed
  expect(g.edges.some((e) => e.from === "b" && e.to !== "c")).toBe(false);
});

test("RunErrored marks the in-flight node errored", () => {
  const log = [
    ev(0, "RunStarted", ""),
    ev(1, "StepStarted", "a#1"),
    ev(2, "RunErrored", ""),
  ];
  const g = buildGraphModel(topo, log);
  expect(g.nodes.find((n) => n.name === "a")!.state).toBe("errored");
});

test("null topology → graph derived purely from the log", () => {
  const log = [ev(1, "StepStarted", "x#1"), ev(2, "StepEnded", "x#1"), ev(3, "StepStarted", "y#1"), ev(4, "StepEnded", "y#1")];
  const g = buildGraphModel(null, log);
  expect(g.nodes.map((n) => n.name).sort()).toEqual(["x", "y"]);
  expect(g.edges).toContainEqual({ from: "x", to: "y", observed: true, conditional: false });
});

test("END sentinel edges are normalized to a synthetic END node (no dangling target)", () => {
  const topoWithEnd: DevTopology = {
    entry: "wf", kind: "workflow", start: "a",
    nodes: [{ name: "a", kind: "tool" }, { name: "b", kind: "agent" }, { name: "c", kind: "tool" }],
    edges: [{ from: "a", to: "b" }, { from: "c", to: "~end" }],
    branchSources: ["b"],
  };
  const g = buildGraphModel(topoWithEnd, []);
  const endNode = g.nodes.find((n) => n.name === "END");
  expect(endNode).toEqual({ name: "END", kind: "end", state: "idle" });
  expect(g.edges).toContainEqual({ from: "c", to: "END", observed: false, conditional: false });
  expect(g.nodes.some((n) => n.name === "~end")).toBe(false);
});
