---
title: Quick Start
description: Install loopy and run your first program in a few minutes.
---

## What loopy is today

loopy is a **type-safe TypeScript DSL with a working runtime**, published to npm as `@loopyjs/core` (and friends) under the `next` dist-tag. Every primitive — `tool`, `agent`, `workflow`, `team` — is both fully type-checked *and* actually executable: `defineLoopy(...)` builds a runtime, and `runtime.run(name, input)` drives an event-sourced kernel that really calls models, runs tools, and persists a replayable log.

Concretely, you get: an append-only event log (`state = fold(reducer, log)`), agent/workflow/team drivers, human-in-the-loop suspend & resume (`ctx.interrupt()` + `runtime.resume(...)`), an in-memory store plus a SQLite store, model clients (a built-in stub and `@loopyjs/anthropic`), Schema-Aligned Parsing for structured output, a record→replay testing harness (`@loopyjs/test`), and a local DevTools UI (`loopy dev`).

The API is still pre-1.0 and may shift before a `1.0.0` release — see [Status & Roadmap](/status-roadmap/) for exactly what's stable and what's still moving.

## Install

```bash
bun add @loopyjs/core@next
```

Add the pieces you need on top of the core package:

```bash
bun add @loopyjs/anthropic@next              # real model calls (Anthropic)
bun add -d @loopyjs/cli@next @loopyjs/devtools@next @loopyjs/test@next   # loopy dev / loopy test
```

Bun is the primary runtime — it runs the TypeScript source directly via the package's `bun` export condition. Node also works, via the built `dist` output, and npm / pnpm work as package managers too.

## A minimal runnable example

This is a complete, runnable loopy program: one `step()` wrapped in a one-node `workflow()`, wired into a runtime with `defineLoopy`, then run.

```ts
import { defineLoopy, workflow, step, node, io, lastChannel, END } from "@loopyjs/core";

const greet = step({
  name: "greet",
  input: io<{ name: string }>(),
  output: io<{ message: string }>(),
  run: async (i) => ({ message: `Hello, ${i.name}!` }),
});

export const hello = workflow({
  name: "hello",
  state: { greeting: lastChannel<{ message: string } | null>(null) },
  input: io<{ name: string }>(),
  output: io<{ message: string }>(),
})
  .nodes({
    greet: node(greet, { reads: (s) => ({ name: s.input.name }), writes: "greeting" }),
  })
  .flow((b) => b.start("greet").edge("greet", END))
  .returns((s) => ({ message: s.greeting?.message ?? "" }));

export const runtime = defineLoopy({
  agents: {},
  workflows: { hello },
  deps: {},
});

const out = await runtime.run("hello", { name: "world" });
console.log(out); // { message: "Hello, world!" }
```

Nothing here calls a model — that's deliberate, to keep this first example dependency-free. For a tool with real dependencies, see [Guide: writing a tool](/guides/tools/); for a model-driven agent, see [Guide: an agent with tools](/guides/agent-with-tools/).

## Watch it run: `loopy dev`

Export your `runtime` from a module (as above) and point the DevTools CLI at it:

```bash
loopy dev ./loopy.config.ts --port 5173
```

This opens a local, offline, read-only web UI at `http://localhost:5173` — a timeline of steps, a graph of the workflow with the executed path overlaid, and a detail pane for each step's model/tool I/O. See [DevTools (loopy dev)](/guides/devtools/).

## Test without calling a model twice: `loopy test`

`@loopyjs/test` records a run once as a golden log, then replays it — no LLM calls — on every later run, catching orchestration regressions instead of paying for and waiting on the model:

```bash
loopy test        # replay against golden logs
loopy test -u     # re-record after an intended change
```

## Next steps

- New to the API? Start with [Core Concepts → The Step spine](/core-concepts/step/) — every primitive reduces to one shape.
- Want the practical path? Jump to the [Guides](/guides/tools/) and work through tool → agent → workflow → team.
- Curious exactly what's shipped vs. still moving? [Status & Roadmap](/status-roadmap/) draws the line precisely.
