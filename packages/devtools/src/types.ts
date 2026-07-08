export interface GraphNode {
  name: string;
  kind: string;
  state: "idle" | "running" | "visited" | "errored";
}
export interface GraphEdge {
  from: string;
  to: string;
  observed: boolean;
  conditional: boolean;
}
export interface GraphModel {
  start: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
}
