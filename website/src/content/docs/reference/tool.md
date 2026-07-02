---
title: tool()
description: A model-less capability — declares its dependency slice, runs a body, returns a typed output.
---

`tool()` builds a [`Step`](/core-concepts/step/) with no model attached — it's a plain, deterministic capability that an [`agent()`](/reference/agent/) calls, or that stands alone as a [`workflow()`](/reference/workflow/) node.

## Signature

```ts
export interface Tool<Name, In, Out, Deps> extends Step<Name, In, Out, Deps> {
  readonly "~kind": "tool";
  readonly description: string;
  readonly run: (input: InferOut<In>, ctx: ToolCtx<Deps>) => Promise<InferOut<Out>>;
  /** at-least-once durability contract: crash mid-tool re-issues → idempotency. */
  readonly idempotencyKey?: (input: InferOut<In>) => string;
}

export function tool<
  const Name extends string,
  In extends IO<any, any>,
  Out extends IO<any, any>,
  const D extends readonly (keyof LoopyDeps)[] = [],
>(def: {
  name: Name;
  description: string;
  input: In;
  output: Out;
  deps?: D;
  idempotencyKey?: (input: InferOut<In>) => string;
  run: (input: InferOut<In>, ctx: ToolCtx<D[number]>) => Promise<InferOut<Out>>;
}): Tool<Name, In, Out, D[number]>;
```

## Fields

- **`name`** — a string literal; preserved in the type (not widened to `string`), so it shows up verbatim wherever the tool is used (e.g. as a key in [`agent()`](/reference/agent/)'s `ToolMap`).
- **`description`** — a plain-language description of what the tool does. This is model-facing prose, not documentation for you.
- **`input` / `output`** — [`IO<...>`](/core-concepts/schemas/) schemas built with `io<...>()` (or any Standard-Schema-shaped validator).
- **`deps`** — an array of string-literal keys into [`LoopyDeps`](/core-concepts/dependency-injection/). Defaults to `[]`. Determines exactly what `ctx.deps` exposes inside `run`.
- **`idempotencyKey`** — optional. loopy's durability model is at-least-once: if a process crashes mid-tool-call, the runtime re-issues the call on recovery. A tool whose effect isn't naturally idempotent (e.g. "create a file," "open a PR") should provide `idempotencyKey` so a re-issued call can be recognized and deduplicated, once the runtime implements this.
- **`run`** — the tool's body. Receives the validated input and a [`ToolCtx<Deps>`](/core-concepts/dependency-injection/) (just `{ deps }` for a plain tool — see [Human-in-the-loop](/guides/human-in-the-loop/) for the `interrupt` extension used by [`team()`](/reference/team/)).

## Example

```ts
import { tool, io } from "loopy";
import type { GitRepo } from "./deps";

export const editFile = tool({
  name: "editFile",
  description: "Apply a find/replace edit to a file.",
  input: io<{ path: string; find: string; replace: string }>(),
  output: io<{ applied: boolean }>(),
  deps: ["repo"],
  idempotencyKey: (i) => `edit:${i.path}:${i.find}`,
  run: async (i, { deps }) => {
    const cur = await deps.repo.read(i.path);
    await deps.repo.write(i.path, cur.replace(i.find, i.replace));
    return { applied: true };
  },
});
```

*(from `examples/tools.ts`)*

## Next

- [agent()](/reference/agent/) — pass a tool into an agent's `tools` array.
- [Guides → Writing a tool](/guides/tools/)
