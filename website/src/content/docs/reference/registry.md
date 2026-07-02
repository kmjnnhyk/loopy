---
title: "Registry: defineLoopy / loopy"
description: The registry converges the dependency requirements of everything registered, then types run() so it only compiles once every dependency is supplied.
---

## `defineLoopy(def)` — deps supplied up front

```ts
export type RunFn<Reg> = <Name extends keyof Reg>(
  name: Name,
  input: InputOf<Reg[Name]>,
) => Promise<OutputOf<Reg[Name]>>;

export interface Runtime<Reg> {
  readonly run: RunFn<Reg>;
}

export function defineLoopy<
  const A extends Record<string, AnyEntry>,
  const W extends Record<string, AnyEntry>,
>(def: {
  agents: A;
  workflows: W & NoKeyCollision<A, W>;
  deps: Pick<LoopyDeps, RequiredDeps<A & W>>;
}): Runtime<A & W>;
```

`defineLoopy` takes every agent and workflow you want runnable, plus the concrete dependency instances they collectively need. `RequiredDeps<A & W>` is the union of every dependency any registered agent or workflow declares (directly or via their tools) — `deps` has to satisfy exactly that `Pick`, no more, no less. Omit one and the error names it:

```ts
// examples/_negative.ts — expect TS2741
export const badRuntime = defineLoopy({
  agents: { classifier, sufficiency, fileAnalyzer, verifier, codeGen },
  workflows: { designFlow, jiraFlow },
  deps: { repo, figma, jira, vercel, git, gh }, // "shell" omitted
});
// → TS2741: Property 'shell' is missing in type '{...}' but required in type 'Pick<LoopyDeps, ...>'.
```

`agents` and `workflows` can't share a key — `NoKeyCollision<A, W>` brands the `workflows` param with a compile error naming the collision, because `InputOf<Agent & Workflow>` would otherwise silently resolve to only one side.

### Calling `run`

```ts
export const runtime = defineLoopy({
  agents: { classifier, sufficiency, fileAnalyzer, verifier, codeGen },
  workflows: { designFlow, jiraFlow },
  deps: { repo, figma, jira, vercel, git, gh, shell },
});

await runtime.run("designFlow", { message: "add /healthz" }); // : Promise<{ prUrl: string }>
await runtime.run("typo", {});                                 // TS2322 — autocompletes the real names
```

`run`'s `name` parameter is `keyof Reg`, and its `input`/return types are looked up per-entry via `InputOf`/`OutputOf` — a typo'd registry name is a compile error with autocomplete, not a runtime "not found."

## Progressive injection: `loopy(def).provide(...)`

```ts
export type RunBlocked<Missing extends keyof LoopyDeps> = {
  readonly "~missingDeps": Missing;
};

export interface Loopy<Reg, Missing extends keyof LoopyDeps> {
  provide<P extends Partial<Pick<LoopyDeps, Missing>>>(
    deps: P,
  ): Loopy<Reg, Exclude<Missing, keyof P>>;
  readonly run: [Missing] extends [never] ? RunFn<Reg> : RunBlocked<Missing>;
}

export function loopy<A, W>(def: { agents: A; workflows: W & NoKeyCollision<A, W> }): Loopy<A & W, RequiredDeps<A & W>>;
```

`loopy({...})` defers dependency injection: it returns a builder whose `Missing` type parameter starts as *every* required dependency and shrinks with each `.provide(...)` call. `run` is only callable — its type collapses from the `RunBlocked` error shape to the real `RunFn` — once `Missing` has shrunk to `never`. This lets you split dependency wiring across multiple `.provide(...)` calls (e.g. one at app boot, one per-request):

```ts
// examples/loopy.ts
export const deferred = loopy({
  agents: { classifier, sufficiency, fileAnalyzer, verifier, codeGen },
  workflows: { designFlow, jiraFlow },
})
  .provide({ repo, figma, jira, vercel })
  .provide({ git, gh, shell });

await deferred.run("designFlow", { message: "x" }); // only compiles after both .provide calls
```

## `team()` in the registry

On the `feat/team-type-surface` branch, `defineLoopy` additionally accepts a `teams` field, converging its dependency requirements into the same `RequiredDeps` union as `agents`/`workflows` — see [team()](/reference/team/#registering-a-team).

## Next

- [Dependency injection](/core-concepts/dependency-injection/) — how `RequiredDeps` is derived.
- [team()](/reference/team/)
