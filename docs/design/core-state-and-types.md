# loopy.js — ③④ SPEC-READY Core Design (with adversarial type-verification folded in)

The verification campaign compiled standalone TS models (TypeScript 6.0.3, `--strict`) of every load-bearing inference claim. Headline: the architecture survives, but **three type-level defects in ④ as literally written are compile-proven broken** and must change before the surface API locks. All three have small, local fixes. The ③ engine design is unaffected by the type findings (it is runtime, not boundary types) and stands as written.

---

# 1. ③ State / Event-log / Durability — the locked design

The one invariant: `state = fold(reduce, log, initial)`. The live runtime is a cache of the fold; the log is the only authority; the checkpointer is a fold-acceleration snapshot that can lag but never lie. Replay, resume, audit, time-travel, and deterministic tests are **one feature** — different boundary conditions on the same fold.

## 1.1 Channels & reducers (the state model)

State is a record of typed channels, each with a reducer `(current, update) => next` and a factory `initial()`. Update type `U` may differ from value type `V` (messages: value `Msg[]`, update `Msg | Msg[]`).

```ts
interface Channel<V, U = V> {
  readonly _value: V;  readonly _update: U;   // phantom (type-only)
  reduce: (current: V, update: U) => V;
  initial: () => V;                            // factory, not shared mutable default
}
function channel<V, U = V>(reduce: Reducer<V, U>) {
  return { initial: (make: () => V): Channel<V, U> =>
    ({ reduce, initial: make, _value: undefined!, _update: undefined! }) };
}

// built-ins: append / last / sum / mergeRecord — sugar:
const messagesChannel = () => channel(reducers.append<Msg>()).initial(() => []);
const lastChannel = <T>(init: T) => channel(reducers.last<T>()).initial(() => init);
const counterChannel = (init = 0) => channel(reducers.sum()).initial(() => init);
```

A node returns a **partial-of-updates**; the runtime folds each present key through its reducer; **absent keys are untouched** (not reset). Value/update types are *inferred once* from the channel record:

```ts
type StateValue<S>  = { [K in keyof S]: S[K]["_value"] };
type StateUpdate<S> = Partial<{ [K in keyof S]: S[K]["_update"] }>;
```

`agent()` pre-wires a fixed channel set the author never writes — `{ messages, phase, steps, pendingToolCalls, lastError }` — which is *why* an agent's think→act→observe loop is replayable for free (its loop is just node transitions over channels). Nested agents get a namespaced sub-state under their node key, folded by the same engine.

## 1.2 Event model (append-only, paired effects)

Every event carries a monotonic per-thread `seq` (the deterministic effect index). **Every effect is a *pair*** — a `*Requested`/`*Called`/`Raised` written *before* the I/O, a `*Returned`/`Resumed`/`Fired` written *after*, tied by `effectId == seq` of the request. This pairing is what makes a crash *mid-effect* recoverable.

```ts
type Event = RunStarted | StepStarted | StepEnded
  | ModelCallRequested | ModelCallReturned | ToolCalled | ToolReturned
  | StatePatched | InterruptRaised | Resumed | SleepScheduled | TimerFired
  | RunErrored | RunEnded;
interface EventBase { seq: number; threadId: ThreadId; runId: RunId; ts: string; node?: string; }
```

Only `StatePatched` (and `RunStarted` init) mutate channels in the fold; `ModelCall*`/`Tool*` are the **effect memo table**, not folded into state.

## 1.3 effects-as-data — the chosen mechanism (recording proxy on `ctx`)

A transition must be **pure w.r.t. I/O**: no `fetch`, no SDK, no `Date.now()`/`Math.random()`. It *requests* effects through `ctx`; the runtime fulfills (real I/O fresh, memo lookup on replay).

