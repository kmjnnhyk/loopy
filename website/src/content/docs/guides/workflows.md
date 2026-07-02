---
title: "Guide: a deterministic workflow"
description: Build a two-phase workflow with retry cycles and branching, using state channels and a typed router.
---

This guide builds `designFlow`, from `examples/workflows.ts` — a workflow that fetches a Figma design, generates code, builds, and retries on failure, all as *your* code's decision, not the model's.

## 1. Declare the state

State is a record of [channels](/core-concepts/channels-and-state/), one per thing the workflow's router needs to see:

```ts
import { workflow, lastChannel, io, END } from "loopy";

const state = {
  figma: lastChannel<FigmaData | null>(null),
  build: lastChannel<{ ok: boolean } | null>(null),
  deploy: lastChannel<DeployResult | null>(null),
};
```

Each of these is a "last write wins" slot — the router only ever cares about the most recent build result, not a history of every attempt.

## 2. Declare every node up front with `.nodes(...)`

```ts
const flow = workflow({
  name: "designFlow",
  state,
  input: io<{ message: string }>(),
  output: io<{ prUrl: string }>(),
}).nodes({ fetchFigma, fileAnalyzer, codeGen, build, verify: verifier, push, deploy: waitForDeploy });
```

A node can be a `tool()`, an `agent()` (`verify: verifier` renames the `verifier` agent to the node name `"verify"`), or an inline `step()` (`build`, `push` — see below). Declaring the full node set before wiring any edges is what lets the next step reference *any* node, in any order, including ones that come "after" in the chain — no forward-reference errors.

## 3. Wire the graph, including retry cycles

```ts
const designFlow = flow.flow((b) =>
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

`.branch("build", (s) => ...)` is where the retry loop lives: if the build failed, go back to `codeGen` and try again; loopy doesn't distinguish a cycle from any other edge — it's just a router returning a name that happens to point backward. `s` here is `StateOf<typeof state>`, so `s.build?.ok` is a real, narrowable property access.

Try a typo — `.branch("build", (s) => (s.build?.ok ? "verfy" : "codeGen"))` — and you get `TS2820`, with a "did you mean 'verify'?" suggestion, because the router's return type is the exact literal union of node names.

## 4. Inline steps for plain logic

Not every node needs to be a tool or an agent. `build` and `push` here are inline `step()`s — plain functions with declared deps, same shape as a tool but defined right where they're used:

```ts
import { step } from "loopy";

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

## Result

`designFlow` requires exactly the union of dependencies its nodes declare (`"repo"` from `build`, plus whatever `fetchFigma`, `push`, and `deploy` need), computed by `NodeDepKeys` — see [Dependency injection](/core-concepts/dependency-injection/). Register it with [`defineLoopy`](/reference/registry/) alongside your agents.

## Next

- [Human-in-the-loop](/guides/human-in-the-loop/) — the same `step()`/`.nodes().flow()` shape, but with a node that pauses for a human.
- [API Reference → workflow()](/reference/workflow/)
