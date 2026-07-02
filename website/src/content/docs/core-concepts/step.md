---
title: The Step spine
description: Every unit in loopy — a tool, an agent, a workflow node, a team member — reduces to one shape, a Step.
---

## One primitive, four faces

Every named unit in loopy — a tool, an agent, a node inside a workflow, an agent inside a team — is structurally the same thing:

```ts
interface Step<
  Name extends string,
  In extends IO<any, any>,
  Out extends IO<any, any>,
  Deps extends keyof LoopyDeps,
> {
  readonly name: Name;
  readonly input: In;
  readonly output: Out;
  readonly run: (input: InferOut<In>, ctx: any) => Promise<InferOut<Out>>;
}
```

A `Step` has a name, a typed input, a typed output, and a `run` function. That's it. `tool()`, `agent()`, and workflow `step()` nodes all return something that satisfies `Step`, which is why they compose for free:

| Primitive | What it is | Control |
|---|---|---|
| [`tool()`](/reference/tool/) | A model-less capability. Declares its deps; runs a body. | your code |
| [`agent()`](/reference/agent/) | A model-owning loop. Carries tools (incl. sub-agents) + handoff names. | the model |
| [`workflow()`](/reference/workflow/) | Arbitrary Step nodes + a typed, data-driven router. | your code |
| [`team()`](/reference/team/) | Agents-as-nodes + a shared transcript + handoff sugar. | hybrid |

## Why this matters: an agent can stand in for a tool

Because `Agent` extends `Step` the same way `Tool` does, an agent can be passed anywhere a tool is expected. That's a "sub-agent as tool," with no adapter:

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

`fileAnalyzer` above is itself an `agent()` — not a `tool()` — but it slots into `tools: [...]` next to real tools without any wrapper. `ToolDepKeys` is the type that folds every tool's declared dependencies into the agent's own dependency union. It distributes over the tuple regardless of whether an entry is a `Tool` or an `Agent`, so `codeGen`'s inferred dependency requirement (`"repo"`) is correct even though one of its "tools" is a whole other agent.

## The `AnyStep` upper bound

Collections like `tools: readonly AnyStep[]` need an upper-bound type loose enough to accept every concrete `Tool<Name, In, Out, Deps>` and `Agent<Name, In, Out, Deps, Tools>`, whatever their specific input/output schemas are:

```ts
export type AnyStep = Step<string, IO<any, any>, IO<any, any>, keyof LoopyDeps>;
```

The schema slots are widened to `IO<any, any>`, not to a concrete Standard-Schema type. That looks like giving up type safety, but it's the opposite. TypeScript checks a function *parameter* contravariantly, so a bound built from a concrete schema type collapses every real tool's `run` to `(input: unknown, ...) => ...` and then rejects it — the bound would be *too narrow* to hold any real tool. `any` is bidirectionally compatible and sidesteps that variance trap. This only loosens the structural upper bound used to collect a heterogeneous list. The concrete `Tool<...>` / `Agent<...>` types that `tool()` / `agent()` actually return stay fully precise.

## Next

- [Schemas (IO)](/core-concepts/schemas/) — how `io<Out, In>()` carries a static type through a runtime-agnostic validator.
- [Dependency injection](/core-concepts/dependency-injection/) — how `deps` are declared, not inferred.
- [API Reference → tool()](/reference/tool/)
