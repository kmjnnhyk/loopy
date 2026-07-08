---
title: Status & Roadmap
description: What's actually implemented today, what's designed but not built, and what's not designed yet — stated plainly.
---

loopy was built **type-surface first**: the compile-time contract was locked and proven before any runtime line was written. The runtime, testing harness, and DevTools have since shipped on top of that contract. This page draws the line precisely, so nothing on this site overstates what you can actually do today.

## What works today

**The type surface** — `tool()`, `agent()`, `workflow()`, `team()`, channels (`lastChannel`, `listChannel`, `inputChannel`), and the registry (`defineLoopy`, `loopy().provide(...)`) are all real, exported, type-checked factories, published to npm. Every claim made in [Core Concepts](/core-concepts/step/) and the [API Reference](/reference/) pages is proven by:

- **Compile-assertions** (`examples/consumer.ts`, `examples/team-consumer.ts`) — `Expect<Equal<...>>` checks that specific inferred types come out exactly right (e.g. that a dependency union stays `"repo"` and doesn't widen to every dependency in the app, or that `team()`'s `passTo` membership guard actually rejects a stray handoff target).
- **Must-error fixtures** (`examples/_negative.ts`) — mistakes that are *supposed* to fail a build, compiled separately, so the exact diagnostic (`TS2820`, `TS2741`, ...) is pinned down. `team()`'s slice alone covers five such fixtures.
- **Hand-read `.d.ts` emit** under `isolatedDeclarations: true` — the package boundary itself was inspected, not just the source.

`team()` in particular went through its own completion gate — seven positive and five negative compile-assertions, plus a 10-agent scale check — before merging.

**The runtime is real, not a stub.** `defineLoopy(...)` builds a runtime whose `run(name, input)` actually drives a `workflow()` or `team()` graph turn by turn, calls models, executes tools, and persists everything to an append-only event log — `state = fold(reducer, log)`. Concretely, shipped and exercised by the test suite:

- A kernel + agent / workflow / team drivers, all going through one code path for fresh runs, replay, and resume.
- The append-only event log, a checkpointer, and the replay engine (`verifyReplay`) — replaying a recorded thread makes **0 LLM calls**; effects are memoized from the log.
- `ctx.interrupt(...)` / `runtime.resume(threadId, value)` actually suspending and resuming a run — see [Human-in-the-loop](/guides/human-in-the-loop/).
- An in-memory store and a SQLite store (`@loopyjs/core/sqlite`).
- Model clients — a built-in stub plus a real Anthropic adapter (`@loopyjs/anthropic`).
- Schema-Aligned Parsing for structured output — the agent driver robustly extracts JSON from a model's raw text (fenced code, stray prose) before handing it to your schema's `validate`.

## Shipped: testing and DevTools

- **Record→replay testing** (`@loopyjs/test`) — `defineLoopyTest(runtime, { dir })` gives you `t.replay(name, input)`: the first run records a golden log, every later run replays it with no model calls, reporting the first divergence. CLI: `loopy test` (replay), `loopy test -u` (re-record).
- **`loopy dev`** — a local, offline, read-only DevTools web UI (`@loopyjs/devtools` + the CLI). It loads your app in-process, subscribes to the runtime's event stream, and serves a timeline / graph / step-detail view with a scrub slider for time-travel. See [DevTools (loopy dev)](/guides/devtools/).

## Published to npm

All packages are published at `0.1.0` under the `next` dist-tag (also `latest`): `@loopyjs/core`, `@loopyjs/anthropic`, `@loopyjs/test`, `@loopyjs/cli`, `@loopyjs/devtools`. See [Quick Start](/getting-started/) for install instructions. The API is pre-1.0 and may still shift before a `1.0.0` release.

## What's not designed yet

- Parallel / concurrent agents (today, exactly one agent runs per team turn).
- Nested teams (a team used as a node inside another team or workflow).
- Typed error channels (a dedicated, typed failure path distinct from a thrown exception).
- Cross-cutting middleware/observability — a way to wrap every `Step` with a shared concern — hasn't been designed yet.
- DevTools v2 — replay/resume from the UI, full channel diffs, edge-click payloads, and production observation. Today's DevTools (v1) is local, offline, and read-only observation only.

## At a glance

| Layer | State |
|---|---|
| `tool` / `agent` / `workflow` / `team` / registry type surface | ✅ shipped |
| Runtime — kernel, event log, replay, resume, model drivers | ✅ shipped |
| Record→replay testing (`@loopyjs/test`, `loopy test`) | ✅ shipped |
| DevTools (`loopy dev`) — timeline / graph / detail, v1 read-only | ✅ shipped |
| Published npm package (`@loopyjs/*@next`) | ✅ shipped — see [Quick Start](/getting-started/) |
| Parallel agents, nested teams, typed error channels | 🔭 not designed yet |
| Cross-cutting middleware/observability | 🔭 not designed yet |
| DevTools v2 (replay/resume UI, production observation) | 🔭 not built |

## Verifying the type surface yourself

```bash
tsc -p tsconfig.json          # maintainer gate: src only, isolatedDeclarations ON
tsc -p tsconfig.examples.json # consumer build: emits inferred .d.ts to dist-examples/
tsc -p tsconfig.negative.json # must-error fixtures: captures the expected diagnostics
```

See [Quick Start](/getting-started/) for what each of these actually checks.
