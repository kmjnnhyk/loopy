---
title: workflow()
description: An explicit graph of Step nodes with a typed, data-driven router — built in two phases so node names never leak forward.
---

`workflow()` builds a `Step`-graph where *you* decide the control flow: which node runs next is a function of typed state, not a model's judgement.

## Signature — two phases

```ts
export function workflow<Name, State, In, Out>(def: {
  name: Name;
  state: State;
  input: In;
  output: Out;
}): WorkflowInit<Name, State, In, Out>;

interface WorkflowInit<Name, State, In, Out> {
  nodes<const Nodes extends Record<string, AnyStep>>(
    nodes: Nodes,
  ): WorkflowNodes<Name, State, In, Out, Extract<keyof Nodes, string>, NodeDepKeys<Nodes>>;
}

interface WorkflowNodes<Name, State, In, Out, NodeName, Deps> {
  flow(
    build: (b: FlowBuilder<StateOf<State>, NodeName>) => FlowBuilder<StateOf<State>, NodeName>,
  ): Workflow<Name, State, In, Out, Deps>;
}

interface FlowBuilder<S, NodeName extends string> {
  start(node: NodeName): FlowBuilder<S, NodeName>;
  edge(from: NodeName, to: NodeName | END): FlowBuilder<S, NodeName>;
  branch(from: NodeName, router: (s: S) => NodeName | END): FlowBuilder<S, NodeName>;
}
```

`workflow(...)` alone returns a builder that only exposes `.nodes(...)`. Calling `.nodes({...})` — a **record of every node up front** — is what lets `.flow(...)` reference any node name in any order, including cycles and back-edges. That's what avoids a "used before declared" error. (An earlier fluent `.step(...).branch(...)` shape was tried and dropped for exactly this reason: `.branch` couldn't see a node declared later in the same chain.)

## `FlowBuilder`

- **`.start(node)`** — the entry node.
- **`.edge(from, to)`** — an unconditional transition. `to` can be another node name or [`END`](/reference/registry/).
- **`.branch(from, router)`** — a conditional transition. `router` receives the current [`StateOf<State>`](/core-concepts/channels-and-state/) snapshot and returns the next node name or `END`. A typo'd return value is a compile error (`TS2820`, with a "did you mean...?" suggestion when one node name is close to another).

Both `.edge` and `.branch` constrain `from`/`to`/the router's return type to the exact literal union of node names declared in `.nodes({...})` — nothing stringly-typed.

## Example — cycles via `.branch`

```ts
// examples/workflows.ts
export const designFlow = workflow({
  name: "designFlow",
  state: {
    figma: lastChannel<FigmaData | null>(null),
    build: lastChannel<{ ok: boolean } | null>(null),
    deploy: lastChannel<DeployResult | null>(null),
  },
  input: io<{ message: string }>(),
  output: io<{ prUrl: string }>(),
})
  .nodes({ fetchFigma, fileAnalyzer, codeGen, build, verify: verifier, push, deploy: waitForDeploy })
  .flow((b) =>
    b
      .start("fetchFigma")
      .edge("fetchFigma", "fileAnalyzer")
      .edge("fileAnalyzer", "codeGen")
      .edge("codeGen", "build")
      .branch("build", (s) => (s.build?.ok ? "verify" : "codeGen")) // build↔codeGen cycle
      .branch("verify", (s) => (s.figma ? "push" : "codeGen")) // verify↔codeGen cycle
      .edge("push", "deploy")
      .edge("deploy", END),
  );
```

A node can be any [`Step`](/core-concepts/step/) — a `tool()`, an `agent()` (`verify: verifier` above is an agent), or an inline `step()`:

```ts
const build = step({
  name: "build",
  input: io<{ paths: readonly string[] }>(),
  output: io<{ ok: boolean; log: string }>(),
  deps: ["repo"],
  run: async (_i, { deps }) => {
    void deps;
    return { ok: true, log: "OK" };
  },
});
```

`step()`'s run context, `NodeCtx`, is the same as a tool's `ToolCtx` plus one extra capability — `interrupt` — covered in [Human-in-the-loop](/guides/human-in-the-loop/).

## Next

- [Channels & state](/core-concepts/channels-and-state/) — the `state` object every workflow router reads.
- [Guides → A deterministic workflow](/guides/workflows/)
- [team()](/reference/team/) — the same `.nodes().flow()`-shaped machinery, specialized for agents.
