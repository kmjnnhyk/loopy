# loopy.js — Design-Space Report

A synthesis of six research dimensions into an opinionated design space for an agent-authoring language. Goal: type-safe, low-boilerplate, clear-structure, agent-native.

---

# 1. The Problem loopy.js Must Solve

The bell-agent repo is a hand-rolled agent framework reinvented twice in incompatible styles. The author already knows the *shape* of the work (classify → plan → gather → generate → verify → build → ship) but has no language to express it. The concrete pain:

- **No shared abstraction for "agent," "tool," or "workflow."** An agent is a folder of loosely-related CommonJS modules; "tool" means two different things (external integration module vs. LLM-callable function); "workflow" is an LLM-generated array of step-name strings dispatched through a `stepHandlers` map mutating a shared `ctx` bag. The same task ("LLM edits code") is implemented two ways — SDK tool-use loop in one agent, `spawn("claude", --bypassPermissions)` in another. **loopy must impose ONE canonical shape for tool, agent, and workflow.**
- **The type boundary is regex + JSON.parse with silent fail-open.** Every structured LLM output is recovered by `result.match(/\{[\s\S]*\}/)` then `JSON.parse` in a try/catch that falls back to a fabricated "success" (`failOpenVerdict()`, "fallback to code"). Failures masquerade as results. **loopy must make "LLM returns a typed value conforming to a schema" a first-class primitive with no silent fallback.**
- **Stringly-typed everything.** Categories, step names, job statuses, change types, event channels — all bare strings checked by `includes()`/`switch`. Plus snake_case (DB) ↔ camelCase (code) impedance hand-normalized everywhere (`getIssueKey()` probes both `job.issue_key` and `job.issueKey`). **loopy must replace magic strings with inferred literal/enum types and kill hand-normalization.**
- **The agentic loop and its bugs are re-derived by hand.** The call → parse tool_use → run tool → feed tool_result → repeat loop is hand-written with a turn cap; spec bug #2 was "forgot to accumulate conversation history → duplicate edits." Retries are duplicated `while (!ok && attempt < MAX)` blocks; control flow uses `throw { __earlyReturn }`; side effects are swallowed via `commentBestEffort` / `.catch(() => {})`. **loopy must own the loop, retries, early-exit, and effect handling so authors never re-derive them.**
- **Data between steps flows through a mutable untyped bag; orchestration is duplicated per channel.** `ctx.figmaData`, `ctx.appliedChanges`, etc. lose types and make data-deps implicit. Slack and web handlers re-implement the same pipeline against the same core. **loopy must pass typed data between steps and define a workflow once, independent of transport.**
- **Long-running, human-gated lifecycles are encoded as DB status strings.** The jira agent's `running → awaiting_base → pr_created → needs_input` lifecycle and the design agent's thread↔branch JSON map are durability/HITL reinvented ad-hoc. **loopy should make pause/resume + durable state a language construct.**

"Easier to write agent code" here means: **declare the structure once, get types end-to-end, never hand-roll the loop/retry/parse/progress plumbing, and make pause-resume and provider-swap free.**

---

# 2. Borrowable-Concept Catalog

## (a) Composition & control flow

