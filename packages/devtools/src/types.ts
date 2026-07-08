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
export interface TimelineRow {
  seq: number;
  node: string;
  name: string;
  epoch: number;
  depth: number;
  kind: "step" | "model" | "tool" | "interrupt";
  status: "running" | "done" | "errored" | "suspended";
}
export interface StepDetail {
  node: string;
  model: { request: unknown; response: unknown; ok: boolean } | null;
  tools: { tool: string; args: unknown; value: unknown; ok: boolean }[];
  patchedChannels: string[];
  interrupt: { payload: unknown } | null;
}
export interface ViewModel {
  threadId: string | null;
  entry: string | null;
  status: "idle" | "running" | "done" | "errored" | "suspended";
  timeline: TimelineRow[];
  details: Record<string, StepDetail>;
  lastSeq: number;
}
