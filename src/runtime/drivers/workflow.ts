import { END } from "../../index";
import { rawChannel, type ChannelRecord, type StateSnapshot } from "../channels";
import type { Driver, KernelCtx, RunnableNode } from "../scheduler";
import type { RuntimeCtx, ToolLike } from "../effects";

export interface RtStep {
  readonly name: string;
  readonly "~kind"?: string;
  readonly run: (i: never, c: never) => Promise<unknown>;
  readonly "~depKeys"?: readonly string[];
}
export type AgentNodeFactory = (agent: RtStep) => RunnableNode;

interface GraphRt {
  readonly nodes: Record<string, { step: RtStep; reads?: (s: unknown) => unknown; writes?: string }>;
  readonly start: string;
  readonly edges: Record<string, string>;
  readonly branches: Record<string, (s: unknown) => string>;
  readonly returns: ((s: unknown) => unknown) | null;
}
export interface AnyWorkflowRt {
  readonly name: string;
  readonly state: ChannelRecord;
  readonly "~graph": GraphRt;
}

export function workflowDriver(wf: AnyWorkflowRt, agentNode?: AgentNodeFactory): Driver {
  const g = wf["~graph"];
  const channels: ChannelRecord = { ...wf.state, input: rawChannel() };

  const makeNode = (name: string): RunnableNode => {
    const bound = g.nodes[name];
    if (!bound) throw new Error(`workflow "${wf.name}": unknown node "${name}"`);
    const reads = bound.reads ?? ((s: unknown) => s);
    if (bound.step["~kind"] === "agent") {
      if (!agentNode) throw new Error(`workflow "${wf.name}": node "${name}" is an agent — agent driver not wired (Task 12/13)`);
      const inner = agentNode(bound.step);
      return { reads: (s: StateSnapshot) => reads(s), run: inner.run.bind(inner) };
    }
    return {
      reads: (s: StateSnapshot) => reads(s),
      // tool과 inline step 공히 단일 effect로 기록 — step 본문의 deps I/O까지 memo 경계 안.
      run: (input: unknown, ctx: RuntimeCtx, _k: KernelCtx, _scope: string) =>
        ctx.callTool(bound.step as ToolLike, input),
    };
  };

  return {
    channels,
    seed: (input: unknown) => ({ input }),
    next: (state: StateSnapshot, lastNode: string | null) => {
      if (lastNode === null) return g.start;
      const branch = g.branches[lastNode];
      if (branch) return branch(state) as string | typeof END;
      const edge = g.edges[lastNode];
      if (edge === undefined) throw new Error(`workflow "${wf.name}": no edge or branch from "${lastNode}"`);
      return edge as string | typeof END;
    },
    onSelected: () => null,
    node: makeNode,
    updatesFor: (name: string, output: unknown) => {
      const w = g.nodes[name]?.writes;
      return w ? { [w]: output } : {};
    },
    output: (state: StateSnapshot) => {
      if (!g.returns) throw new Error(`workflow "${wf.name}" needs .returns() to be runnable`);
      return g.returns(state);
    },
    // v1: no iteration cap for workflows — unlike agent maxSteps / team maxTurns,
    // router termination (an edge/branch reaching END) is the author's responsibility.
    guard: () => {},
  };
}
