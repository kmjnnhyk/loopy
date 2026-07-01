# team Type-Surface + Seam Emit Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `team` (multi-agent v1) TYPE surface to `src/index.ts` and prove it at the `.d.ts` seam — exactly the completion gate the spec (`docs/superpowers/specs/2026-06-30-team-design.md` §10) requires before any runtime work.

**Architecture:** This project is a **type-only library skeleton**: every runtime body in `src/index.ts` is stubbed `undefined as never`; the "tests" are TypeScript **compile assertions** (`Expect<Equal<A,B>>` in `examples/*-consumer.ts`) plus **must-error fixtures** (`examples/_negative.ts` compiled under `tsconfig.negative.json`) plus **hand-read `.d.ts`** emitted to `dist-examples/`. We extend the type machinery the same way the closed ④ seam was built. TDD here = write the compile assertion (RED: tsc errors) → add the type → tsc passes (GREEN). Runtime bodies stay stubbed (that is Plan B, blocked on the core ③ runtime).

**Tech Stack:** TypeScript 6.0.3 (`--strict`), Bun, no test runner, no new dependencies. Verification via `tsc -p <config>`.

## Global Constraints

- **No new npm dependencies.** TypeScript `^6` only (`package.json`).
- **All new runtime bodies are stubbed** `undefined as never` / trivial, like every existing factory in `src/index.ts`. This is a TYPE surface, not a runtime.
- **Every exported factory carries an EXPLICIT return type** (so `isolatedDeclarations: true` passes and emitted `.d.ts` keeps synthetic type *names* — no anonymous blobs). `satisfies` allowed on internal const tables, NEVER on an exported factory return. (Existing convention, `src/index.ts:6-9`.)
- **Two §2.x guard disciplines are load-bearing** (proven in the ④ seam, re-confirmed for team in spec Appendix B): ① dep/passTo extractors use `NonNullable<…>`, NEVER a constrained `infer K extends …` (a constrained infer falls back to the constraint on an absent optional phantom). ② membership/gate predicates use the tuple-wrap `[X] extends [never]`, NEVER naked `X extends never` (naked distributes over `never` and mis-gates).
- **Three build configs, unchanged:**
  - `tsc -p tsconfig.json` → maintainer gate: `src` only, `isolatedDeclarations: true`, emits `dist/`. MUST stay clean (no TS9010/TS2742).
  - `tsc -p tsconfig.examples.json` → consumer build: `src`+`examples` (excl `_negative.ts`), `isolatedDeclarations: false`, emits inferred `.d.ts` to `dist-examples/` (this is what we hand-read).
  - `tsc -p tsconfig.negative.json` → must-error fixtures: `noEmit`, captures diagnostic codes.
- **Assertion helpers** (copy verbatim into each `*-consumer` file, matching `examples/consumer.ts:9-11`):
  ```ts
  type Expect<T extends true> = T;
  type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
  ```
- **`loopy` resolves to `./src/index.ts`** (tsconfig `paths`). Import from `"loopy"` in examples.
- **Plan A scope note:** `agent()` gains `passTo?` ONLY. The spec's "team binds agent input (optional input)" is a RUNTIME binding → Plan B; here team-fixture agents declare `input`/`output` explicitly like existing `examples/agents.ts`. The team's `run` input comes from `inputChannel` channels in the team `state`, not from agent inputs.
- **Commit after every GREEN task.** Follow existing commit style.

---

## File Structure

- **Modify `src/index.ts`** — append a new `§8 — team` block (all type surface; runtime stubbed). Modify the `Agent` interface + `agent()` signature (add `~passTo` phantom + `passTo?` param) and `ToolCtx` (add `interrupt`). One file, matching the existing single-module layout.
- **Create `examples/team.ts`** — the PR-triage fixture: `ReviewResult` type, 4 agents with `passTo`, a `requestApproval` tool, `prTriage = team({…}).writes(…).router(…)`, and a team runtime registration. Built up progressively across tasks.
- **Create `examples/team-consumer.ts`** — positive seam assertions P1–P7 (`Expect<Equal>`), imported into the consumer build.
- **Modify `examples/_negative.ts`** — append must-error fixtures N1–N5.
- Build configs: unchanged (examples auto-included by the existing `include: ["src","examples"]`).

Dependency order of the src surface: `passTo capture → PassToolNames → inputChannel → shared channels/state → membership guard → team() factory+builder → tool-ctx interrupt → defineLoopy teams registry`. The fixture and assertions accumulate alongside.

---

## Task 1: `agent()` captures `passTo` names + `PassToOf` extractor

**Files:**
- Modify: `src/index.ts` (Agent interface ~165-178; `agent()` ~180-204; append `PassToOf`, `AnyAgent`)
- Create: `examples/team.ts` (agents only, this task)
- Create: `examples/team-consumer.ts` (first assertions)

**Interfaces:**
- Produces: `Agent<Name,In,Out,Deps,Tools,Pass>` (new 6th param `Pass extends string = never`), `agent()` accepting `passTo?: readonly string[]`, `export type PassToOf<A>`, `export type AnyAgent`.
- Consumes: existing `Agent`, `agent`, `NonNullable`, `AnyStep`.

- [ ] **Step 1: Write the failing assertions** in `examples/team.ts` + `examples/team-consumer.ts`

