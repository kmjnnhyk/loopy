---
title: Quick Start
description: Clone loopy and explore its type surface — there's no npm package yet.
banner:
  content: |
    loopy is a prototype — the type surface is complete and compile-checked, the runtime is not yet implemented. See <a href="/status-roadmap/">Status &amp; Roadmap</a>.
---

## What loopy is today

loopy is in the **design / prototype phase**. The repository is a fully type-checked **type surface**: `src/index.ts` exports real, type-checked factories (`tool`, `agent`, `workflow`, `defineLoopy`, `loopy`, channel constructors), but every runtime body is an intentional stub. There is no control loop, no event-sourced replay, and no human-in-the-loop execution yet — **you cannot run a loopy program today.**

What you *can* do is write real, type-checked agent, tool, and workflow definitions, and see the exact API shape TypeScript hands you — ahead of the runtime that will execute it.

This is deliberate. The design was validated first as a pure type-level contract — compile assertions, hand-read `.d.ts` emit, must-error fixtures — before any runtime code. See [Status & Roadmap](/status-roadmap/) for what's done and what's next.

## Clone the repository

loopy is not published to npm yet, so there's no `npm install loopy`. Clone it directly:

```bash
git clone https://github.com/kmjnnhyk/loopy.git
cd loopy
npm install    # or: bun install — the repo ships a bun.lock
```

## Explore the type surface

There is no test runner. The "tests" are TypeScript compile checks, split across three `tsconfig` files that each prove a different slice of the contract:

```bash
tsc -p tsconfig.json          # maintainer gate: src/ only, isolatedDeclarations ON
tsc -p tsconfig.examples.json # consumer build: emits inferred .d.ts to dist-examples/
tsc -p tsconfig.negative.json # must-error fixtures: captures the expected diagnostics
```

- **`tsconfig.json`** compiles `src/index.ts` alone with [`isolatedDeclarations`](https://www.typescriptlang.org/tsconfig/#isolatedDeclarations) on. Every exported factory must carry an explicit return type, so the emitted `.d.ts` stays nameable and hover-clean across the package boundary.
- **`tsconfig.examples.json`** compiles `examples/*.ts` — a realistic consumer surface (10 tools, 5 agents, 2 workflows, a 7-dependency registry) — the way a real app would build. This is where you see the actual *inferred* types a consumer gets back.
- **`tsconfig.negative.json`** compiles `examples/_negative.ts`, fixtures that are *supposed* to fail: a typo'd edge name, a missing dependency. Each failure is a specific, named diagnostic (`TS2820`, `TS2741`, ...) — proof the type machinery catches real mistakes with an actionable message, not `any`.

Start reading at [`examples/tools.ts`](https://github.com/kmjnnhyk/loopy/blob/master/examples/tools.ts), [`examples/agents.ts`](https://github.com/kmjnnhyk/loopy/blob/master/examples/agents.ts), and [`examples/workflows.ts`](https://github.com/kmjnnhyk/loopy/blob/master/examples/workflows.ts) — they're the most accurate usage reference in the repository, more so than any prose (including this site).

## Next steps

- New to the API? Start with [Core Concepts → The Step spine](/core-concepts/step/) — every primitive reduces to one shape.
- Want the practical path? Jump to the [Guides](/guides/tools/) and work through tool → agent → workflow → team.
- Curious what "type surface only" means in practice? [Status & Roadmap](/status-roadmap/) draws the line precisely.