We evaluated three and **chose (C) recording proxy on `ctx`** over (A) generators (`yield` leaks durability into syntax, ugly with async tool code) and (B) AsyncLocalStorage monkeypatch (can't guarantee determinism for concurrent effects, untyped). (C) is the only one that is *simultaneously* natural async, fully typed (tool schema flows through `ctx.callTool`), and deterministically indexable.

```ts
interface Ctx<Deps> {
  deps: Deps;
  callModel(req: ModelRequest): Promise<ModelResponse>;
  callTool<I, O>(tool: Tool<I, O>, args: I): Promise<O>;
  interrupt<T>(payload: unknown): Promise<T>;   // suspends; resolves on resume
  sleep(ms: number): Promise<void>;
  now(): number; random(): number;              // recorded clock / RNG
}
```

Each `ctx.*` call assigns its `effectId` **synchronously in the proxy body** (before any await), so `Promise.all([ctx.callTool(a), ctx.callTool(b)])` is ordered by *source order*, not by which network call returns first. On a cache-hit it resolves from the log with **zero I/O**; on a miss it appends `*Called`, performs the I/O once, appends `*Returned`.

**Impurity is made loud at three stages** (none alone sufficient): (1) type-level — the transition gets *no* capability except `ctx`; (2) lint `loopy/no-raw-io-in-transition` (on by default; tools' `run` is exempt — tools *are* the I/O boundary); (3) runtime trap — ALS-scoped swap of `Date.now`/`Math.random`/`fetch` inside transitions that throws `LoopyImpurityError` (downgraded to a recorded warning event in prod). Plus a **CI replay self-check**: after each fresh run, re-fold the just-written log with all I/O hard-disabled and assert byte-identical state — a stray `Date.now()` diverges on the *first CI run*, not at a 3-AM resume.

## 1.4 Durability in JS: suspend a *position*, not a closure

JS cannot serialize a paused async function's continuation. So loopy **never persists a function** — it persists three plain-data things: **graph position + channel values + pending effect**, and reconstructs by re-entering the graph + re-folding. This is *why the graph/agent model beats an imperative loop*: a `while` loop encodes its resume point in the program counter (unreachable); a graph encodes it as data ("you are at node `approve`, here are the channels, there is a pending `InterruptRaised`"). The agent loop is itself a tiny graph (phase channel + edges), so agents resume with zero author effort.

```ts
interface Checkpointer {
  appendEvents(t: ThreadId, e: Event[]): Promise<void>;   // atomic, monotonic-on-seq, every effect boundary
  save(t: ThreadId, s: Snapshot): Promise<void>;          // lazy fold-cache
  load(t: ThreadId): Promise<{ snapshot: Snapshot | null; tail: Event[] } | null>;
  readLog(t: ThreadId, fromSeq?: number): Promise<Event[]>;
}
```

`sqliteStore()` uses `PRIMARY KEY (thread_id, seq)` + `INSERT OR IGNORE` → **idempotent monotonic appends**: re-appending after a crash mid-flush is a no-op. Snapshot persisted lazily, events eagerly; a stale snapshot is always recovered by `fold(log)`.

## 1.5 interrupt / resume semantics

`ctx.interrupt(payload)` → assigns `effectId`, finds no `Resumed`, appends `InterruptRaised` (fsync), throws `Suspend` (control-flow signal). Scheduler catches it, saves `status:"suspended"`, **returns from `run()`** — process can exit, nothing held in memory.

`runtime.resume(threadId, value)` (possibly a new process, days later) → `load` + re-fold (no LLM calls), append `Resumed`, re-enter the node: this time `ctx.interrupt`'s `findResume` *hits* → returns `value` instead of throwing. **Effects before the interrupt are memoized; only effects after it execute.** Resume = replay-prefix + fresh-suffix joined at the seam. Same scheduler runs fresh/replay/resume — the only difference is whether `findReturn(effectId)` hits.

**Crash modes:** crash between `appendEvents` and `save` → tail recovers suspended state. Crash mid-tool (after `ToolCalled`, before `ToolReturned`) → restart sees a dangling unpaired `ToolCalled` → **re-issue** (at-least-once; tools documented as needing idempotency; `tool({ idempotencyKey })` helper offered).

## 1.6 Worked event log (code→build→cycle→approve→PR)

First build fails, second passes, human approves. Suspend at seq 22, resume in a fresh process:

```jsonc
{seq:0, t:"RunStarted", entry:"ship", input:{task:"add /healthz"}}
{seq:2, t:"ToolCalled",   effectId:2,  tool:"writeCode"}   {seq:3, t:"ToolReturned", effectId:2, ok:true, value:"<diff v1>"}
{seq:4, t:"StatePatched", update:{diff:"<diff v1>", attempts:1, messages:{…}}}
{seq:7, t:"ToolCalled",   effectId:7,  tool:"runBuild"}     {seq:8, t:"ToolReturned", effectId:7, ok:true, value:{ok:false,log:"TS2322…"}}
{seq:10,t:"StepEnded", next:"code"}        // branch buildOk=false, attempts<3 → cycle
{seq:12,t:"ToolCalled",  effectId:12, tool:"writeCode"}     {seq:13,t:"ToolReturned",effectId:12,ok:true,value:"<diff v2>"}
{seq:17,t:"ToolCalled",  effectId:17, tool:"runBuild"}      {seq:18,t:"ToolReturned",effectId:17,ok:true,value:{ok:true,log:"OK"}}
{seq:20,t:"StepEnded", next:"approve"}     // branch buildOk=true
{seq:22,t:"InterruptRaised", effectId:22, payload:{diff:"<diff v2>",build:true}, resumeKey:"th_1:22"}
// ── snapshot{status:"suspended", cursor:22, node:"approve", channels:{…}, pending:{kind:"interrupt",effectId:22}} ── process exits
// resume("th_1", {approved:true}): load+fold (no LLM), then:
{seq:23,t:"Resumed", resumeKey:"th_1:22", value:{approved:true}}   // ctx.interrupt(22) → findResume hits → returns, no Suspend
{seq:27,t:"ToolCalled", effectId:27, tool:"openPR"}         {seq:28,t:"ToolReturned",effectId:27,ok:true,value:"…/pull/42"}
{seq:31,t:"RunEnded", output:{pr:"…/pull/42"}}
```

seq 0–22 replayed as cache-hits on resume — `writeCode`/`runBuild` **not re-called**; only `openPR` did real I/O. The committed log is a deterministic regression test of the whole run, human approval included, zero mocks.

## 1.7 Three hardest problems, each answered "fail loud, never fail-open"

1. **Effect-index drift under concurrency/refactor** → memo key is **content-addressed**: `hash(node, stepEpoch, callOrdinal, opType, stableArgsDigest)`. On replay, a mismatched args digest raises a loud `ReplayDivergence` ("at node `build` effect #2, expected runBuild(diff=v2) but log has v1") instead of binding the wrong recorded result.
2. **Crash-consistency across two stores** → log is sole authority (snapshot always re-derivable); paired idempotent effects; ordered writes so the worst case is a re-executed *idempotent* tool, never a lost/double-folded result.
3. **Author impurity silently breaking replay** → defense-in-depth (types remove capability, lint catches static slip, ALS trap catches dynamic slip) + CI replay self-check turns a latent resume bug into a deterministic authoring-time failure.

---

# 2. ④ Type-machinery — REVISED per verification

Three changes are **compile-forced** (not stylistic). Everything else compiled clean and behaved as designed (~20 `Expect<Equal<>>` positives + ~8 `@ts-expect-error` negatives all held).

## 2.1 Schema → static type (§1) — UNCHANGED, SOLID

Vendor `~standard`; static input/output live in a phantom `types` property. SAP keeps the static `InferOutput<S>` signature while coercing at runtime (markdown strip, trailing-comma repair) — runtime cleverness, static honesty.

```ts
export type InferOutput<S extends StandardSchemaV1> = NonNullable<S["~standard"]["types"]>["output"];
// sap(Out).parse(llmJunk) : Result<{ pr: number; title: string }>   ← survives all coercion
```
**Confidence HIGH.** Leak: a schema omitting `types` collapses `InferOutput` to `unknown`; mitigate by constraining factory params to `extends StandardSchemaV1` so the validator's own generics flow in.

## 2.2 The `AnyTool` upper bound — ⚠️ CHANGED (compile-proven broken)

**This is the load-bearing break both verifier streams independently hit.** The naive bound `Tool<string, StandardSchemaV1, StandardSchemaV1, keyof LoopyDeps>` sets In=Out=`StandardSchemaV1` → `InferOutput` collapses to `unknown` → the bound's `run` becomes `(input: unknown, …) => …`. Because `run` is declared as a **property** (arrow), `strictFunctionTypes` checks its parameter **contravariantly**: a concrete `(input: {query:string}) => …` is *not* assignable to `(input: unknown) => …` (TS2322: "unknown is not assignable to {query:string}"). **Result: every real tool is rejected, `Tools extends readonly AnyTool[]` never binds, and `agent()` collects nothing — §3/§4 never even type-check.**

```ts
// BEFORE (broken): type AnyTool = Tool<string, StandardSchemaV1, StandardSchemaV1, keyof LoopyDeps>;
// AFTER (verified to compile the whole model):
type AnyTool = Tool<string, IO<any, any>, IO<any, any>, keyof LoopyDeps>;
```
**Changed because TS does contravariant parameter checking on property-typed functions under `strictFunctionTypes`.** `any` in the schema slots is bidirectionally compatible and bypasses the variance check; it loosens *only the structural upper bound used for variadic collection*, never the concrete `Tool<…>` the factory returns. (Alternatives: bivariant *method* syntax `run(input, ctx): …`, or a `never` input param — the `any`-param alias is simplest.) Apply the same `any` widening to `AnyEntry`/`Agent<any,…>` bounds.

## 2.3 `tool()` + declared deps (§2) — UNCHANGED, SOLID

**The honest ergonomic compromise stays: deps must be DECLARED, not inferred.** TS inference flows *into* a function body, never *out of* `ctx.deps.repo.find()` usage. We chose deps as **string-literal keys into an augmentable registry** — the single decision that makes §3/§5/§7 fall out as plain `|` / `Exclude` / `Pick`.

```ts
export interface LoopyDeps {}   // consumer: declare module "loopy" { interface LoopyDeps { repo: GitRepo; clock: Clock; mailer: Mailer } }
export function tool<const Name extends string, In, Out, const D extends readonly (keyof LoopyDeps)[] = []>(
  def: { name: Name; …; deps?: D; run: (input: InferOutput<In>, ctx: ToolCtx<D[number]>) => Promise<InferOutput<Out>> }
): Tool<Name, In, Out, D[number]>
// ctx.deps : Pick<LoopyDeps, "repo"|"clock">  — touching ctx.deps.mailer → TS2339, short & precise
```
**Confidence HIGH.** Verifier nuance: `const` is *not* load-bearing for the dep union (contextual typing against `readonly (keyof LoopyDeps)[]` already preserves it); `const` is still needed for `Name` literal capture and exact tuple order. Leak (accepted): un-augmented `LoopyDeps` → `keyof` is `never` → `deps:["repo"]` errors with "not assignable to never". **Do NOT ship a `[k:string]: never` default** — verifier proved it makes `keyof = string`, silently accepting typos with zero autocomplete. The strict `{}` form is correct; document augmentation as step 0.

## 2.4 `agent()` accumulates tool deps/names (§3) — SOLID *after 2.2*

```ts
type ToolMap<T extends readonly AnyTool[]>     = { [E in T[number] as E["name"]]: E };
type ToolDepKeys<T extends readonly AnyTool[]> = NonNullable<T[number]["~deps"]>;   // distributive
// triage.tools → { search_repo, email };  ToolDepKeys → "repo"|"clock"|"mailer"
```
Both verified `Equal` once the `AnyTool` bound is fixed. `const Tools` captures the tuple without `as const`. **Leak (real, silent): duplicate tool names collapse in `ToolMap`** — not a clean last-wins but an implementation-defined merge, no diagnostic. **Adopt the `DuplicateNameCheck<Tools>` brand** (compare tuple length vs `keyof ToolMap` count → `never`-typed error field surfaced in the `agent()` param) so collisions error at the call site.

## 2.5 sub-agent-as-tool — ⚠️ CHANGED (the "recursive for free" claim was broken)

Compile-proven: `agent()` returns `Agent<…>` which lacks `input` and a tool-shaped `run`, so it fails `readonly AnyTool[]` (TS2739 "missing properties: input, run"). The "accumulation is recursive for free" claim **does not hold as written**.

**Fix (decision needed — see §5):** introduce a shared `Step<In, Out, Err, Deps>` supertype that both `Tool` and `Agent` satisfy, type `tools: readonly AnyStep[]`, and have `ToolDepKeys` distribute over `AnyStep`. Then sub-agent-as-tool genuinely recurses. This aligns with the LOCKED "ONE spine: every unit is a Step" decision — **Agent must structurally *be* a Step with the tool surface** (`input` + a wrapping `run`), not merely "composable in spirit." Without it, sub-agent-as-tool needs an explicit `agentAsTool(sub)` adapter.

## 2.6 workflow node-name accumulator (§4) — SOLID state / known graph leak

```ts
step<const Name extends string>(name: Name, step): WorkflowBuilder<State, Nodes | Name>  // accumulate literal
branch<const From extends Nodes>(from: From, router: (s: State) => Nodes | END)          // return constrained
```
Verified: typo `branch("triage", () => "shp")` → TS2820 *"not assignable to '"triage" | "ship"'. Did you mean 'ship'?"* — short, actionable, exactly the north-star. State derived via `StateOf<C>` conditional-`infer` (`s.attempts: number`, `s.verdict: "ship"|"hold"|null`). Uses explicit return-type generic, **not** polymorphic `this` (correct — `this` can't evolve a type parameter). **Real leak (inherent to fluent accumulation): forward-reference** — `.branch("a", ()=>"b")` *before* `.step("b")` errors because `Nodes` only knows nodes declared so far. **Ship the two-phase API as primary:**

```ts
workflow({ state }).nodes({ triage, ship }).flow(b => b.edge("triage","ship").branch("triage", …))
//                          ^ Nodes = keyof NodesObject known up front → no ordering leak
```
Keep fluent `.step` chaining as sugar for linear forward-only flows.

## 2.7 Deps convergence / R-channel (§5) — ⚠️ CHANGED (`DepsOf` compile-proven broken)

The naive `DepsOf<E> = E extends { "~deps"?: infer K extends keyof LoopyDeps } ? K : never` is **broken**: the phantom is *optional*, so a zero-dep entry's property is `undefined`; a **constrained** `infer K extends keyof LoopyDeps` matched against `undefined` fails the constraint and **falls back to the full `keyof LoopyDeps`**. Net: any dependency-free agent/workflow in the registry **poisons `RequiredDeps` to demand EVERY augmented dep.** This was *masked in the design's own §6 example only by coincidence* — `triage` happened to use all 3 of the 3 existing deps. Add a 4th dep, or any zero-dep entry, and `defineLoopy` over-demands.

```ts
// BEFORE (broken): E extends { "~deps"?: infer K extends keyof LoopyDeps } ? K : never
// AFTER (verified → "repo" not all-keys): mirror §3's extractor exactly
type DepsOf<E> = E extends { "~deps"?: infer K } ? NonNullable<K> & keyof LoopyDeps : never;
```
**Changed because TS falls back to the constraint when a constrained `infer` fails to match against `undefined`.** `NonNullable` collapses `undefined` *before* the union so a zero-dep entry contributes `never` and is absorbed. **§5 must use §3's `NonNullable` pattern, not a constrained infer** (they were internally inconsistent).

The rest of §5 is **SOLID** (and diagnostics are *better* than the doc predicted): `provide()` subtracts via `Exclude<Missing, K>`; `run` is gated by `[Missing] extends [never]` (the tuple-wrap is load-bearing — naive `Missing extends never` distributes over `never` → `never` and mis-gates). Missing dep at `defineLoopy` → TS2741 *"Property 'mailer' is missing … required in Pick<LoopyDeps, …>"* — names the dep, compile-time, zero `any`. The convergence plumbing is correct; it was just fed poisoned input.

## 2.8 `defineLoopy` registry `run(name, input)` (§6) — SOLID + collision guard needed

```ts
run: <Name extends keyof Reg>(name: Name, input: InputOf<Reg[Name]>) => Promise<OutputOf<Reg[Name]>>
// rt.run("triage", {goal}) ✓   rt.run("typo", {}) → TS2322, autocompletes "triage"|"shipDesign"
```
Battle-tested tRPC/Hono pattern; verified. **Leak (real): agent+workflow sharing a key** → `Reg = A & W` intersects, `InputOf<Agent & Workflow>` short-circuits to the agent branch and **silently drops the workflow's input** (not "satisfies both" as the doc guessed). **Add the guard** `keyof A & keyof W extends never ? Def : ErrorBrand<"duplicate entry name">` on the `defineLoopy` param.

## 2.9 Branded IDs + `.d.ts` survival (§7) — SOLID problem+fix, MEDIUM residual

`unique symbol`-keyed brand → unforgeable, smart constructor localizes the one cast. The real boundary risk is **`.d.ts` emit (TS2742 "cannot be named without a reference to…")**. Discipline: export every helper type in a public signature; **explicit return-type annotations on every exported factory** (so the emitter writes the annotation verbatim, not an anonymous blob); `satisfies` for internal const tables but **never** for an exported factory return; **turn on `isolatedDeclarations: true`** as the boundary linter — it mechanically compile-errors exactly the patterns that leak, at *the maintainer's* build, never the consumer's. MEDIUM residual: deeply nested `ToolDepKeys ∘ Exclude ∘ Pick` compositions can still exceed the emitter's naming ability → wrap in a named `interface` alias at that node.

---

# 3. Type-feasibility verdict

| # | Technique | Verdict | One-line |
|---|---|---|---|
| 1 | Schema → static type (SAP keeps static type) | **SOLID** (proven) | Indexed-access over phantom `types`; survives runtime coercion. |
| 2 | `tool()` + declared deps (registry-keyed) | **SOLID** (proven) | Deps must be *declared* (TS can't back-infer from body); string-literal keys = the keystone choice. |
| 2b | `AnyTool` upper bound | **RISKY→FIXED** | Broken as written (contravariant `unknown` param); `IO<any,any>` slots fix it. **Compile-forced.** |
| 3 | `agent()` tool dep-union + name-record | **SOLID** (proven, *after* 2b) | `ToolDepKeys`/`ToolMap` distribute correctly; add `DuplicateNameCheck`. |
| 3b | sub-agent-as-tool "recursive for free" | **RISKY→FIXED** | Agent isn't structurally a Tool; needs shared `Step` supertype. **Compile-forced.** |
| 4 | workflow node-name accumulator + router typo errors | **SOLID** state / **RISKY** graph | Excellent typo diagnostics; forward-ref leak → ship two-phase `.nodes().flow()`. |
| 5 | Deps convergence (`Exclude`/`[Missing] extends [never]` gate) | **SOLID** mechanism / **RISKY→FIXED** input | Gate + subtraction proven; `DepsOf` over-demands via constrained-infer fallback → use `NonNullable`. **Compile-forced.** |
| 6 | `defineLoopy` `run(name, input)` | **SOLID** (proven) | tRPC/Hono pattern; add key-collision guard. |
| 7 | Branded IDs + `.d.ts` survival | **SOLID** problem+fix / **MEDIUM** residual | Explicit return annotations + `isolatedDeclarations`; deep generics may need alias wrappers. |

**Proven feasible (compiled clean):** 1, 2, 3, 4-state, 5-mechanism, 6 — the entire end-to-end define-once chain *works* once the three compile-forced fixes land. **RISKY-but-mitigated, fix known and verified:** 2b, 3b, 5-input, 4-graph (two-phase), 6-collision, 3-dup-names. **Genuinely needs a real compiled prototype before locking:** the **§7 `.d.ts` emit under `isolatedDeclarations` for the full composed surface** — the verifiers proved the *type relations* but built isolated models; whether the *emitted `.d.ts`* of `ToolDepKeys ∘ Exclude ∘ Pick` over realistic 10–20-tool agents stays nameable and hover-clean is the one thing that can only be confirmed by emitting real declarations from the real package.

**Honest answer to the author's #1 risk (inference-at-the-seams):** the *inference* is proven feasible; the *seam* (`.d.ts` portability + hover size) is the genuine remaining unknown, and it's a maintainer-side build concern, not a consumer-side runtime risk.

---

# 4. Impact on the public API surface

The three compile-forced fixes are **internal** — they do **not** change how a user writes anything in the common path. User-facing snippets for `tool`/`agent`/`workflow`/`defineLoopy` are unchanged. Two ergonomic shifts the author should ratify:

### A. workflow graph: two-phase becomes the recommended form (forward-ref leak)

```ts
// BEFORE (fluent — breaks on forward references; .branch can't see a not-yet-declared node)
workflow({ name, state })
  .step("triage", triage)
  .branch("triage", s => s.attempts > 3 ? "ship" : END)   // ❌ if "ship" declared later
  .step("ship", shipStep)
  .start("triage");

// AFTER (two-phase — all node keys known up front; no ordering constraint)
workflow({ name, state })
  .nodes({ triage, ship })                                 // Nodes = "triage" | "ship" up front
  .flow(b => b
    .start("triage")
    .branch("triage", s => s.attempts > 3 ? "ship" : END)  // ✓ forward ref fine
    .edge("ship", END));
```
Fluent `.step(...).edge(...)` stays as sugar for linear flows. **This is the only change that touches a user's authoring shape.**

### B. sub-agent-as-tool: free *iff* we make Agent a Step; else one explicit wrapper

```ts
// Spirit of the LOCKED design (agent passed where a tool is expected):
agent({ name: "parent", tools: [searchRepo, reviewerAgent], … });   // requires §2.5 Step supertype

// If the author prefers to keep Tool and Agent structurally distinct, the fallback is one adapter:
agent({ name: "parent", tools: [searchRepo, agentAsTool(reviewerAgent)], … });
```
Recommendation: take the `Step` supertype (matches the LOCKED "ONE spine") so the spirit-level "an agent can be passed where a tool is expected" is *also true at the type level*, with no adapter.

**Unchanged (verified):** `tool({ name, description, input, output, deps, run })`, `agent({ name, model, instructions, tools, output, deps })`, `defineLoopy({ agents, workflows, deps })`, `rt.run("name", input)`, `ctx.deps.x`, branded IDs. The `DuplicateNameCheck` / collision / `NonNullable DepsOf` fixes are invisible until a user *makes the mistake*, at which point they get a compile error instead of silent corruption.

---

# 5. Open questions + recommended next validation

**Decision-shaped questions for the author:**

1. **Agent-as-Step structural identity (§2.5).** Adopt a shared `Step<In, Out, Err, Deps>` supertype that `Tool` and `Agent` both satisfy (so `tools: readonly AnyStep[]` and sub-agent-as-tool recurses for free, matching the LOCKED "ONE spine") — **or** keep Tool/Agent distinct and require an explicit `agentAsTool()` adapter? (Recommend: shared `Step`.)
2. **workflow primary surface (§2.6).** Lock two-phase `.nodes().flow()` as the documented primary and demote fluent `.step` chaining to linear-flow sugar — or invest in forward-ref holes to keep the single fluent chain? (Recommend: two-phase primary.)
3. **`isolatedDeclarations` as a hard gate (§2.9).** Commit to `isolatedDeclarations: true` for the published package — which *forces* explicit return annotations on every exported factory (more verbose maintainer code) in exchange for guaranteed `.d.ts` portability? (Recommend: yes — it moves every seam failure to the maintainer's compile.)
4. **Duplicate/collision strictness (§2.4/§2.8).** Make duplicate tool names and agent/workflow key collisions **hard compile errors** (via `DuplicateNameCheck` + `keyof A & keyof W` guard), accepting slightly noisier error messages — or leave them as documented footguns?
5. **At-least-once tool semantics (§1.5).** Confirm the contract that **tools must be idempotent or carry `idempotencyKey`** (crash mid-tool re-issues). This is a *user-facing durability contract*, not just an internal detail — it belongs in the tool-authoring docs.

**Recommended next validation — build one tiny real prototype before locking the surface:** the gnarliest inference is **not** any single technique (all compiled in isolation) but their **composition surviving `.d.ts` emit**. Build a ~150-line real package that exports `tool`/`agent`/`workflow`/`defineLoopy` with the three fixes applied, define a realistic 8–12-tool agent + a 5-node two-phase workflow + a `defineLoopy` registry, then **`tsc --emitDeclarationOnly --isolatedDeclarations` and read the generated `.d.ts` and consumer hover.** That single artifact answers the only question the isolated type-models couldn't: whether `ToolDepKeys ∘ Exclude ∘ Pick` over real tool counts stays nameable, portable, and hover-clean across the package boundary — the author's #1 risk. Everything upstream of emit is already proven.