`examples/team.ts` (agents only for now):
```ts
import { agent, tool, io } from "loopy";
import type { GitRepo } from "./deps";

export interface Issue { readonly id: number; readonly body: string }
export type ReviewResult =
  | { readonly approved: true;  readonly notes: string }
  | { readonly approved: false; readonly assignee: "bugFixer" | "docsWriter"; readonly notes: string };

export const triage = agent({
  name: "triage", model: "opus",
  instructions: "Read the issue; hand to bugFixer or docsWriter.",
  input: io<{ issue: Issue }>(), output: io<{ kind: string }>(),
  passTo: ["bugFixer", "docsWriter"],
});
export const bugFixer = agent({
  name: "bugFixer", model: "opus", instructions: "Fix the bug.",
  input: io<{ issue: Issue }>(), output: io<{ done: boolean }>(),
  deps: ["repo"], passTo: ["reviewer"],
});
export const docsWriter = agent({
  name: "docsWriter", model: "opus", instructions: "Write docs.",
  input: io<{ issue: Issue }>(), output: io<{ done: boolean }>(),
  passTo: ["reviewer"],
});
export const reviewer = agent({
  name: "reviewer", model: "opus", instructions: "Review; approve or reassign.",
  input: io<{ issue: Issue }>(), output: io<ReviewResult>(),
  // no passTo — termination via router
});
void (null as unknown as GitRepo); // keep deps import referenced until later tasks
```

`examples/team-consumer.ts`:
```ts
import type { PassToOf } from "loopy";
import { triage, reviewer } from "./team";

type Expect<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// passTo names captured as a literal union; an agent with no passTo → never (absorbed).
export type _T1a = Expect<Equal<PassToOf<typeof triage>, "bugFixer" | "docsWriter">>;
export type _T1b = Expect<Equal<PassToOf<typeof reviewer>, never>>;
```

- [ ] **Step 2: Run to verify RED**

Run: `./node_modules/.bin/tsc -p tsconfig.examples.json`
Expected: FAIL — `Object literal may only specify known properties, and 'passTo' does not exist` (TS2353) on the agents, and `PassToOf` not exported.

- [ ] **Step 3: Add the type surface** in `src/index.ts`

In the `Agent` interface (currently `src/index.ts:165-178`), add a 6th type param and the phantom:
```ts
export interface Agent<
  Name extends string,
  In extends IO<any, any>,
  Out extends IO<any, any>,
  Deps extends keyof LoopyDeps,
  Tools extends readonly AnyStep[] = readonly AnyStep[],
  Pass extends string = never,
> extends Step<Name, In, Out, Deps> {
  readonly "~kind": "agent";
  readonly model: string;
  readonly tools: Tools;
  /** phantom: union of declared passTo target NAMES (§6 candidate ii). */
  readonly "~passTo"?: Pass;
  readonly run: (input: InferOut<In>, ctx: AgentCtx<Deps>) => Promise<InferOut<Out>>;
}
```
In `agent()` (currently `:180-204`) add the `Pass` generic + `passTo?` param + thread it into the return type:
```ts
export function agent<
  const Name extends string,
  In extends IO<any, any>,
  Out extends IO<any, any>,
  const Tools extends readonly AnyStep[] = [],
  const D extends readonly (keyof LoopyDeps)[] = [],
  const Pass extends readonly string[] = [],
>(def: {
  name: Name; model: string; instructions: string;
  input: In; output: Out;
  tools?: Tools & NoDuplicateTools<Tools>;
  deps?: D;
  passTo?: Pass;
}): Agent<Name, In, Out, D[number] | ToolDepKeys<Tools>, Tools, Pass[number]> {
  return {
    "~kind": "agent", name: def.name, model: def.model,
    input: def.input, output: def.output,
    tools: (def.tools ?? []) as Tools,
    run: undefined as never,
  } as Agent<Name, In, Out, D[number] | ToolDepKeys<Tools>, Tools, Pass[number]>;
}
```
Append after `agent()`:
```ts
/** ~passTo extractor — NonNullable (NOT a constrained infer; see Global Constraints). */
export type PassToOf<A> = A extends { readonly "~passTo"?: infer P } ? NonNullable<P> : never;

/** variadic upper bound for team agent records. */
export type AnyAgent = Agent<string, IO<any, any>, IO<any, any>, keyof LoopyDeps, readonly AnyStep[], string>;
```

- [ ] **Step 4: Run to verify GREEN (consumer build)**

Run: `./node_modules/.bin/tsc -p tsconfig.examples.json`
Expected: PASS (exit 0).

- [ ] **Step 5: Run the maintainer gate**

Run: `./node_modules/.bin/tsc -p tsconfig.json`
Expected: PASS (exit 0) — `agent()` still emits clean under `isolatedDeclarations`.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts examples/team.ts examples/team-consumer.ts
git commit -m "feat(team): agent() captures passTo names + PassToOf extractor"
```

---

## Task 2: `PassToolNames` synthesized `pass_to_*` manifest (P1)

**Files:** Modify `src/index.ts` (append), `examples/team-consumer.ts` (append)

**Interfaces:**
- Produces: `export type PassToolNames<Pass extends string>`.
- Consumes: `PassToOf` (Task 1).

- [ ] **Step 1: Write the failing assertion** in `examples/team-consumer.ts`

```ts
import type { PassToOf, PassToolNames } from "loopy";
// ...
// P1: pass_to_* tool names synthesized from the captured passTo union, NAMED.
export type _P1 = Expect<Equal<
  keyof PassToolNames<PassToOf<typeof triage>>,
  "pass_to_bugFixer" | "pass_to_docsWriter"
