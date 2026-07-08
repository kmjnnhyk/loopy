import { useEffect, useState } from "react";
import { ReactFlow, Background, Controls } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { DevTopology } from "@loopyjs/core";
import { buildGraphModel } from "../../src/graph.ts";
import type { ViewModel } from "../../src/types.ts";
import type { DevClient } from "../client.ts";
import { layout } from "../layout.ts";

const stateColor = (s: string) =>
  s === "running" ? "var(--color-warning)" :
  s === "visited" ? "var(--color-success)" :
  s === "errored" ? "var(--color-error)" : "var(--color-background-surface)";

export function GraphPane({ vm, client, selected, onSelect, scrub }:
  { vm: ViewModel; client: DevClient; selected: string | null; onSelect: (n: string) => void; scrub?: number }) {
  const [topo, setTopo] = useState<DevTopology | null>(null);
  useEffect(() => {
    if (!vm.entry) return;
    fetch(`/api/topology/${encodeURIComponent(vm.entry)}`).then((r) => r.json()).then(setTopo).catch(() => setTopo(null));
  }, [vm.entry]);

  const events = scrub === undefined ? client.events() : client.events().filter((e) => e.seq <= scrub);
  const model = buildGraphModel(topo, events);
  const pos = layout(model);
  const selName = selected ? selected.split("/").pop()!.split("#")[0] : null;

  const nodes = model.nodes.map((n) => ({
    id: n.name, position: pos[n.name] ?? { x: 0, y: 0 },
    data: { label: n.name },
    style: { background: stateColor(n.state), border: n.name === selName ? "2px solid var(--color-accent)" : "1px solid var(--color-border)", borderRadius: 6, padding: 4, width: 120 },
  }));
  const edges = model.edges.map((e) => ({
    id: `${e.from}->${e.to}`, source: e.from, target: e.to, animated: !e.observed,
    style: { strokeDasharray: e.observed ? undefined : "4 4", stroke: e.conditional ? "var(--color-border-blue)" : "var(--color-border)" },
  }));

  return (
    <div style={{ height: "100%" }}>
      <ReactFlow nodes={nodes} edges={edges} fitView
        onNodeClick={(_, n) => {
          const row = vm.timeline.find((r) => r.name === n.id && r.depth === 1);
          if (row) onSelect(row.node);
        }} >
        <Background /><Controls />
      </ReactFlow>
    </div>
  );
}