| Source | Concept | Maps into loopy.js | Verdict |
|---|---|---|---|
| LCEL | Universal `Runnable` interface; everything composes | ONE step interface every node implements (LLM call, tool, sub-workflow) | **Steal** — composites become first-class values; streaming/retry defined once |
| LCEL | `.pipe()` DAG sublanguage | Acyclic pipe for the simple 80% | **Adapt** — offer as sugar over the graph, not a separate framework |
| LangGraph | StateGraph nodes + conditional edges | Workflow = typed nodes + `State→label` routers | **Steal** — subsumes DAG *and* cycles in one model |
| LangGraph | Stringly-typed node names (`addEdge('a','b')`) | — | **Skip** — edges must reference node *values*, compile-checked |
| Vercel AI SDK | `stopWhen`/`stepCountIs` composable stop-conditions | First-class loop-termination predicates | **Steal** — termination as a value, not a hardcoded `while` |
| LangChain | AgentExecutor (opaque imperative loop) | — | **Skip** — make the loop an inspectable graph (LangGraph's own lesson) |
| Mastra | `.step().then().after()` fluent graph | Linear-readable workflow assembly | **Adapt** — keep, but step-to-step inference must be sound |
| Swarm | Emergent multi-agent handoffs | — | **Skip for v1** — implicit control transfer is hard to type/trace |
| AgentKit | Typed Router over typed shared State | Multi-agent as router + state registry | **Adapt** — more analyzable than handoffs if/when multi-agent lands |

## (b) State & durability

| Source | Concept | Maps into loopy.js | Verdict |
|---|---|---|---|
| LangGraph | **Reducer-per-state-channel** (each field declares its merge fn) | `channel<Msg[]>().reducer(append)` — reducer in the type | **Steal** — highest-value idea in the survey; kills "who overwrote my state" bugs |
| Redux | State = `fold(reducer, eventLog, init)` | Run defined as reduction over an append-only event log | **Steal** — buys replay, resume, audit, deterministic tests at once |
| Redux/Saga | **Effects-as-data** (pure code *requests* effect, runtime fulfills, result re-enters as event) | Pure transition emits `callModel`/`invokeTool`; runtime runs it | **Steal** — the mechanism that makes recorded runs replayable without re-calling the LLM |
| Temporal/Redux | Recorded nondeterminism (model output, tool result, time as events) | Log captures effect results → bit-for-bit replay | **Steal** — turns "agent did something weird once" into a saved artifact |
| LangGraph/Mastra | Checkpointer keyed by thread_id; `interrupt()`/resume | `await interrupt(payload)` suspends + checkpoints | **Steal** — durability + HITL as language constructs, not plugins |
| LangChain | Legacy `Memory` abstraction | — | **Skip** — it's just a state channel with append reducer + checkpointer |
| Redux | Over-normalized entity store | — | **Skip** — a conversation log is a list, not a relational cache |
| XState | Finite `state` + extended `context` split | Small enumerable phase + immutable accumulating data | **Steal** — static lifecycle checkability + open data accumulation |

## (c) Type-safety & schema

| Source | Concept | Maps into loopy.js | Verdict |
|---|---|---|---|
| Vercel/Zod | Schema as single source of truth (validation + JSON schema + inferred args) | `tool({ input, run })`, args inferred from schema | **Steal** — the atomic unit |
| ts-dsl | **Standard Schema** (`~standard`) backbone | Accept any validator (zod/valibot/arktype) | **Steal** — table-stakes interop; don't marry Zod |
| LangChain | `withStructuredOutput(schema)` | "LLM call returning type T" as a primitive | **Steal** — kills regex/JSON.parse + silent fallback |
| BAML | **Schema-Aligned Parsing** (own coercion layer) | loopy owns the parser; coerce markdown/partial → schema, typed parse errors | **Steal** — don't trust provider JSON-mode |
| ts-dsl | `const` type params + `satisfies` | Capture literal tool/agent/step names without `as const` | **Steal** — keeps names usable as keys/template types |
| ts-dsl | Builder accumulator (growing `Record<Name, Tool>`) | Agent type knows its full tool set; `agent.call(name, args)` typed | **Steal** — the one place a fluent builder beats a config object |
| Effect-TS | Three-channel `Task<A, E, R>` (out, errors, deps) | `LoopyTask<Out, Err, Deps>` — typed errors + deps in signature | **Adapt** — borrow the *signature concept*, not the full fiber runtime |
| ts-dsl | Branded/nominal IDs | `ToolId`/`RunId`/`ThreadId` can't be mixed | **Steal** — cheap, huge correctness win |
| BAML/external | External `.loopy` DSL + codegen | — | **Skip** — breaks go-to-def, build step, debug indirection for a TS-only audience |
| DSPy | Prompt as compiled artifact from a declared signature | Prompt generated-from-declaration, versionable/eval-able | **Adapt** — borrow the mindset; full optimizer is a stretch goal |

## (d) Wiring & structure (DI / registry / layers)

| Source | Concept | Maps into loopy.js | Verdict |
|---|---|---|---|
| Spring/Pydantic AI | Constructor/factory injection of typed deps | `defineAgent({ deps, run })`; runtime supplies typed `deps` | **Steal** — Spring's best idea minus reflection |
| Pydantic AI | `Agent<Deps, Out>` + `RunContext[Deps]` | Deps + result in the type; injectable fakes | **Steal** — compile-time wiring, great testability |
| Spring | Explicit registry vs classpath/filesystem scan | `registry.register(agent)` — greppable | **Steal explicit; Skip scan** — auto-scan is JS annotation-magic |
| Spring | Decorator DI via `reflect-metadata` | — | **Skip** — fragile, erases at runtime, breaks bundlers/edge |
| Spring | Front-controller dispatch keyed by name+schema | One `dispatch(toolName, args)` = the LLM tool manifest, single source | **Steal** — registry IS the tool list |
| Spring | Scopes (app/session/turn) | `AppScope`/`SessionScope`/`TurnScope` lifetimes | **Adapt** — ship only these three; resist the bean-scope zoo |
| Spring | Profiles (dev/test/prod beans) | Named runtime configs: stub LLM + in-mem store vs Claude + pgvector | **Steal** — deterministic offline agent tests |
| Spring | Global `ApplicationContext` singleton / service locator | — | **Skip** — pass typed context explicitly |

## (e) Cross-cutting (observability, retries, guardrails)

| Source | Concept | Maps into loopy.js | Verdict |
|---|---|---|---|
| Spring AOP | Cross-cutting via composable middleware | `compose([withTracing, withRetry, withCache, withGuardrails])`, explicit order | **Steal** — function composition, not bytecode proxies |
| LCEL | `withRetry`/`withFallbacks`/timeout as type-preserving wrappers | Resilience decorators that keep I/O types | **Steal** — but make bound config show in the type (LCEL's `.bind()` is type-lossy) |
| LangGraph | Structured event stream (`streamEvents`: start/token/end on a run-tree id) | Every step auto-emits step events; pluggable sinks (WS/Slack/log) | **Steal** — replaces hand-threaded `emit()` + `ProgressTracker` |
| LangChain | Manual `RunnableConfig` threading | — | **Skip** — thread run context implicitly via async-context, not a param |
| OpenAI Agents | Guardrails as typed pre/post validators that short-circuit | Input/output guards with own schemas | **Steal** — capability boundaries as declarative guards |
| bell-agent | "Best-effort vs must-succeed" effects + verify/repair loop | First-class effect criticality + reusable self-check primitive | **Steal** — replaces `.catch(() => {})` swallowing |

## (f) Authoring DX / syntax

| Source | Concept | Maps into loopy.js | Verdict |
|---|---|---|---|
| ts-dsl | Internal TS DSL (factories + config objects) | Stay internal; full LSP for free | **Steal** — the foundational stance |
| ts-dsl | Many small inferable factories > one mega-generic | `tool`/`agent`/`step`/`workflow` each a thin factory | **Steal** — shallow generics = short error messages |
| ts-dsl | Name intermediate types (`Tool<N,In,Out>`) | Readable hovers/errors, not 40-line structural blobs | **Steal** |
| BAML/Mastra | Hot-reloadable prompt playground + co-located tests | `loopy` CLI: preview rendered prompt, run example cases | **Adapt** — even internal DSL can ship this |
| ts-dsl | Bun CLI for scaffold/run/dev (NOT type codegen) | `loopy new`, `loopy run agent.ts`, watch | **Steal** — codegen only for non-type artifacts (JSON manifests) |
| Vercel | `experimental_` namespace convention | Ship unstable APIs behind a prefix | **Adapt** — use sparingly, graduate APIs |
| bell-agent | Raw shell-string git/gh, `/tmp` PR-body files | — | **Skip** — a tool abstraction should hide this plumbing |

---

# 3. The Core Mental Model (pick ONE spine)

**Recommendation: a principled hybrid — an event-sourced reducer core with an XState-style finite phase, exposed through a typed graph whose nodes/edges are checked at compile time. The atomic unit is the `Step`; everything (tool, LLM call, agent, sub-workflow) is a `Step`, and a workflow is a graph of Steps over a typed, reducer-merged `State`.**

Evaluating the candidates as the *spine*:

- **(i) Runnable/pipe (LCEL).** Beautiful composition ergonomics, but models **DAGs only**. Agents are cyclic (think→act→observe) and need shared mutable state and pause/resume. LCEL structurally can't, which is exactly why LangChain had to build a *second* framework. **Reject as spine; keep `.pipe()` as acyclic sugar.**
- **(ii) Reducer / event-sourced (Redux/LangGraph).** `state = fold(reducer, eventLog, init)` + effects-as-data gives replay, resume, audit, durability, and deterministic orchestration tests *simultaneously* — and directly answers the bell-agent pains (mutable `ctx` bag, no resume, no replay, hand-rolled loop). The reducer-per-channel idea is the single highest-value steal. **This is the load-bearing core.**
- **(iii) Statechart (XState).** Makes the agent *lifecycle* (planning/acting/reflecting/done), guards (budget/turn-limit/permission), and illegal-transition-prevention statically enumerable and visualizable. But full statechart ceremony is overkill for a 3-step linear agent. **Adopt the finite-phase + extended-context split, make the rich statechart features (parallel regions, actors) opt-in.**
- **(iv) Effectful typed pipeline (Effect).** The `<Out, Err, Deps>` signature is the right *type-level* discipline — it forces exhaustive error handling and dependency provision, killing the silent fail-open pattern. But Effect's full fiber runtime is a steep dep and learning curve. **Adopt the three-channel *type*, not the runtime; layer it over the reducer core as the static contract of a Step.**
- **(v) Fluent step-builder (Mastra/Vercel).** Best *surface syntax* — reads top-to-bottom, low ceremony. But "structure implicit in call order" is precisely bell-agent's disease, and inter-step inference is where these frameworks leak. **Adopt as the authoring veneer over a declarative graph, never as the source of truth.**

**Why the hybrid and not a pure pick:** each candidate owns a different axis. Reducer/event-log owns *durability & determinism*. Statechart owns *control-flow legality*. Effect owns *type-level error/dep safety*. Builder owns *syntax ergonomics*. XState already proves reducer-context + finite-state coexist; loopy adds the Effect-style three-channel type on the Step and a compile-checked graph on top. None of the four conflicts — they layer.

**The atomic unit — the `Step`:**

```
Step<In, Out, Err, Deps>  — a pure-ish transition that, given In + typed Deps,
                            produces Out (or a typed Err) by REQUESTING effects.
```

Everything reduces to a Step:
- **A tool** is a `Step<Args, Result>` whose Args/Result come from a Standard Schema (and which doubles as an entry in the LLM tool manifest).
- **An LLM call** is a `Step<Prompt, T>` where `T` is a schema-bound structured output (own coercion layer).
- **An agent** is a `Step` that *internally* runs the built-in think→act→observe loop graph over a `State` with a `messages` channel (append reducer) and a finite phase — i.e. an agent is a pre-assembled cyclic workflow.
- **A workflow** is a graph of Steps connected by edges (sequential) and routers (`State → nextStepValue`, compile-checked), folded over an append-only event log with reducer-merged channels.

So the layering is: **`Step` (unit) → `State` with reducer channels (data) → graph of Steps with typed routers (control) → event-log fold + checkpointer (durability) → middleware chain (cross-cutting) → typed `Deps`/`Err` channels (static safety).** One spine; agents/tools/workflows are all just configurations of it.

---

# 4. Three Candidate Architectures

All three implement the **same tiny example**: an agent with one tool (`getWeather`) doing a 2-step task — call the model, which calls the tool, feed the result back, return a typed answer. Internal TS DSL in all three (the research is decisive: external DSL is the wrong tax for a TS-only audience). They differ in *spine* and *how much structure is imposed*.

---

## Architecture A — Lightweight Functional / Pipe ("the ergonomic minimum")

- **Spine:** LCEL-style `Step` composition with a built-in agent loop as one composite Step. Acyclic for workflows; cycles hidden inside the prebuilt agent loop.
- **Agent declared:** `agent({ model, tools, output })` returns a callable Step. The loop is owned by the runtime (no hand-rolling, no bug #2).
- **Tool declared:** flat value `tool({ name, input, run })`, args inferred from schema; tools collection is a plain typed record = the LLM manifest.
- **Workflow:** `.pipe()` chaining of Steps; data flows as typed values (output of one = input of next), no mutable bag.
- **State/memory:** ephemeral by default; conversation memory is an opt-in `messages` channel passed by `threadId`. No event log unless you opt into durability.
- **DI/wiring:** factory closure — `createRuntime({ llm, ...deps })` returns a context; agents/tools close over typed `deps`.
- **Cross-cutting:** `.withRetry()`, `.withTracing()` decorators on any Step, type-preserving.
- **DSL stance:** internal TS, config-object factories + minimal `.pipe()`. No statechart, no first-class event log.
- **Headline tradeoff:** **lowest boilerplate and easiest to learn, but durability/resume/replay are bolt-ons, and complex branching/HITL workflows fall back to ad-hoc code** — i.e. you re-enter bell-agent territory at the high end.

```ts
const getWeather = tool({
  name: "getWeather",
  input: z.object({ city: z.string() }),
  run: async ({ city }, { deps }) => deps.weatherApi.lookup(city), // typed deps
});

const weatherAgent = agent({
  model: "claude-opus",
  tools: [getWeather],                       // record → LLM manifest, single source
  output: z.object({ summary: z.string(), tempC: z.number() }),
  stopWhen: stepCountIs(4),                   // composable termination
}).withRetry({ tries: 3 }).withTracing();

const runtime = createRuntime({
  llm: process.env.NODE_ENV === "test" ? stubLLM() : claude(),
  weatherApi: new OpenWeather(),
});

// 2-step task: model → tool → model → typed answer (loop owned by runtime)
const out = await runtime.run(weatherAgent, { prompt: "weather in Seoul?" });
//    out: { summary: string; tempC: number }   — inferred, validated, no regex parse
```

---

## Architecture B — Structured Reducer / State-Machine with Durability ("the production agent runtime") — RECOMMENDED CORE

- **Spine:** event-sourced reducer (`state = fold(reducer, log)`) + finite phase + effects-as-data, exposed as a compile-checked graph of Steps. This is §3's hybrid.
- **Agent declared:** `agent()` is a prebuilt cyclic graph (`think → act → reflect → done`) over a `State` with `messages` (append reducer) and a phase. You can drop to the raw `workflow()` graph when you need custom control flow.
- **Tool declared:** identical `tool({ name, input, run })` — a Step; tool result enters the log as a recorded event.
- **Workflow:** `workflow({ state }).node(...).from(A).to(B).from(B).branch(state => …)` — edges reference node *values* (compile-checked), routers are `State→nodeValue`.
- **State/memory:** the `State` schema declares per-channel reducers; the run *is* an append-only event log; memory = same graph + same `threadId`, replayed from the log.
- **DI/wiring:** `LoopyTask<Out, Err, Deps>` three-channel type; `provide(dep)` removes a dep from the channel; only a task with `Err & Deps = never` is runnable (compiler-enforced, kills silent fail-open).
- **Cross-cutting:** middleware chain in the dispatch pipeline (`log → trace → guardrail → checkpoint → reduce`), explicit order; step events auto-emitted to pluggable sinks.
- **Durability:** checkpointer keyed by `threadId`; `interrupt(payload)` suspends + checkpoints; resume injects a value as the next event. (Directly replaces jira's DB-status state machine and design's thread-map.)
- **DSL stance:** internal TS; declarative graph is the source of truth; a thin fluent veneer for assembly.
- **Headline tradeoff:** **most powerful — replay, resume, HITL, audit, deterministic tests, statically-legal transitions — at the cost of more concepts (channels, reducers, event log) than a 3-step script needs.** Mitigation: make the graph/log invisible for the simple `agent()` case (Architecture A's ergonomics are the easy path *into* this runtime).

```ts
const getWeather = tool({
  name: "getWeather",
  input: z.object({ city: z.string() }),
  run: ({ city }) => weatherApi.lookup(city),        // result recorded as an event
});

const weather = workflow({
  state: {
    messages: channel<Msg[]>().reducer(append).default([]),
    answer:   channel<Answer>().reducer(overwrite),  // each field declares its merge
  },
  deps: { weatherApi: WeatherApi },                  // appears in Deps channel until provided
})
  .node("think", llmNode({ model: "claude-opus", tools: [getWeather],
                           output: z.object({ summary: z.string(), tempC: z.number() }) }))
  .node("act", toolNode([getWeather]))
  .from(START).to(think)
  .from(think).branch(s => s.last.toolCalls ? act : DONE)   // typed router, compile-checked
  .from(act).to(think)                                       // cycle — type-checked
  .durable(sqliteCheckpointer);                              // resume/replay/HITL built in

const out = await provide(weather, { weatherApi })           // Deps → never
  .run({ messages: [user("weather in Seoul?")] }, { threadId: "t-42" });
// replay: fold the saved log — zero LLM calls. resume: rehydrate + keep folding.
```

---

## Architecture C — Decorator / DI "Spring-for-Agents" ("the enterprise-structured option")

- **Spine:** layered IoC — front-controller dispatch + container-wired components; control flow is imperative inside service methods.
- **Agent declared:** a class with `@Agent`, deps via constructor injection; methods are handlers. Registration explicit (`registry.register`) — but the decorator implies `reflect-metadata`.
- **Tool declared:** `@Tool` method or `@ToolClass`, schema via decorator metadata.
- **Workflow:** orchestration logic lives in a `@Service` method calling tools/LLM imperatively (closest to today's bell-agent, but structured into layers: Controller → Agent → Tool → Infra).
- **State/memory:** session/turn scopes as DI-scoped beans; memory is a session-scoped component.
- **DI/wiring:** the heaviest — a container resolves the dependency graph; profiles select impls.
- **Cross-cutting:** AOP-style interceptors (`@Retry`, `@Trace`, `@Guardrail`) on methods.
- **DSL stance:** decorator-heavy internal DSL leaning on `reflect-metadata` + `emitDecoratorMetadata`.
- **Headline tradeoff:** **familiar layered structure and clean DI, but the research is explicit that decorator-DI is the JS incarnation of Spring's reflection opacity** — fragile under esbuild/swc/edge, erases at runtime, "where is this dep from?" un-greppable, and control flow stays imperative (no replay/resume). **Recommended only if the team strongly prefers OO/Spring idioms; otherwise its DI benefits are fully available in B via plain typed factories.**

```ts
@Tool({ name: "getWeather", input: z.object({ city: z.string() }) })
class GetWeather {
  constructor(private weatherApi: WeatherApi) {}     // constructor injection
  run({ city }: { city: string }) { return this.weatherApi.lookup(city); }
}

@Agent({ model: "claude-opus", tools: [GetWeather] })
class WeatherAgent {
  constructor(private llm: LlmClient) {}
  @Retry(3) @Trace()                                  // AOP-style interceptors
  async handle(prompt: string) {
    return this.llm.loop({ prompt, tools: this.tools,  // loop owned by base class
      output: z.object({ summary: z.string(), tempC: z.number() }) });
  }
}

const ctx = createContainer({ profile: process.env.NODE_ENV });  // wires deps + profiles
ctx.register(WeatherAgent, GetWeather);
const out = await ctx.run(WeatherAgent, "weather in Seoul?");
//    requires reflect-metadata + emitDecoratorMetadata — the known footgun
```

---

# 5. Recommendation

**Adopt Architecture B as the core runtime, with Architecture A's surface ergonomics as the default easy path into it. Reject C's decorator-DI; take its structural ideas (explicit registry, typed scopes, profiles, middleware) implemented as plain functional DI inside B.**

**Why B fits the four goals best:**

- **Type-safe:** the `LoopyTask<Out, Err, Deps>` three-channel type forces exhaustive error handling and dependency provision — the compiler refuses to run a workflow with an unhandled tool error or unprovided dep. This *structurally eliminates* bell-agent's #1 disease: regex-parsed JSON with silent fail-open. Reducer-per-channel types make state merges sound; `const` generics + Standard Schema keep names and args inferred end-to-end with no `as any`.
- **Low-boilerplate:** the agentic loop, retries, early-exit, progress events, and parse/coercion are all owned by the runtime — exactly the hand-rolled plumbing (loop, bug #2, duplicated retry blocks, `emit()` threading, `throw {__earlyReturn}`) that loopy must erase. For the common case the author writes the A-style `agent({...})` and never sees the graph or log.
- **Clear structure:** one spine. Tool, LLM call, agent, and workflow are all `Step`s; the graph is declarative and *visualizable* (statechart heritage); the registry is the single source of truth for the LLM tool manifest. No more "two meanings of tool," no per-channel duplicated orchestrators, no mutable `ctx` bag.
- **Agent-native:** durability, `interrupt()`/resume, replay, and audit are first-class — directly replacing the jira DB-status machine and the design thread-map, and making the verify/repair loop and human-in-the-loop base-branch pause language features rather than scattered code.

The key design move is **progressive disclosure**: `agent({ model, tools, output })` (A-style) is sugar that compiles to a B-style prebuilt graph. Authors reach for raw `workflow()` + channels + routers only when they need custom branching, durability, or HITL. This gives Mastra/Vercel low-ceremony authoring on top of a LangGraph/Temporal-grade core, without LCEL's "rewrite when you need a cycle" cliff.

**Top 3 risks:**

1. **Inference at the seams.** The whole value prop dies if step-to-step types, the reducer-channel update shape, and the `Deps`/`Err` channels degrade to `any`/`unknown` at composition boundaries (every TS agent framework leaks here). Mitigation: keep generics shallow, name intermediate types, prototype the gnarliest inference (router return narrowing, builder accumulator, `provide()` removing a dep from a union) *first* — before committing to the surface API.
2. **Concept overload vs. "low-boilerplate."** Event log, reducer channels, three-channel tasks, finite phase, middleware — this is a lot of surface for someone who just wants "call an LLM with a tool." If progressive disclosure isn't airtight, the simple case feels heavy and authors bounce. Mitigation: the A-path must require *zero* mention of channels/log/Deps for the 80% case; durability is opt-in via one `.durable()` call.
3. **Durability constrains everything and can't be retrofitted.** Serializable state, idempotent/memoized effects, and effects-as-data must be designed from day one (the research is emphatic: bolting it on later is a rewrite). Risk: the effects-as-data discipline (pure transition requests effect; runtime fulfills; result re-enters as event) is unfamiliar and easy to violate by sneaking I/O into a node. Mitigation: make the effect boundary ergonomic (async-looking control flow that compiles to recorded effects) so authors aren't tempted to bypass it, and lint/type-guard against I/O in pure transitions.

---

# 6. Open Design Questions for the Author

1. **Internal TS DSL only, or a future external `.loopy`?** Options: (a) **internal TS forever** (full LSP, zero codegen — research strongly favors this); (b) internal now, external escape-hatch later for non-dev authors or prompt optimization; (c) BAML-style external for cross-language clients. *Decision shapes everything downstream.* Recommended default: (a).

2. **Is durability/checkpointing a v1 requirement or v2?** Options: (a) **v1 first-class** (`.durable()`, `interrupt()`, replay) — but it constrains state/effects design from day one; (b) v1 ships ephemeral (Architecture A) with a durability-compatible *internal* design, durability lands v2; (c) durability is always opt-in. The bell-agent jira lifecycle and design thread-map argue it's a real need — but is it *day-one*?

3. **How much of the event-sourced/effects-as-data discipline do authors see?** Options: (a) **fully hidden** — authors write normal async tool/LLM code, runtime records under the hood; (b) partially exposed — pure transitions return effect descriptions explicitly (more correct, less familiar); (c) hybrid: hidden by default, exposed for advanced replay/HITL. This trades determinism guarantees against learning curve.

4. **Multi-agent in v1 — and which metaphor?** Options: (a) **single-agent v1**, multi-agent deferred; (b) v1 ships router-over-typed-shared-state (AgentKit-style, analyzable); (c) v1 ships handoffs (Swarm-style, emergent but hard to type/trace). Research favors (a) then (b). The bell-agent repo has no multi-agent need yet — is this premature?

5. **Streaming first-class or additive?** Options: (a) **every Step streams by default** (LCEL-style — inherited free if the Step interface defines it), with structured step events to pluggable sinks (WS/Slack/log); (b) streaming opt-in per call. bell-agent had two divergent progress mechanisms — does loopy unify them via auto-emitted step events from day one?

6. **How opinionated about prompt management?** Options: (a) prompts are plain typed template values co-located with the Step; (b) **prompts as declared, versioned, eval-able artifacts** (DSPy/BAML mindset) with a playground; (c) full optimizer/compiler (DSPy-grade, heavy). bell-agent's scattered template-literal constants are a clear pain — but how far toward "prompt-as-compiled-artifact" do you go in v1?

7. **Human-in-the-loop as a primitive?** Options: (a) **`interrupt()`/resume language construct** (suspend + checkpoint + inject value) in v1; (b) HITL via external event + manual re-invocation (today's approach); (c) deferred. The jira "pause at `awaiting_base` for human base-branch choice" is a concrete v1 use case — primitive or pattern?

8. **Structured-output coercion — own it or trust the provider?** Options: (a) **own a Schema-Aligned-Parsing layer** (BAML-style: coerce markdown/partial/trailing-comma → schema, typed parse errors); (b) rely on provider JSON-mode/function-calling; (c) provider JSON-mode with own-parser fallback. Research is emphatic that (b) alone inherits every provider quirk as a runtime error — and bell-agent's silent fail-open is the cautionary tale. How much parser engineering is in scope?

9. **Which schema-validator stance, and how strict on Standard Schema?** Options: (a) **Standard Schema interface only** (zod/valibot/arktype all work — future-proof); (b) Zod-first with a Standard Schema adapter; (c) own minimal schema type. Plus: do tool *outputs* get schemas too (enabling end-to-end output inference into the message history — where Vercel leaks and loopy can win), or only inputs?
