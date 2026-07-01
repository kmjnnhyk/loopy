<div align="center">

# loopy

**React for agents** — a type-safe TypeScript DSL for LLM agents, tools, workflows, and teams.

Everything reduces to one primitive: a `Step<Name, In, Out, Deps>`.

</div>

---

> [!IMPORTANT]
> **loopy is in the design / prototype phase.** This repository is a fully
> type-checked **type surface** — `src/index.ts` is a skeleton whose runtime
> bodies are intentionally stubbed. The library is validated today by TypeScript
> **compile-assertions** and hand-read `.d.ts` emit, not by executing code. The
> runtime (control loop, event-sourced replay, human-in-the-loop execution) is
> the next milestone. See [Status & roadmap](#status--roadmap).

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

## A glance

```ts
import { agent, tool, io, team, inputChannel, lastChannel, END, defineLoopy } from "loopy";

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

loopy is being built **type-surface first**: the compile-time contract is locked
and proven before any runtime is written.

- ✅ **Type surface** — `tool` / `agent` / `workflow` / `team`, channels, the
  registry, dependency convergence, and the `team` multi-agent surface (passTo
  membership guard, `inputChannel` brand, HITL tool-ctx `interrupt`). Proven by
  compile-assertions (`examples/*-consumer.ts`), must-error fixtures
  (`examples/_negative.ts`), and hand-read `.d.ts` under `isolatedDeclarations`.
- 🚧 **Runtime** — the control loop, event-sourced replay, `passTo` consumption,
  and HITL execution. Not yet implemented (bodies are stubbed `undefined as never`).
- 🔭 **Later** — parallel/concurrent agents, nested teams, typed error channels.

## Documentation

The design is documented in depth under [`docs/`](./docs):

- [`docs/design/team-explained.md`](./docs/design/team-explained.md) — the `team` multi-agent model, explained.
- [`docs/design/core-state-and-types.md`](./docs/design/core-state-and-types.md) — the Step spine, state, and type machinery.
- [`docs/design/research-design-space.md`](./docs/design/research-design-space.md) — the design-space study (LangChain, LangGraph, Vercel AI SDK, Redux, …) behind the API.
- [`docs/design/HANDOFF.md`](./docs/design/HANDOFF.md) — project context and verification discipline.
- [`docs/superpowers/specs/`](./docs/superpowers/specs) & [`docs/superpowers/plans/`](./docs/superpowers/plans) — design specs and implementation plans.

## Verifying the type surface

There is no test runner — the "tests" are TypeScript compile checks:

```bash
tsc -p tsconfig.json          # maintainer gate: src only, isolatedDeclarations ON
tsc -p tsconfig.examples.json # consumer build: emits inferred .d.ts to dist-examples/
tsc -p tsconfig.negative.json # must-error fixtures: captures the expected diagnostics
```

## License

Not yet licensed — all rights reserved while in the design phase.
