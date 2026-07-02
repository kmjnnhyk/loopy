---
title: Status & Roadmap
description: What's actually implemented today, what's designed but not built, and what's not designed yet — stated plainly.
---

loopy is being built **type-surface first**: the compile-time contract is locked and proven before any runtime line is written. This page draws the line precisely, so nothing on this site overstates what you can actually do today.

## What works today

**The type surface** — `tool()`, `agent()`, `workflow()`, channels (`lastChannel`, `listChannel`), and the registry (`defineLoopy`, `loopy().provide(...)`) are real, exported, type-checked factories on `master`. Every claim made in [Core Concepts](/core-concepts/step/) and the [tool](/reference/tool/) / [agent](/reference/agent/) / [workflow](/reference/workflow/) reference pages is proven by:

- **Compile-assertions** (`examples/consumer.ts`) — `Expect<Equal<...>>` checks that specific inferred types come out exactly right (e.g. that a dependency union stays `"repo"` and doesn't widen to every dependency in the app).
- **Must-error fixtures** (`examples/_negative.ts`) — mistakes that are *supposed* to fail a build, compiled separately, so the exact diagnostic (`TS2820`, `TS2741`, ...) is pinned down.
- **Hand-read `.d.ts` emit** under `isolatedDeclarations: true` — the package boundary itself was inspected, not just the source.

What's *not* real yet: `run` bodies are stubs. `tool()`'s `run` executes exactly as you wrote it if you call it directly in a script, but nothing in loopy today drives an actual model loop, executes a workflow graph, or persists anything — see the next section.

**The `team()` multi-agent surface** — `team()`, `.writes()`/`.router()`, the `passTo` membership guard, the `inputChannel` brand, and the HITL `interrupt` extension to `ToolCtx` are complete and verified with the same discipline (a completion gate covering seven positive and five negative compile-assertions). As of this writing, this work lives on the `feat/team-type-surface` branch and has not yet merged into `master` — it's real, committed, and tested, just not yet on the default branch. Every `team()`-related page on this site ([API Reference](/reference/team/), [Guides](/guides/multi-agent-team/), [The team model](/team-model/)) says so explicitly and sources its code from that branch.

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
- `loopy dev` — a local dev/debugging web UI — and a recorded-replay testing story both have design specs (`docs/superpowers/specs/2026-06-30-devtools-design.md`, `docs/superpowers/specs/2026-06-30-testing-design.md`) but no implementation plan yet.
- Cross-cutting middleware/observability (a way to wrap every `Step` with a shared concern) and the package/monorepo layout for eventual publishing haven't been designed at all.

## At a glance

| Layer | State |
|---|---|
| `tool` / `agent` / `workflow` / registry type surface | ✅ done, on `master` |
| `team` type surface | ✅ done, on `feat/team-type-surface` (pending merge) |
| Control loop / event log / replay / resume | 🚧 designed, not implemented |
| Schema-Aligned Parsing (real validation) | 🚧 designed, not implemented |
| Parallel agents, nested teams, typed error channels | 🔭 not designed yet |
| `loopy dev` (observability UI), recorded-replay testing | 🔭 spec written, no implementation plan |
| Published npm package | ❌ not published — clone the repo (see [Getting Started](/getting-started/)) |

## Verifying the type surface yourself

```bash
tsc -p tsconfig.json          # maintainer gate: src only, isolatedDeclarations ON
tsc -p tsconfig.examples.json # consumer build: emits inferred .d.ts to dist-examples/
tsc -p tsconfig.negative.json # must-error fixtures: captures the expected diagnostics
```

See [Getting Started](/getting-started/) for what each of these actually checks.
