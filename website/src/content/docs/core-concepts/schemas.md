---
title: Schemas (IO)
description: loopy carries static types through a vendor-neutral, Standard-Schema-shaped carrier called IO.
---

## The problem: a static type across a runtime boundary

A tool's input and output need two things at once: a **static TypeScript type** the compiler can check against, and — eventually — a **runtime validator** that can coerce whatever an LLM actually hands back (malformed JSON, markdown fences, a trailing comma) into that type. loopy solves this with a single carrier type, `IO`, shaped like the [Standard Schema](https://standardschema.dev/) spec, so any validator library that implements it (Zod, Valibot, ArkType, ...) can be dropped in without loopy depending on any of them.

```ts
export interface IO<In, Out = In> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => { readonly value: Out } | { readonly issues: readonly { readonly message: string }[] };
    readonly types?: { readonly input: In; readonly output: Out };
  };
}

export type InferIn<S extends IO<any, any>> = NonNullable<S["~standard"]["types"]>["input"];
export type InferOut<S extends IO<any, any>> = NonNullable<S["~standard"]["types"]>["output"];
```

The static `In`/`Out` types live in a **phantom property** (`~standard.types`) — it's never actually populated at runtime; it exists purely so `InferIn<S>` / `InferOut<S>` can pull the type back out with an indexed access. Every place in loopy that needs "the actual TypeScript type this schema describes" — a tool's `run` parameter, a workflow node's return type — goes through `InferOut<...>`, never the schema object itself.

## `io<Out, In>()` — the current placeholder constructor

The prototype ships a minimal constructor so the type surface is fully exercised without pulling in a real validator dependency:

```ts
export function io<Out, In = Out>(vendor: string = "loopy"): IO<In, Out> {
  return {
    "~standard": {
      version: 1,
      vendor,
      validate: (value: unknown): { readonly value: Out } => ({ value: value as Out }),
    },
  };
}
```

`io<{ path: string; patch: string }>()` gives you a schema whose static output type is `{ path: string; patch: string }`; at runtime, `validate` is currently an identity cast, not real validation — consistent with the rest of the repository being a type-only skeleton (see [Status & Roadmap](/status-roadmap/)). When the runtime lands, this is the seam where real coercion of LLM output into a schema (with typed parse errors instead of silent fail-open) plugs in, without changing `InferOut<S>` or anything downstream of it.

## Using it

```ts
import { io } from "loopy";

const input = io<{ path: string; find: string; replace: string }>();
const output = io<{ applied: boolean }>();
```

Every [`tool()`](/reference/tool/), [`agent()`](/reference/agent/), and workflow node takes an `input` and `output` schema built with `io<...>()` — or, once a real validator is wired in, a Zod/Valibot/ArkType schema implementing the same `~standard` shape.

## Next

- [Dependency injection](/core-concepts/dependency-injection/)
- [API Reference → tool()](/reference/tool/)
