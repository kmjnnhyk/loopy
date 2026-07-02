---
title: An agent with tools
description: Build an agent that calls tools — and pass a sub-agent into its tools array to see composition for free.
---

This guide builds `codeGen`, an agent from `examples/agents.ts` that owns a think→act→observe loop over a small toolset — including another agent used as a tool.

## 1. Start with the tools it needs

Assume `editFile`, `createFile`, and `readFile` already exist (see [Guide: writing a tool](/guides/tools/)) — three ordinary `tool()`s that all declare `deps: ["repo"]`.

## 2. Define a plain agent first

```ts
import { agent, io } from "loopy";

export const fileAnalyzer = agent({
  name: "fileAnalyzer",
  model: "haiku",
  instructions: "Identify the files relevant to a goal.",
  input: io<{ goal: string }>(),
  output: io<{ paths: readonly string[] }>(),
  deps: ["repo"],
});
```

`fileAnalyzer` has no `tools` of its own — it's a small, focused agent whose whole job is "given a goal, decide which files matter." It still declares `deps: ["repo"]` because its instructions presumably tell it to look at the repo, even though there's no explicit tool call visible in this type signature. The model loop implementation, once it exists, is what actually performs that lookup.

## 3. Build the agent that uses it — as a tool

```ts
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

`fileAnalyzer` sits in the `tools` array right next to real tools, with no wrapper or adapter. This works because `Agent` and `Tool` are both structurally a [`Step`](/core-concepts/step/) — see [The Step spine](/core-concepts/step/) for exactly why the type system allows it. Conceptually, `codeGen` can delegate "which files are relevant?" to `fileAnalyzer` the same way it'd call any other tool. `fileAnalyzer`'s own model loop then runs to answer it.

## 4. Check what got inferred

```ts
import type { ToolDepKeys } from "loopy";

type CodeGenToolDeps = ToolDepKeys<typeof codeGen.tools>;
// = "repo" — accumulated from editFile, createFile, readFile, AND fileAnalyzer,
//   even though fileAnalyzer is an Agent, not a Tool.
```

This is checked as a real compile-assertion in `examples/consumer.ts` — `ToolDepKeys<typeof codeGen.tools>` really does resolve to exactly `"repo"`, not `unknown` and not the union of every dependency in your app.

## 5. Duplicate names are caught at the call site

```ts
agent({
  name: "codeGen",
  // ...
  tools: [editFile, editFile], // ❌ compile error — NoDuplicateTools brands this call
  // ...
});
```

Two tools with the same `name` would otherwise collide silently inside the agent's internal tool map. `NoDuplicateTools` turns that into a compile-time rejection instead.

## Next

- [A deterministic workflow](/guides/workflows/) — use `codeGen` as one node in an explicit graph, with retry cycles.
- [API Reference → agent()](/reference/agent/)
