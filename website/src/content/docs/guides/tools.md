---
title: "Guide: writing a tool"
description: Build a tool step by step — declare a dependency, write a body, and understand the idempotency contract.
---

This guide walks through building one real tool, `editFile`, from `examples/tools.ts`.

## 1. Declare your dependencies once

Before writing any tool, your app declares its dependencies by augmenting `LoopyDeps`:

```ts
// deps.ts
export interface GitRepo {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  find(query: string): Promise<readonly string[]>;
}

declare module "loopy" {
  interface LoopyDeps {
    repo: GitRepo;
  }
}
```

This is a one-time step per dependency — see [Dependency injection](/core-concepts/dependency-injection/) for why loopy requires it to be explicit rather than inferred.

## 2. Shape the input and output

A tool's `input`/`output` are [`IO<...>`](/core-concepts/schemas/) schemas. For the prototype, `io<T>()` gives you a static type with an identity validator:

```ts
import { io } from "loopy";

const input = io<{ path: string; find: string; replace: string }>();
const output = io<{ applied: boolean }>();
```

## 3. Write the tool

```ts
import { tool, io } from "loopy";

export const editFile = tool({
  name: "editFile",
  description: "Apply a find/replace edit to a file.",
  input: io<{ path: string; find: string; replace: string }>(),
  output: io<{ applied: boolean }>(),
  deps: ["repo"],
  run: async (i, { deps }) => {
    const cur = await deps.repo.read(i.path);
    await deps.repo.write(i.path, cur.replace(i.find, i.replace));
    return { applied: true };
  },
});
```

`deps: ["repo"]` is what makes `deps.repo` available inside `run`. Try `deps.figma` here — a dependency this tool never declared — and TypeScript rejects it with `TS2339`, at the call site, before anything runs.

## 4. Add an `idempotencyKey` for non-idempotent effects

loopy's durability model is at-least-once: a tool call that crashes mid-flight gets re-issued on recovery. `editFile`'s replace-in-place is naturally safe to run twice — in the common case, the same find/replace applied to already-edited content is a no-op the second time. A tool like `createFile` isn't: running it twice could double-create or clobber. Declare `idempotencyKey` so a re-issued call can be recognized once the runtime implements deduplication:

```ts
export const editFile = tool({
  // ...
  idempotencyKey: (i) => `edit:${i.path}:${i.find}`,
  // ...
});
```

Think of the key as "what makes this call the *same* call if it happens again." It's usually a stable hash of the meaningfully-identifying input fields, not the whole input object.

## Result

`editFile` is a fully typed [`Step`](/core-concepts/step/). Its `name` is preserved as the literal `"editFile"`, its dependency requirement is exactly `"repo"`, and its `run` signature is `(input: { path: string; find: string; replace: string }, ctx: ToolCtx<"repo">) => Promise<{ applied: boolean }>`. It can now be passed into an [`agent()`](/reference/agent/)'s `tools` array or used directly as a [`workflow()`](/reference/workflow/) node.

## Next

- [An agent with tools](/guides/agent-with-tools/) — put `editFile` to work inside a model loop.
- [API Reference → tool()](/reference/tool/)