>>;
```

- [ ] **Step 2: Run to verify RED**

Run: `./node_modules/.bin/tsc -p tsconfig.examples.json`
Expected: FAIL — `PassToolNames` not exported.

- [ ] **Step 3: Add the type** in `src/index.ts` (append near `PassToOf`)

```ts
/** P1: template-literal mapped type — the synthesized handoff tool manifest. */
export type PassToolNames<Pass extends string> = {
  readonly [N in Pass as `pass_to_${N}`]: { readonly target: N };
};
```

- [ ] **Step 4: Run to verify GREEN**

Run: `./node_modules/.bin/tsc -p tsconfig.examples.json`
Expected: PASS.

- [ ] **Step 5: Maintainer gate + hand-read**

Run: `./node_modules/.bin/tsc -p tsconfig.json`
Expected: PASS.
Then open `dist-examples/examples/team-consumer.d.ts` and confirm `_P1` is present and the `pass_to_${N}` mapped type is NAMED (no anonymous blob / TS2742). Record: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts examples/team-consumer.ts
git commit -m "feat(team): PassToolNames synthesized pass_to_* manifest (P1)"
```

---

## Task 3: `inputChannel` + `~input` brand + `TeamInputOf` (P4 input half)

**Files:** Modify `src/index.ts` (append after `listChannel`), `examples/team.ts` (add state channels), `examples/team-consumer.ts` (append)

**Interfaces:**
- Produces: `export interface InputChannel<T>`, `export function inputChannel<T>()`, `export type TeamInputOf<State>`.
- Consumes: `Channel` (`:210-215`).

- [ ] **Step 1: Write the failing assertion**

In `examples/team.ts` add:
```ts
import { agent, tool, io, inputChannel, lastChannel } from "loopy";
// ... (existing) ...
export const triageState = {
  issue:  inputChannel<Issue>(),
  review: lastChannel<ReviewResult | null>(null),
};
```
In `examples/team-consumer.ts` add:
```ts
import type { TeamInputOf } from "loopy";
import { triageState } from "./team";
// P4 (input half): only ~input-branded channels are selected as run input.
export type _P4in = Expect<Equal<TeamInputOf<typeof triageState>, { readonly issue: Issue }>>;
```
(Import `Issue` type into the consumer: `import type { Issue } from "./team";`.)

- [ ] **Step 2: Run to verify RED**

Run: `./node_modules/.bin/tsc -p tsconfig.examples.json`
Expected: FAIL — `inputChannel` / `TeamInputOf` not exported.

- [ ] **Step 3: Add the type surface** in `src/index.ts` (after `listChannel`, ~230)

```ts
/** Run-input seed channel: no initial (provided at run). BRANDED so `TeamInputOf`
 *  can distinguish it from `lastChannel` (both are `Channel<T,T>` otherwise —
 *  the init is a runtime field, invisible to the type system). See spec §4. */
export interface InputChannel<T> extends Channel<T, T> {
  readonly "~input": true;
}
export function inputChannel<T>(): InputChannel<T> {
  return {
    "~value": undefined as never,
    "~update": undefined as never,
    reduce: (_c, u) => u,
    initial: (() => undefined) as never,  // seeded at run; no static init
    "~input": true,
  };
}
/** select only the ~input-branded channels → the team's run-input shape. */
export type TeamInputOf<State> = {
  readonly [K in keyof State as State[K] extends InputChannel<any> ? K : never]:
    State[K] extends InputChannel<infer T> ? T : never;
};
```

- [ ] **Step 4: Run to verify GREEN**

Run: `./node_modules/.bin/tsc -p tsconfig.examples.json`
Expected: PASS.

- [ ] **Step 5: Maintainer gate**

Run: `./node_modules/.bin/tsc -p tsconfig.json`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts examples/team.ts examples/team-consumer.ts
git commit -m "feat(team): inputChannel with ~input brand + TeamInputOf (P4-input)"
```

---

## Task 4: shared `transcript`/`nextAgent` channels + `Msg` + team `StateOf` (P3)

**Files:** Modify `src/index.ts` (append), `examples/team-consumer.ts` (append)

**Interfaces:**
- Produces: `export interface Msg`, `export type TeamAutoState<Names>`, `export type TeamFullState<State, Names>`, `export type AgentNames<Agents>`.
- Consumes: `Channel`, `StateOf`, `listChannel`/`lastChannel` shapes, `PassToOf`-era `Agents`.

- [ ] **Step 1: Write the failing assertion** in `examples/team-consumer.ts`

```ts
import type { StateOf, TeamFullState, Msg } from "loopy";
// P3: team auto-injects transcript + nextAgent; author channels survive named.
type Names = "triage" | "bugFixer" | "docsWriter" | "reviewer";
type FullState = TeamFullState<typeof triageState, Names>;
type S = StateOf<FullState>;
export type _P3a = Expect<Equal<S["nextAgent"], Names | null>>;
export type _P3b = Expect<Equal<S["transcript"], readonly Msg[]>>;
export type _P3c = Expect<Equal<S["review"], ReviewResult | null>>;   // author channel named
export type _P3d = Expect<Equal<S["issue"], Issue>>;                  // inputChannel value survives
```
(Import `ReviewResult` into the consumer: `import type { Issue, ReviewResult } from "./team";`.)

- [ ] **Step 2: Run to verify RED**

Run: `./node_modules/.bin/tsc -p tsconfig.examples.json`
Expected: FAIL — `TeamFullState` / `Msg` not exported.

- [ ] **Step 3: Add the type surface** in `src/index.ts`

```ts
/** shared conversation message (minimal). transcript = listChannel<Msg>(). */
export interface Msg {
  readonly role: "user" | "assistant" | "tool";
  readonly agent?: string;
  readonly content: string;
}
export type AgentNames<Agents> = Extract<keyof Agents, string>;

