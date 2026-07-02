---
title: Status & Roadmap
description: What's actually implemented today, what's designed but not built, and what's not designed yet — stated plainly.
---

loopy is being built **type-surface first**: the compile-time contract is locked and proven before any runtime line is written. This page draws the line precisely, so nothing on this site overstates what you can actually do today.

## What works today

**The type surface** — `tool()`, `agent()`, `workflow()`, `team()`, channels (`lastChannel`, `listChannel`, `inputChannel`), and the registry (`defineLoopy`, `loopy().provide(...)`) are all real, exported, type-checked factories on `master`. Every claim made in [Core Concepts](/core-concepts/step/) and the [API Reference](/reference/) pages is proven by:

- **Compile-assertions** (`examples/consumer.ts`, `examples/team-consumer.ts`) — `Expect<Equal<...>>` checks that specific inferred types come out exactly right (e.g. that a dependency union stays `"repo"` and doesn't widen to every dependency in the app, or that `team()`'s `passTo` membership guard actually rejects a stray handoff target).
- **Must-error fixtures** (`examples/_negative.ts`) — mistakes that are *supposed* to fail a build, compiled separately, so the exact diagnostic (`TS2820`, `TS2741`, ...) is pinned down. `team()`'s slice alone covers five such fixtures.
- **Hand-read `.d.ts` emit** under `isolatedDeclarations: true` — the package boundary itself was inspected, not just the source.

`team()` in particular went through its own completion gate — seven positive and five negative compile-assertions, plus a 10-agent scale check — before merging into `master`. See `examples/team.ts` for the anchor scenario (the same PR-triage example walked through in [The team model, explained](/team-model/)).

**What's *not* real yet, for any of the above:** `run` bodies are stubs. `tool()`'s `run` executes exactly as you wrote it if you call it directly in a script, but nothing in loopy today drives an actual model loop, executes a workflow or team graph turn by turn, or persists anything. See the next section. This is true of `team()` too: the type surface (who's allowed to hand off to whom, what a router can return, how outputs land in channels) is fully checked. Nothing yet actually runs a triage loop.

## What's designed but not built (the runtime)

The control loop, event-sourced replay, `passTo` consumption, and human-in-the-loop *execution* are designed in detail — see [Event sourcing & replay](/core-concepts/event-sourcing/) — but not implemented. Concretely, not yet built:

- A scheduler that actually drives a `workflow()` or `team()` graph turn by turn.
- The append-only event log, checkpointer, and the `fold(reduce, log)` replay engine.
- `ctx.callModel` / `ctx.callTool` as recorded effects (today, nothing intercepts I/O — a `run` body is just a plain async function).
- `ctx.interrupt(...)` / `runtime.resume(...)` actually suspending and resuming a run.
- Schema-Aligned Parsing — `io()`'s `validate` is currently an identity cast, not real coercion of LLM output.

## What's not designed yet

- Parallel / concurrent agents (today, exactly one agent runs per team turn).
- Nested teams (a team used as a node inside another team or workflow).
- Typed error channels (a dedicated, typed failure path distinct from a thrown exception).
- `loopy dev` — a local dev/debugging web UI — and a recorded-replay testing story both have internal design specs but no implementation plan yet.
- Cross-cutting middleware/observability (a way to wrap every `Step` with a shared concern) and the package/monorepo layout for eventual publishing haven't been designed at all.

## At a glance

| Layer | State |
|---|---|
| `tool` / `agent` / `workflow` / `team` / registry type surface | ✅ done, on `master` |
| Control loop / event log / replay / resume | 🚧 designed, not implemented |
| Schema-Aligned Parsing (real validation) | 🚧 designed, not implemented |
| Parallel agents, nested teams, typed error channels | 🔭 not designed yet |
| `loopy dev` (observability UI), recorded-replay testing | 🔭 spec written, no implementation plan |
| Published npm package | ❌ not published — clone the repo (see [Quick Start](/getting-started/)) |

## Verifying the type surface yourself

```bash
tsc -p tsconfig.json          # maintainer gate: src only, isolatedDeclarations ON
tsc -p tsconfig.examples.json # consumer build: emits inferred .d.ts to dist-examples/
tsc -p tsconfig.negative.json # must-error fixtures: captures the expected diagnostics
```

See [Quick Start](/getting-started/) for what each of these actually checks.
