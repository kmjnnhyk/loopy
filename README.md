<div align="center">

# loopy

**React for agents** — a type-safe TypeScript DSL for LLM agents, tools, workflows, and teams.

Everything reduces to one primitive: a `Step<Name, In, Out, Deps>`.

[Documentation](https://loopy.js.org) · [한국어 문서](https://loopy.js.org/ko/)

</div>

---

> [!IMPORTANT]
> **loopy is early and pre-1.0, but shipped and published to npm.** Both the type
> surface (`tool` / `agent` / `workflow` / `team`, the registry, end-to-end
> inference) and the **runtime** — an event-sourced kernel with one path for
> fresh / replay / resume, workflow / agent / team drivers, human-in-the-loop
> suspend & resume, an Anthropic adapter, and record→replay testing
> (`@loopyjs/test`) — are implemented and exercised by the test suite. All
> packages are published at `0.1.0` under the `next` dist-tag (see
> [Install](#install)). The public API may still shift before `1.0.0`.
> See [Status & roadmap](#status--roadmap).

## Why loopy

Building with LLMs means moving along a spectrum: from **deterministic
workflows** (you decide every step) to **autonomous agents** (the model decides).
Most frameworks pick one end. loopy makes the whole spectrum a single,
type-checked model — and lets you choose, *at each branch*, whether control is
fixed by your code or handed to the model.

It borrows React's core idea: instead of imperative orchestration, you declare
small units and let a reducer fold them over shared state. Every unit — a tool,
an agent, a workflow node, a whole team — is a `Step`, so they compose for free
(an agent can be passed anywhere a tool is expected).

- **Type-safe end to end.** Inputs, outputs, dependencies, and handoff targets
  are all inferred and checked at compile time. A typo in a router or a missing
  dependency is a red squiggle, not a 3 a.m. page.
- **Functional dependency injection.** No decorators, no globals. Each unit
  *declares* the dependency slice it needs; the registry proves every dependency
  is supplied before anything can run.
- **Event-sourced by design.** Every turn, tool call, and state change is a
  logged event, so replay is a pure fold — deterministic tests with zero LLM
  calls.
- **Vendor-neutral schemas.** A [Standard Schema](https://standardschema.dev/)-shaped
  carrier means your Zod / Valibot / ArkType types flow through unchanged.

## Install

```sh
bun add @loopyjs/core@next
```

```sh
bun add @loopyjs/anthropic@next                                       # real model calls
bun add -d @loopyjs/cli@next @loopyjs/devtools@next @loopyjs/test@next # loopy dev / loopy test
```

Bun is the primary runtime (it runs the TypeScript source directly via the
package's `bun` export condition); Node works via the built `dist`. npm / pnpm
also work as package managers.

## A glance

```ts
import { agent, tool, io, team, inputChannel, lastChannel, END, defineLoopy } from "@loopyjs/core";

// A tool declares only the dependency slice it needs.
const editFile = tool({
  name: "editFile",
  description: "Apply an edit to a file.",
  input: io<{ path: string; patch: string }>(),
  output: io<{ applied: boolean }>(),
  deps: ["repo"],
  run: async (i, { deps }) => {
    await deps.repo.write(i.path, i.patch);
    return { applied: true };
  },
});

// An agent owns a model loop; `passTo` captures its handoff targets by name.
const bugFixer = agent({
  name: "bugFixer", model: "claude-opus",
  instructions: "Fix the bug, then hand to the reviewer.",
  input: io<{ issue: Issue }>(), output: io<{ done: boolean }>(),
  tools: [editFile], deps: ["repo"], passTo: ["reviewer"],
});

// A team is a multi-agent loop over shared state — a router picks the next
// single agent each turn; `passTo` targets are membership-checked at compile time.
const prTriage = team({
  name: "prTriage",
  entry: "triage",
  state: {
    issue:  inputChannel<Issue>(),                     // run input, provided at run
    review: lastChannel<ReviewResult | null>(null),    // domain channel
    // `transcript` + `nextAgent` are auto-injected by the team
  },
  agents: { triage, bugFixer, docsWriter, reviewer },
  maxTurns: 20,
})
  .writes({ reviewer: "review" })          // agent output → state channel (output ⊑ channel, checked)
  .router((s) => {                         // control rule; a stray key is a compile error
    if (s.nextAgent) return s.nextAgent;   // follow a handoff request first
    if (s.review?.approved) return END;    // discriminated union narrows — no `!` needed
    if (s.review) return s.review.assignee;
    return END;
  });

// The registry proves every declared dependency is supplied, then types rt.run.
const rt = defineLoopy({ agents: {}, workflows: {}, teams: { prTriage }, deps: { repo } });
const out: ReviewResult | null = await rt.run("prTriage", { issue });
```

## Core concepts

Everything is a **`Step<Name, In, Out, Deps>`** — a named unit with typed input,
output, and a declared dependency slice. The four public primitives are all Steps:

| Primitive | What it is | Control |
|---|---|---|
| **`tool()`** | A model-less capability. Declares its deps; runs a body. | your code |
| **`agent()`** | A model-owning loop. Carries tools (incl. sub-agents) + `passTo` handoff names. | the model |
| **`workflow()`** | Arbitrary Step nodes + a typed, data-driven router. Two-phase `.nodes().flow()`. | your code |
| **`team()`** | Agents-as-nodes + a shared transcript + `passTo` sugar. A router picks one agent per turn. | hybrid |

**State is a set of typed channels** with declared reducers —
`lastChannel` (overwrite), `listChannel` (append), and `inputChannel` (run-seeded
input). A workflow / team folds updates into channels; routers branch on the
typed snapshot.

**The registry** — `defineLoopy({ agents, workflows, teams, deps })` — converges
the dependency unions of everything registered and refuses to type `run` until
every required dependency is provided. `loopy({...}).provide(...)` is the
progressive-injection variant whose `run` unlocks only once nothing is missing.

## Status & roadmap

loopy was built **type-surface first** — the compile-time contract was locked and
proven before the runtime, so the runtime had a fixed target to hit.

- ✅ **Type surface** — `tool` / `agent` / `workflow` / `team`, channels, the
  registry, dependency convergence, and the `team` multi-agent surface (passTo
  membership guard, `inputChannel` brand, HITL tool-ctx `interrupt`). Proven by
  compile-assertions (`examples/*-consumer.ts`), must-error fixtures
  (`examples/_negative.ts`), and hand-read `.d.ts` under `isolatedDeclarations`.
- ✅ **Runtime** — an event-sourced kernel (one path for fresh / replay / resume),
  workflow / agent / team drivers, `passTo` consumption, human-in-the-loop suspend
  & resume, and an Anthropic model adapter. Exercised end-to-end by the test suite.
- ✅ **Record→replay testing** (`@loopyjs/test`) — record a run once as a golden log,
  then re-run only your orchestration code against the memoized effects (0 LLM
  calls), reporting the first divergence (see Testing, below).
- 🔭 **Later** — parallel/concurrent agents, nested teams, typed error channels.

## Documentation

A full documentation site is in progress. In the meantime, the annotated
[`examples/`](./examples) are the most accurate usage reference — they compile
against the type surface.

## Testing — record→replay (`@loopyjs/test`)

```ts
import { expect } from "bun:test";
import { defineLoopyTest } from "@loopyjs/test";
import { runtime } from "./loopy.config";

const { test } = defineLoopyTest(runtime, { dir: import.meta.dir });

test("designFlow: figma → PR", async (t) => {
  const r = await t.replay("designFlow", { message: "add /healthz" });
  //  first run  → real run, records tests/__golden__/designFlow_figma-PR.json
  //  later runs → replays the golden (0 LLM calls); reports the first divergence
  expect(r.output).toEqual({ prUrl: "…/pull/9" });
});
```

Run `loopy test` to replay, `loopy test -u` to re-record after an intended change.

**Determinism contract:** replay compares the arguments your code passes to each effect
(model request, tool call) against the recording. Keep effect arguments deterministic given
the run input. A timestamp / UUID / random id placed *into* an effect's arguments changes
every run and will surface as a replay divergence — that is the harness detecting author
impurity, not a false positive. (v1 has no masking.)

## Verifying

Two gate layers. The runtime test suite:

```bash
bun test                      # runtime + harness: event sourcing, drivers, HITL, replay
```

…and the TypeScript compile checks:

```bash
tsc -p tsconfig.json          # maintainer gate: src only, isolatedDeclarations ON
tsc -p tsconfig.examples.json # consumer build: emits inferred .d.ts to dist-examples/
tsc -p tsconfig.negative.json # must-error fixtures: captures the expected diagnostics
```

## Contributing

Bug reports, feature proposals, and PRs are welcome. Start with
[CONTRIBUTING.md](./CONTRIBUTING.md) — it covers the dev setup, the single
`bun run check` gate, and how PRs are merged. Please also read the
[Code of Conduct](./CODE_OF_CONDUCT.md). For usage questions and ideas, use
[Discussions](https://github.com/kmjnnhyk/loopy/discussions).

Found a security issue? Please report it privately — see
[SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE) © kmjnnhyk
