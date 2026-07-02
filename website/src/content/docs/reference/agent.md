---
title: agent()
description: A model-owning think→act→observe loop. Carries tools (including sub-agents) and a declared dependency slice.
---

`agent()` builds a [`Step`](/core-concepts/step/) that owns a model loop — unlike [`tool()`](/reference/tool/), it has a `model` and `instructions`, and it decides *how* to get from input to output, calling its `tools` along the way.

## Signature

```ts
export interface Agent<Name, In, Out, Deps, Tools> extends Step<Name, In, Out, Deps> {
  readonly "~kind": "agent";
  readonly model: string;
  /** the concrete tool tuple is PRESERVED (not widened to AnyStep[]) so a
   *  consumer's `ToolDepKeys<typeof agent.tools>` stays precise across .d.ts. */
  readonly tools: Tools;
  readonly run: (input: InferOut<In>, ctx: AgentCtx<Deps>) => Promise<InferOut<Out>>;
}

export function agent<
  const Name extends string,
  In extends IO<any, any>,
  Out extends IO<any, any>,
  const Tools extends readonly AnyStep[] = [],
  const D extends readonly (keyof LoopyDeps)[] = [],
>(def: {
  name: Name;
  model: string;
  instructions: string;
  input: In;
  output: Out;
  tools?: Tools & NoDuplicateTools<Tools>;
  deps?: D;
}): Agent<Name, In, Out, D[number] | ToolDepKeys<Tools>, Tools>;
```

## Fields

- **`model`** — a plain string identifying the model, e.g. `"claude-opus"`, `"haiku"`. loopy doesn't validate this today; it's carried through as-is.
- **`instructions`** — the agent's system prompt / role description.
- **`input` / `output`** — [`IO<...>`](/core-concepts/schemas/) schemas, same as `tool()`.
- **`tools`** — an array of `Tool`s and/or other `Agent`s (see [The Step spine](/core-concepts/step/) for why an agent can be passed here). Defaults to `[]`. Duplicate tool names are a compile error via `NoDuplicateTools` — `tools: [editFile, editFile]` won't type-check.
- **`deps`** — dependencies the agent needs *directly* (beyond whatever its tools already declare). The agent's effective dependency union is `deps[number] | ToolDepKeys<Tools>` — see [Dependency injection](/core-concepts/dependency-injection/).

## Example

```ts
// examples/agents.ts
export const codeGen = agent({
  name: "codeGen",
  model: "sonnet",
  instructions: "Generate code changes in a think→act→observe loop.",
  input: io<{ task: string }>(),
  output: io<{ applied: readonly string[]; failed: readonly string[] }>(),
  // edit/create/read tools + a sub-agent passed where a tool is expected.
  tools: [editFile, createFile, readFile, fileAnalyzer],
  deps: ["repo"],
});
```

## The `passTo` extension (used by `team()`)

On the `feat/team-type-surface` branch — implemented and type-verified, not yet merged into `master` — `agent()` accepts one more field, `passTo`, used exclusively by [`team()`](/reference/team/):

```ts
export function agent<
  // ...
  const Pass extends readonly string[] = [],
>(def: {
  // ...same fields as above...
  passTo?: Pass;
}): Agent<Name, In, Out, D[number] | ToolDepKeys<Tools>, Tools, Pass[number]>;
```

`passTo` declares the names of other agents *within the same team* this agent is allowed to hand off to — at compile time, every name is checked against actual team membership (see [team() → the passTo membership guard](/reference/team/#the-passto-membership-guard)). It doesn't change what an agent looks like outside a team; a plain, standalone `agent()` never needs it.

```ts
// examples/team.ts (feat/team-type-surface)
export const triage = agent({
  name: "triage", model: "opus",
  instructions: "Read the issue; hand to bugFixer or docsWriter.",
  input: io<{ issue: Issue }>(), output: io<{ kind: string }>(),
  passTo: ["bugFixer", "docsWriter"],
});
```

## Next

- [workflow()](/reference/workflow/) — use an agent as one node in an explicit graph.
- [team()](/reference/team/) — use agents as the nodes of a multi-agent loop.
- [Guides → An agent with tools](/guides/agent-with-tools/)
