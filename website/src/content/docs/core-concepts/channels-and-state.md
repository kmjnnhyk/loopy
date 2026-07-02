---
title: Channels & state
description: State in loopy is a record of typed channels, each with a declared reducer. Workflows and teams fold updates into channels; routers branch on the typed snapshot.
---

## State is channels, not variables

A workflow — and a team, which is built on the same machinery — doesn't have "variables"; it has **channels**. Each channel is a named slot with a value type, an update type, and a reducer that folds an incoming update into the current value:

```ts
export interface Channel<V, U = V> {
  readonly "~value": V;
  readonly "~update": U;
  readonly reduce: (current: V, update: U) => V;
  readonly initial: () => V;
}
```

`V` and `U` can differ — `listChannel`'s value is `readonly T[]`, but you can hand it either one new item or a batch. A node doesn't mutate state directly; it returns updates, and the runtime folds each one through its channel's `reduce`. This is why the design describes the whole engine as one invariant: **`state = fold(reduce, log, initial)`**. The live state a router reads is a cache of that fold; the append-only event log underneath is the only real authority. That invariant is also what makes [event-sourced replay](/core-concepts/event-sourcing/) possible once the runtime exists — replaying a log is just re-running the same fold.

## The three channel constructors

```ts
export function lastChannel<T>(init: T): Channel<T, T> {
  return { /* ... */ reduce: (_c, u) => u, initial: () => init };
}

export function listChannel<T>(): Channel<readonly T[], T | readonly T[]> {
  return {
    /* ... */
    reduce: (c, u) => (Array.isArray(u) ? [...c, ...u] : [...c, u as T]),
    initial: () => [],
  };
}
```

| Constructor | Reducer | Use it for |
|---|---|---|
| `lastChannel(init)` | overwrite — the newest update wins | a result that gets replaced each time, e.g. the latest review verdict |
| `listChannel()` | append — accumulates, one item or a batch at a time | a running log, e.g. a conversation transcript |
| `inputChannel<T>()` | overwrite, but with **no static initial value** — seeded by the run's actual input argument | a run's own input, e.g. the issue a team is triaging |

`inputChannel` is used by [`team()`](/reference/team/). It's the same shape as `lastChannel` at the value/update level, but it's *branded* (`readonly "~input": true`) so the type machinery can pick out exactly the channels that make up a team's run-input shape, separate from its ordinary domain channels:

```ts
export interface InputChannel<T> extends Channel<T, T> {
  readonly "~input": true;
}
export function inputChannel<T>(): InputChannel<T> { /* ... */ }

export type TeamInputOf<State> = {
  readonly [K in keyof State as State[K] extends InputChannel<any> ? K : never]:
    State[K] extends InputChannel<infer T> ? T : never;
};
```

## Reading state: `StateOf`

Given a record of channels, `StateOf` gives you the plain object shape a router actually sees — each channel's *value* type, not the channel wrapper:

```ts
export type StateOf<C> = { readonly [K in keyof C]: C[K] extends Channel<infer V, any> ? V : never };
```

```ts
const state = {
  figma: lastChannel<FigmaData | null>(null),
  build: lastChannel<{ ok: boolean } | null>(null),
};
// StateOf<typeof state> = { readonly figma: FigmaData | null; readonly build: { ok: boolean } | null }
```

A [`workflow()`](/reference/workflow/) router's parameter is exactly `StateOf<...>` of its declared state, so `s.build?.ok` is a real, narrowable, typo-checked property access — not a stringly-typed lookup into a generic bag.

## Next

- [Event sourcing & replay](/core-concepts/event-sourcing/)
- [API Reference → Channels](/reference/channels/)
- [Guides → A deterministic workflow](/guides/workflows/)