/** team auto-injected channels: shared transcript (append) + nextAgent (control,
 *  init = entry at runtime, consumed each turn — runtime concern, Plan B). */
export type TeamAutoState<Names extends string> = {
  readonly transcript: Channel<readonly Msg[], Msg | readonly Msg[]>;
  readonly nextAgent: Channel<Names | null, Names | null>;
};
export type TeamFullState<State, Names extends string> = State & TeamAutoState<Names>;
```

- [ ] **Step 4: Run to verify GREEN**

Run: `./node_modules/.bin/tsc -p tsconfig.examples.json`
Expected: PASS.

- [ ] **Step 5: Maintainer gate**

Run: `./node_modules/.bin/tsc -p tsconfig.json`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts examples/team-consumer.ts
git commit -m "feat(team): shared transcript/nextAgent channels + Msg + TeamFullState (P3)"
```

---

## Task 5: `GuardAgents` per-slot membership guard (spec §6 #1 risk)

**Files:** Modify `src/index.ts` (append), `examples/team-consumer.ts` (append a positive-membership assertion)

**Interfaces:**
- Produces: `export type GuardAgents<Agents>`.
- Consumes: `PassToOf` (Task 1). This is the spec's #1 type risk; the exact encoding is from Appendix B (compiled-verified). Both §2.x disciplines apply.

- [ ] **Step 1: Write the failing assertion** in `examples/team-consumer.ts`

```ts
import type { GuardAgents } from "loopy";
import { bugFixer, docsWriter } from "./team";
// A valid agents map (all passTo targets are members) must pass the guard
// UNCHANGED — i.e. GuardAgents<A> is assignable back to A (no phantom brand).
type ValidAgents = {
  triage: typeof triage; bugFixer: typeof bugFixer;
  docsWriter: typeof docsWriter; reviewer: typeof reviewer;
};
export type _T5 = Expect<Equal<
  { [K in keyof GuardAgents<ValidAgents>]: 1 },   // no "~passToTargetNotInTeam" slot appears
  { [K in keyof ValidAgents]: 1 }
>>;
```

- [ ] **Step 2: Run to verify RED**

Run: `./node_modules/.bin/tsc -p tsconfig.examples.json`
Expected: FAIL — `GuardAgents` not exported.

- [ ] **Step 3: Add the guard** in `src/index.ts` (verbatim from spec Appendix B.2 — DO NOT simplify the `NonNullable` extractor or the tuple-wrap gate; both are load-bearing)

```ts
/** per-slot membership guard: an agent whose passTo targets are all members of
 *  the team's agent set passes through UNCHANGED; a stray target brands ONLY
 *  that slot with a `never`-missing error field naming the stray. (Spec §6 ii /
 *  Appendix B — compiled under tsc 6.0.3; reviewer with no passTo → PassToOf =
 *  never → [never] extends [never] → passes.) */
export type GuardAgents<Agents> = {
  readonly [K in keyof Agents]:
    [Exclude<PassToOf<Agents[K]>, Extract<keyof Agents, string>>] extends [never]
      ? Agents[K]
      : {
          readonly "~passToTargetNotInTeam":
            Exclude<PassToOf<Agents[K]>, Extract<keyof Agents, string>>;
        };
};
```

- [ ] **Step 4: Run to verify GREEN**

