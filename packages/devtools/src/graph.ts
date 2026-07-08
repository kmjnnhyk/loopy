import { END } from "@loopyjs/core";
import type { RuntimeEvent, DevTopology } from "@loopyjs/core";
import type { GraphModel, GraphNode, GraphEdge } from "./types.ts";

export function parseScope(node: string): { name: string; epoch: number; depth: number } {
  if (node === "") return { name: "", epoch: 0, depth: 0 };
  const segs = node.split("/");
  const leaf = segs[segs.length - 1]!;
  const [name, epoch] = leaf.split("#");
  return { name: name!, epoch: Number(epoch ?? "0"), depth: segs.length };
}

const edgeKey = (from: string, to: string) => `${from}->${to}`;

// The workflow END sentinel ("~end") has no corresponding topology node — normalize
// it to a stable "END" display name so it can be rendered as a real terminal node
// instead of producing an edge whose target doesn't exist.
const normalizeTarget = (name: string) => (name === END ? "END" : name);

/** Build the top-level (depth-1) graph: static skeleton from topology, overlaid
 *  with observed node states + observed edges from the event log. Branch targets
 *  are added ONLY when observed — never guessed — so dynamic routers can't produce
 *  phantom edges. */
export function buildGraphModel(topology: DevTopology | null, events: readonly RuntimeEvent[]): GraphModel {
  const nodes = new Map<string, GraphNode>();
  const branchSources = new Set(topology?.branchSources ?? []);
  const staticEdges = new Set((topology?.edges ?? []).map((e) => edgeKey(e.from, normalizeTarget(e.to))));

  // 1. seed static skeleton
  for (const n of topology?.nodes ?? []) nodes.set(n.name, { name: n.name, kind: n.kind, state: "idle" });

  // 2. walk depth-1 events → node states + observed transitions
  const edges = new Map<string, GraphEdge>();
  const ensure = (name: string): GraphNode => {
    let n = nodes.get(name);
    if (!n) { n = { name, kind: "step", state: "idle" }; nodes.set(name, n); }
    return n;
  };
  let prevEnded: string | null = null;
  let inFlight: string | null = null;
  for (const e of events) {
    if (e.type === "RunErrored") { if (inFlight) ensure(inFlight).state = "errored"; continue; }
    const { name, depth } = parseScope(e.node);
    if (depth !== 1) continue; // v1 graph = top level only (nested drill-down deferred)
    if (e.type === "StepStarted") {
      ensure(name).state = "running";
      inFlight = name;
      if (prevEnded && prevEnded !== name) {
        const key = edgeKey(prevEnded, name);
        const conditional = branchSources.has(prevEnded) && !staticEdges.has(key);
        edges.set(key, { from: prevEnded, to: name, observed: true, conditional });
      }
    } else if (e.type === "StepEnded") {
      ensure(name).state = "visited";
      inFlight = null;
      prevEnded = name;
    }
  }

  // 3. merge static (declared, not-yet-observed) edges. END never StepStarts, so it
  //    can only ever arrive here (never via the observed-transition walk above) —
  //    normalize its target to the synthetic "END" node so no edge dangles.
  for (const e of topology?.edges ?? []) {
    const to = normalizeTarget(e.to);
    if (to === "END" && !nodes.has("END")) nodes.set("END", { name: "END", kind: "end", state: "idle" });
    const key = edgeKey(e.from, to);
    if (!edges.has(key)) edges.set(key, { from: e.from, to, observed: false, conditional: false });
  }

  return { start: topology?.start ?? null, nodes: [...nodes.values()], edges: [...edges.values()] };
}
