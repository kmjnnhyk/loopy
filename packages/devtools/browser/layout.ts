import * as dagre from "@dagrejs/dagre";
import type { GraphModel } from "../src/types.ts";

export function layout(model: GraphModel): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 60 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of model.nodes) g.setNode(n.name, { width: 120, height: 40 });
  for (const e of model.edges) g.setEdge(e.from, e.to);
  dagre.layout(g);
  const pos: Record<string, { x: number; y: number }> = {};
  for (const n of model.nodes) { const p = g.node(n.name); pos[n.name] = { x: p.x, y: p.y }; }
  return pos;
}