Run: `./node_modules/.bin/tsc -p tsconfig.examples.json`
Expected: PASS (a valid team is unbranded; reviewer's empty passTo is absorbed to `never`).

- [ ] **Step 5: Maintainer gate**

Run: `./node_modules/.bin/tsc -p tsconfig.json`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts examples/team-consumer.ts
git commit -m "feat(team): GuardAgents per-slot passTo membership guard (spec §6 #1)"
```

---

## Task 6: `team()` factory + `.writes()`/`.router()` builder + router-return type (P2, P6)

**Files:** Modify `src/index.ts` (append `Team`, `TeamBuilder`, `team()`), `examples/team.ts` (add the `prTriage` team), `examples/team-consumer.ts` (append P2, P6)

**Interfaces:**
- Produces: `export interface Team<Name, Agents, State, Result>`, `export type TeamRouterReturn<Agents>`, `export interface TeamBuilder<…>`, `export function team(…)`.
- Consumes: `GuardAgents`, `AgentNames`, `TeamFullState`, `StateOf`, `END`, `AnyAgent`, `TeamInputOf`.

- [ ] **Step 1: Write the failing fixture + assertions**

In `examples/team.ts` append:
```ts
import { team, END } from "loopy";
// ... (agents + triageState already defined) ...
export const prTriage = team({
  name: "prTriage",
  entry: "triage",
  state: triageState,
  agents: { triage, bugFixer, docsWriter, reviewer },
  maxTurns: 20,
})
  .writes({ reviewer: "review" })
  .router((s) => {
    if (s.nextAgent) return s.nextAgent;
    if (s.review?.approved) return END;
    if (s.review) return s.review.assignee;
    return END;
  });
```
In `examples/team-consumer.ts` append:
```ts
import type { TeamRouterReturn } from "loopy";
import { prTriage } from "./team";
// P2: router return union INCLUDES entry "triage" (inherited .branch surface).
export type _P2 = Expect<Equal<
  TeamRouterReturn<{ triage: 1; bugFixer: 1; docsWriter: 1; reviewer: 1 }>,
  "triage" | "bugFixer" | "docsWriter" | "reviewer" | "~end"
>>;
void prTriage;  // fixture must compile (P6: .writes + .router chain type-checks)
```

- [ ] **Step 2: Run to verify RED**

Run: `./node_modules/.bin/tsc -p tsconfig.examples.json`
Expected: FAIL — `team` / `TeamRouterReturn` not exported; `prTriage` chain uncompilable.

- [ ] **Step 3: Add the factory + builder** in `src/index.ts`

```ts
export type TeamRouterReturn<Agents> = AgentNames<Agents> | END;

export interface Team<Name extends string, Agents, State, Result> {
  readonly "~kind": "team";
  readonly name: Name;
  readonly entry: AgentNames<Agents>;
  readonly agents: Agents;
  readonly state: TeamFullState<State, AgentNames<Agents>>;
  readonly maxTurns?: number;
  // AnyEntry-compatible surface for defineLoopy (Task 8): run input from
  // inputChannel channels; run output = the single .writes-mapped channel value.
  readonly input: IO<TeamInputOf<State>>;
  readonly output: IO<Result>;
  readonly "~deps"?: keyof LoopyDeps;
}

/** .writes maps an agent name → a state channel key (its output is written there).
 *  Result = the value type of the single mapped channel (Task 8 uses it for run). */
export interface TeamBuilder<Name extends string, Agents, State> {
  writes<const M extends Partial<Record<AgentNames<Agents>, keyof State>>>(
    map: M,
  ): TeamRouted<Name, Agents, State, M>;
  router(
    fn: (s: StateOf<TeamFullState<State, AgentNames<Agents>>>) => TeamRouterReturn<Agents>,
  ): Team<Name, Agents, State, unknown>;
}

export interface TeamRouted<Name extends string, Agents, State, M> {
  router(
    fn: (s: StateOf<TeamFullState<State, AgentNames<Agents>>>) => TeamRouterReturn<Agents>,
  ): Team<Name, Agents, State, WritesResult<State, M>>;
}

/** single mapped channel → its value type; 0 or >1 mappings → full state snapshot. */
export type WritesResult<State, M> =
  [keyof M] extends [never] ? StateOf<State>
  : { [K in keyof M]: 0 }[keyof M] extends 0
    ? (keyof M extends infer _One
        ? M[keyof M] extends infer Ch extends keyof State
          ? State[Ch] extends Channel<infer V, any> ? V : never
          : never
        : never)
    : StateOf<State>;

export function team<
  const Name extends string,
  const Agents extends Record<string, AnyAgent>,
  State extends Record<string, Channel<any, any>>,
>(def: {
  name: Name;
  entry: AgentNames<Agents>;
  state: State;
  agents: Agents & GuardAgents<Agents>;
  maxTurns?: number;
}): TeamBuilder<Name, Agents, State> {
  void def;
  return {
    writes: (() => ({ router: () => undefined as never })) as never,
    router: (() => undefined as never) as never,
  } as TeamBuilder<Name, Agents, State>;
}
```
> **Executor note:** `WritesResult` for the single-mapping case is the intricate part. The intent (spec §4): exactly one `.writes` mapping → that channel's value type; else the full `StateOf`. Iterate against `tsc` until `_P4out` (Task 8) yields `ReviewResult | null` for the single-mapped `review` channel. If the conditional above misbehaves, a `keyof M extends never ? … : [keyof M] extends [infer One] ? …` shape may read cleaner — the oracle is the compile assertion, not this sketch.

- [ ] **Step 4: Run to verify GREEN**

Run: `./node_modules/.bin/tsc -p tsconfig.examples.json`
Expected: PASS (the `prTriage` chain compiles; `s.review.assignee` needs no `!` — discriminated `ReviewResult` narrows after the `?.approved` guard; `s.nextAgent`/`s.review` are the `StateOf` channel values).

- [ ] **Step 5: Maintainer gate + hand-read**

Run: `./node_modules/.bin/tsc -p tsconfig.json`
Expected: PASS (no TS9010/TS2742 on `team()` return).
Open `dist-examples/examples/team.d.ts`; confirm `Team<"prTriage", …>` is NAMED with the four agents visible (no anonymous blob). Record: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts examples/team.ts examples/team-consumer.ts
git commit -m "feat(team): team() factory + .writes/.router builder + router-return (P2)"
```

---

## Task 7: tool-ctx `interrupt` exposure + `requestApproval` (P5)

**Files:** Modify `src/index.ts` (`ToolCtx`), `examples/team.ts` (add `requestApproval`, attach to reviewer), `examples/team-consumer.ts` (append P5)

**Interfaces:**
- Produces: `ToolCtx<D>` gains `interrupt<T>(payload): Promise<T>`.
- Consumes: existing `ToolCtx` (`:19-21`), `tool()`.

- [ ] **Step 1: Write the failing fixture + assertion**

In `examples/team.ts` add a tool that requests HITL and attach it to reviewer:
```ts
export const requestApproval = tool({
  name: "requestApproval",
  description: "Pause for human approval.",
  input: io<{ summary: string }>(),
  output: io<{ approved: boolean }>(),
  run: async (i, ctx) => ctx.interrupt<{ approved: boolean }>({ ask: i.summary }),
});
```
Change `reviewer` to include `tools: [requestApproval]`.
In `examples/team-consumer.ts` append:
```ts
import { requestApproval } from "./team";
// P5: the tool's run-ctx exposes interrupt<T> (HITL flows through the tool, not
// the declarative agent). Verify the ctx param shape carries interrupt.
type ReviewToolCtx = Parameters<(typeof requestApproval)["run"]>[1];
export type _P5 = Expect<Equal<
  ReviewToolCtx extends { interrupt: infer F } ? F : never,
  <T>(payload: unknown) => Promise<T>
>>;
```

- [ ] **Step 2: Run to verify RED**

Run: `./node_modules/.bin/tsc -p tsconfig.examples.json`
Expected: FAIL — `Property 'interrupt' does not exist on type 'ToolCtx<…>'` in `requestApproval.run`.

- [ ] **Step 3: Extend `ToolCtx`** in `src/index.ts` (`:19-21`)

```ts
export interface ToolCtx<D extends keyof LoopyDeps> {
  readonly deps: Pick<LoopyDeps, D>;
  /** HITL: suspend the run; resolves with the typed resume value. Exposed on the
   *  tool ctx so a declarative (bodyless) agent can request approval via a tool
   *  (spec §7 / §12c — a controlled extension of the locked ToolCtx). */
  interrupt<T>(payload: unknown): Promise<T>;
}
```
> **Note:** This is additive — existing tools that destructure `{ deps }` are unaffected. Flagged in spec §12(c) as touching the locked `ToolCtx`.

- [ ] **Step 4: Run to verify GREEN**

Run: `./node_modules/.bin/tsc -p tsconfig.examples.json`
Expected: PASS.

- [ ] **Step 5: Maintainer gate + confirm no existing-tool breakage**

Run: `./node_modules/.bin/tsc -p tsconfig.json` → PASS.
Run: `./node_modules/.bin/tsc -p tsconfig.examples.json` → PASS (existing `examples/tools.ts` tools still compile).

- [ ] **Step 6: Commit**

```bash
git add src/index.ts examples/team.ts examples/team-consumer.ts
git commit -m "feat(team): expose interrupt on ToolCtx for HITL + requestApproval (P5)"
```

---

## Task 8: `defineLoopy` teams registry + `rt.run` typing + deps convergence (P4-output, P7)

**Files:** Modify `src/index.ts` (`defineLoopy` + collision guard), `examples/team.ts` (register the team runtime), `examples/team-consumer.ts` (append P4-output, P7)

**Interfaces:**
- Produces: `defineLoopy` accepting `teams?: T`; `NoKeyCollision` extended 3-way (or a new `NoKeyCollision3`); `RequiredDeps` covers teams; `rt.run("prTriage", input)` typed.
- Consumes: `AnyEntry`, `RequiredDeps`, `RunFn`, `Runtime`, `Team` (Task 6). `Team` already carries `input`/`output`/`~deps` → satisfies `AnyEntry`.

- [ ] **Step 1: Write the failing fixture + assertions**

In `examples/team.ts` append (reuse a `repo` stub as in `examples/loopy.ts`):
```ts
import { defineLoopy } from "loopy";
import type { GitRepo } from "./deps";
const repo: GitRepo = { read: async () => "", write: async () => {}, find: async () => [] };
export const teamRt = defineLoopy({
  agents: {}, workflows: {},
  teams: { prTriage },
  deps: { repo },   // bugFixer declares deps:["repo"] → team requires "repo"
});
```
In `examples/team-consumer.ts` append:
```ts
import type { InputOf, RequiredDeps } from "loopy";
import { teamRt } from "./team";
// P4 (output half): rt.run narrows to the single .writes-mapped channel value.
export async function demoTriage(): Promise<ReviewResult | null> {
  return teamRt.run("prTriage", { issue: { id: 7, body: "x" } });
}
// P4 (input): rt.run input = the inputChannel-selected shape.
export type _P4input = Expect<Equal<InputOf<typeof prTriage>, { readonly issue: Issue }>>;
// P7: team deps converge (bugFixer's "repo"); passTo synthesis contributes none.
export type _P7 = Expect<Equal<RequiredDeps<{ prTriage: typeof prTriage }>, "repo">>;
```

- [ ] **Step 2: Run to verify RED**

Run: `./node_modules/.bin/tsc -p tsconfig.examples.json`
Expected: FAIL — `defineLoopy` has no `teams` param; `teamRt.run("prTriage", …)` untyped.

- [ ] **Step 3: Extend `defineLoopy`** in `src/index.ts` (`:355-362`)

```ts
export type NoKeyCollision3<A, W, T> =
  (keyof A & keyof W) | (keyof A & keyof T) | (keyof W & keyof T) extends never
    ? unknown
    : { readonly "~duplicateRegistryKey": (keyof A & keyof W) | (keyof A & keyof T) | (keyof W & keyof T) };

export function defineLoopy<
  const A extends Record<string, AnyEntry>,
  const W extends Record<string, AnyEntry>,
  const T extends Record<string, AnyEntry> = {},
>(def: {
  agents: A;
  workflows: W;
  teams?: T & NoKeyCollision3<A, W, T>;
  deps: Pick<LoopyDeps, RequiredDeps<A & W & T>>;
}): Runtime<A & W & T> {
  void def;
  return { run: (async () => undefined as never) as RunFn<A & W & T> };
}
```
> **Executor note:** `Team<Name, Agents, State, Result>` must be assignable to `AnyEntry` — it already declares `name`, `input: IO<…>`, `output: IO<Result>`, `~deps?`. Confirm `InputOf<Team>`/`OutputOf<Team>` resolve to `TeamInputOf<State>` / `Result`. `RequiredDeps<A & W & T>` reuses the existing `DepsOf` (NonNullable) — team's `~deps` must be the union of its agents' deps; if `Team["~deps"]` is left as the broad `keyof LoopyDeps`, tighten it in the `Team` interface to the agents' dep union so P7 yields exactly `"repo"` (derive via a `TeamDeps<Agents>` mapped/indexed type mirroring `NodeDepKeys`).

- [ ] **Step 4: Run to verify GREEN**

Run: `./node_modules/.bin/tsc -p tsconfig.examples.json`
Expected: PASS — `demoTriage` returns `ReviewResult | null`; `_P4input` = `{ issue: Issue }`; `_P7` = `"repo"`.

- [ ] **Step 5: Maintainer gate + hand-read**

Run: `./node_modules/.bin/tsc -p tsconfig.json` → PASS.
Open `dist-examples/examples/team.d.ts`; confirm `teamRt`'s `Runtime<…>` includes `prTriage` with the team input/output NAMED (no TS2742). Record: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts examples/team.ts examples/team-consumer.ts
git commit -m "feat(team): defineLoopy teams registry + rt.run typing + deps convergence (P4/P7)"
```

---

## Task 9: Negative fixtures N1–N5 (must-error)

**Files:** Modify `examples/_negative.ts` (append). Compiled via `tsconfig.negative.json` (`noEmit`, captures diagnostics).

**Interfaces:** Consumes everything above. Each fixture carries a `// expect TSxxxx` comment; the exact code is confirmed by running the negative build and reading the actual diagnostic.

- [ ] **Step 1: Append the must-error fixtures** to `examples/_negative.ts`

```ts
import { team, agent, io, inputChannel, lastChannel, END } from "loopy";
import { bugFixer, docsWriter, reviewer } from "./team";
import type { Issue, ReviewResult } from "./team";

// ── N1: router returns a non-member key → expect TS2820 "Did you mean 'bugFixer'?"
export const badRouter = team({
  name: "n1", entry: "triage",
  state: { issue: inputChannel<Issue>(), review: lastChannel<ReviewResult | null>(null) },
  agents: { triage: reviewer, bugFixer, docsWriter, reviewer },
}).router((s) => (s.review?.approved ? END : "bugFx"));   // typo

// ── N2: agent passTo targets a NON-member → expect TS2322 branded
//    "~passToTargetNotInTeam": "ghost" on the offending slot.
const strayTriage = agent({
  name: "triage", model: "opus", instructions: "x",
  input: io<{ issue: Issue }>(), output: io<{ kind: string }>(),
  passTo: ["ghost", "docsWriter"],   // "ghost" ∉ agents
});
export const badMembership = team({
  name: "n2", entry: "triage",
  state: { issue: inputChannel<Issue>(), review: lastChannel<ReviewResult | null>(null) },
  agents: { triage: strayTriage, bugFixer, docsWriter, reviewer },
});

// ── N3: agent output ⊄ .writes-mapped channel type → expect TS2322 not-assignable.
const weakReviewer = agent({
  name: "reviewer", model: "opus", instructions: "x",
  input: io<{ issue: Issue }>(), output: io<{ approved: boolean }>(),  // missing notes/assignee
});
export const badWrites = team({
  name: "n3", entry: "reviewer",
  state: { issue: inputChannel<Issue>(), review: lastChannel<ReviewResult | null>(null) },
  agents: { reviewer: weakReviewer, bugFixer, docsWriter },
}).writes({ reviewer: "review" });

// ── N4: entry omitted → expect TS2741 "Property 'entry' is missing".
export const badEntry = team({
  name: "n4",
  state: { issue: inputChannel<Issue>(), review: lastChannel<ReviewResult | null>(null) },
  agents: { reviewer, bugFixer, docsWriter },
} as any);   // `as any` only to force the missing-field path; remove after reading the real code

// ── N5: .writes maps a non-existent channel key → expect TS2820 "Did you mean 'review'?"
export const badChannelKey = team({
  name: "n5", entry: "reviewer",
  state: { issue: inputChannel<Issue>(), review: lastChannel<ReviewResult | null>(null) },
  agents: { reviewer, bugFixer, docsWriter },
}).writes({ reviewer: "revie" });   // channel typo
```
> **Executor note:** N4's `as any` defeats the check — instead OMIT `entry` and let it error, then annotate the real code. Adjust each `// expect` to the ACTUAL diagnostic the compiler emits (codes may differ, e.g. N2 could surface as the intersection-brand mismatch; N3/N5 could be TS2322 vs TS2820 depending on where the check lands). The goal is a captured, documented diagnostic per fixture — not a guessed code.

- [ ] **Step 2: Run the negative build**

Run: `./node_modules/.bin/tsc -p tsconfig.negative.json`
Expected: FAIL with exactly one diagnostic per fixture (N1–N5). Read each code + message.

- [ ] **Step 3: Annotate actual diagnostics**

Update each `// expect TSxxxx …` comment to the real code/message observed. Fix N4 to genuinely omit `entry` (drop `as any`).

- [ ] **Step 4: Re-run to confirm the documented set**

Run: `./node_modules/.bin/tsc -p tsconfig.negative.json`
Expected: the same 5 diagnostics, now matching the annotations. Confirm the POSITIVE build still passes: `./node_modules/.bin/tsc -p tsconfig.examples.json` → PASS (`_negative.ts` is excluded there).

- [ ] **Step 5: Commit**

```bash
git add examples/_negative.ts
git commit -m "test(team): N1–N5 must-error fixtures (router typo, passTo non-member, writes mismatch, missing entry, channel typo)"
```

---

## Task 10: Completion gate — maintainer isolatedDeclarations emit + full `.d.ts` hand-read

**Files:** none modified — this is the spec §10.3 completion gate, read by the main (Opus) session per HANDOFF discipline ("Subagent claim은 evidence 아님").

**Interfaces:** Consumes the whole surface.

- [ ] **Step 1: Maintainer gate (isolatedDeclarations ON)**

Run: `./node_modules/.bin/tsc -p tsconfig.json`
Expected: exit 0, NO `TS9010` (missing explicit return type) and NO `TS2742` (cannot be named) on any team export (`team`, `agent`, `inputChannel`, `PassToolNames`, `GuardAgents`, `defineLoopy`). If TS9010 fires, add the explicit return annotation; if TS2742 fires, wrap the offending deep composition in a named `interface` alias (spec §2.9 discipline).

- [ ] **Step 2: Consumer emit**

Run: `./node_modules/.bin/tsc -p tsconfig.examples.json`
Expected: exit 0. Emits `dist-examples/examples/team.d.ts`, `dist-examples/examples/team-consumer.d.ts`.

- [ ] **Step 3: Hand-read the emitted `.d.ts` (the actual gate)**

Open and read by hand:
- `dist-examples/examples/team.d.ts` — confirm `Team<"prTriage", {…4 agents…}, …>` is NAMED; `pass_to_bugFixer`/`pass_to_docsWriter` derivable; `nextAgent` union = the four names + null; NO anonymous blobs, NO truncation.
- `dist-examples/examples/team-consumer.d.ts` — confirm `_P1…_P7` all present as `true`.

Record each as PASS/FAIL in the commit message. This mirrors the ④ seam "6/6, read by the main session, no subagent claim."

- [ ] **Step 4: Known residual (document, do not block)**

The 4-agent emit being clean does NOT close the §2.9 scale risk: `PassToolNames ∘ PassToOf` over a *10-agent* team's `.d.ts` staying hover-clean is unverified. Add a 10-agent throwaway team to `examples/team.ts` ONLY if you want to close it now; otherwise note it in the commit as the remaining open item (matches spec §10.3).

- [ ] **Step 5: Commit the gate record**

```bash
git add -A
git commit -m "test(team): completion gate — isolatedDeclarations emit clean + P1–P7/N1–N5 hand-read PASS

Maintainer gate (tsconfig.json, isolatedDeclarations ON): clean, no TS9010/TS2742.
Consumer .d.ts hand-read: Team<prTriage> named, pass_to_* derivable, P1–P7 true.
Negative (tsconfig.negative.json): N1–N5 diagnostics as documented.
Residual: 10-agent hover-clean (§2.9 scale) — open."
```

---

## Self-Review (run after drafting, before handoff)

- **Spec coverage:** §10 Gate #0 (agent passTo [T1], inputChannel brand [T3], tool-ctx interrupt [T7]) ✓; P1 [T2], P2 [T6], P3 [T4], P4 [T3+T8], P5 [T7], P6 [T6], P7 [T8] ✓; N1–N5 [T9] ✓; §10.3 completion gate [T10] ✓. Runtime (control loop, consume-on-read, replay, HITL execution) is explicitly OUT (Plan B) — noted in header.
- **Placeholder scan:** the two `> Executor note` blocks (WritesResult single-mapping conditional; Team `~deps` tightening; N4 `as any`) flag genuinely compile-dependent type code where the compiler is the oracle — they carry the intended shape + the assertion that pins it, not a "TODO". Acceptable for type-machinery whose exact spelling only `tsc` can confirm.
- **Type consistency:** `PassToOf`/`PassToolNames`/`GuardAgents`/`AgentNames`/`TeamFullState`/`TeamInputOf`/`WritesResult`/`Team`/`TeamRouterReturn` names are used consistently across tasks; the `review` channel (renamed from `verdict`) and `ReviewResult` type match the current spec.
- **Naming:** channel `review`, type `ReviewResult`, tool `requestApproval`, team `prTriage` — consistent with spec v-current.
