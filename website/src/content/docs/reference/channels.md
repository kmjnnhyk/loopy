---
title: Channels
description: lastChannel, listChannel, and inputChannel — the typed state slots workflows and teams fold updates into.
---

See [Core Concepts → Channels & state](/core-concepts/channels-and-state/) for the full explanation of *why* state is modeled this way. This page is the terse signature reference.

## `Channel<V, U>`

```ts
export interface Channel<V, U = V> {
  readonly "~value": V;
  readonly "~update": U;
  readonly reduce: (current: V, update: U) => V;
  readonly initial: () => V;
}

export type StateOf<C> = { readonly [K in keyof C]: C[K] extends Channel<infer V, any> ? V : never };
```

## `lastChannel(init)`

```ts
export function lastChannel<T>(init: T): Channel<T, T>;
```

Overwrite semantics — each update replaces the current value.

```ts
const review = lastChannel<ReviewResult | null>(null);
```

## `listChannel()`

```ts
export function listChannel<T>(): Channel<readonly T[], T | readonly T[]>;
```

Append semantics — accepts either a single item or an array, and appends. Starts at `[]`.

```ts
const transcript = listChannel<Msg>();
```

## `inputChannel()`

```ts
export interface InputChannel<T> extends Channel<T, T> {
  readonly "~input": true;
}
export function inputChannel<T>(): InputChannel<T>;
```

Same overwrite semantics as `lastChannel`, but with no static `init` value — it's seeded by whatever input a [`team()`](/reference/team/) run is actually called with. It's branded with `"~input": true` so `TeamInputOf<State>` can pick these channels out of a team's `state` record to derive the run's input shape:

```ts
export type TeamInputOf<State> = {
  readonly [K in keyof State as State[K] extends InputChannel<any> ? K : never]:
    State[K] extends InputChannel<infer T> ? T : never;
};
```

```ts
const issue = inputChannel<Issue>();
```

## `END`

```ts
export const END: "~end" = "~end";
export type END = typeof END;
```

The sentinel a [`workflow()`](/reference/workflow/) `.branch`/`.edge` target, or a [`team()`](/reference/team/) `.router`, returns to terminate a run.

## Next

- [Core Concepts → Channels & state](/core-concepts/channels-and-state/)
- [workflow()](/reference/workflow/) · [team()](/reference/team/)
