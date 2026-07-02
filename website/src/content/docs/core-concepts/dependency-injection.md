---
title: Dependency injection
description: loopy uses functional dependency injection — no decorators, no globals. Each unit declares the exact slice of dependencies it needs.
---

## The registry: one augmentable interface

loopy has no DI container, no decorators, no `reflect-metadata`. Instead there is a single interface every consumer augments via TypeScript's [declaration merging](https://www.typescriptlang.org/docs/handbook/declaration-merging.html):

```ts
// in loopy itself:
export interface LoopyDeps {}
```

```ts
// examples/deps.ts — in your app, once, at the boundary where you define your dependencies:
export interface GitRepo {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  find(query: string): Promise<readonly string[]>;
}
// ...

declare module "loopy" {
  interface LoopyDeps {
    repo: GitRepo;
    figma: FigmaApi;
    jira: JiraApi;
    vercel: VercelApi;
    git: GitCli;
    gh: GitHubCli;
    shell: Shell;
  }
}
```

After this augmentation, `keyof LoopyDeps` is a literal union of every dependency name your app has declared, and every `deps: [...]` array anywhere in loopy is checked against it, with autocomplete.

## Why deps are *declared*, not inferred

It would be nice if loopy could look at a tool's `run` body, see `deps.repo.read(...)`, and infer that the tool needs `"repo"`. TypeScript can't do that — inference only flows *into* a function body from its declared parameter types, never *out of* usage inside the body. So loopy makes the honest trade: **you declare the dependency slice a unit needs, as an array of string-literal keys into `LoopyDeps`**, and everything downstream (`ctx.deps`, an agent's accumulated dependency union, the registry's required-dependency set) is derived from that declaration with `Pick`, `|`, and `Exclude` — no runtime reflection anywhere.

```ts
// examples/tools.ts
export const editFile = tool({
  name: "editFile",
  description: "Apply a find/replace edit to a file.",
  input: io<{ path: string; find: string; replace: string }>(),
  output: io<{ applied: boolean }>(),
  deps: ["repo"],
  run: async (i, { deps }) => {
    // deps : Pick<LoopyDeps, "repo">  — deps.figma here would be TS2339
    const cur = await deps.repo.read(i.path);
    await deps.repo.write(i.path, cur.replace(i.find, i.replace));
    return { applied: true };
  },
});
```

`ctx.deps` inside `run` has type `Pick<LoopyDeps, D>`, where `D` is exactly the `deps` array you wrote — not `LoopyDeps` in full. Reach for a dependency you didn't declare and TypeScript rejects it immediately, before anything runs:

```ts
export interface ToolCtx<D extends keyof LoopyDeps> {
  readonly deps: Pick<LoopyDeps, D>;
}
```

## Dependencies accumulate up the chain

An agent's dependency requirement is the union of its own declared `deps` *and* every dependency its tools — including sub-agents used as tools — declare:

```ts
export type ToolDepKeys<T extends readonly AnyStep[]> = NonNullable<T[number]["~deps"]>;
```

```ts
// examples/agents.ts
export const codeGen = agent({
  name: "codeGen",
  // ...
  tools: [editFile, createFile, readFile, fileAnalyzer], // fileAnalyzer also declares "repo"
  deps: ["repo"],
});
// codeGen's full dependency union is exactly "repo" — not widened, not missing anything.
```

That union keeps climbing all the way up to [the registry](/reference/registry/), which refuses to type `run` until every dependency required by everything registered has actually been supplied.

## Next

- [Channels & state](/core-concepts/channels-and-state/)
- [API Reference → Registry](/reference/registry/)
