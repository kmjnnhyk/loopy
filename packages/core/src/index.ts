// loopy.js — core type-machinery + factories.
// "React for agents": every unit reduces to a Step<In, Out, Err, Deps>.
//
// Three compile-forced fixes from the verification campaign are applied here and
// flagged inline:  ①AnyStep schema slots = IO<any,any>  ②shared Step supertype
// ③DepsOf NonNullable extractor.  Every exported factory carries an EXPLICIT
// return type so `isolatedDeclarations: true` passes and the emitted .d.ts keeps
// the synthetic type *names* (no anonymous blobs). Internal const tables may use
// `satisfies`; exported factory returns never do.
//
// ESM cycle note (Task 13): runtime/* modules import VALUES from this module
// (END, lastChannel, …) and this module imports runtime VALUES back — a genuine
// ESM cycle. Safe because both sides only ACCESS the cross-module values inside
// function bodies (driver factories, defineLoopy/loopy call time), never at
// module top-level evaluation. Type-only imports are unaffected either way.

import { runThread as _runThread } from "./runtime/scheduler.ts";
import { workflowDriver } from "./runtime/drivers/workflow.ts";
import { agentDriver, agentNode } from "./runtime/drivers/agent.ts";
import { teamDriver } from "./runtime/drivers/team.ts";
import { memoryStore } from "./runtime/store.ts";
import type { Checkpointer } from "./runtime/store.ts";
import type { ModelClient } from "./runtime/model.ts";
import { threadId as mkThreadId } from "./runtime/events.ts";
import type { Event as RuntimeEvent } from "./runtime/events.ts";
import type { Driver } from "./runtime/scheduler.ts";
import { replayThread } from "./runtime/replay.ts";
import type { ReplayResult } from "./runtime/replay.ts";

/* ============================================================================
 * §0 — Dependency registry (augmentable) + capability contexts
 * ========================================================================== */

/** Consumers augment via `declare module "@loopyjs/core" { interface LoopyDeps {…} }`. */
export interface LoopyDeps {}

/** A tool's run-context: only the *declared* slice of deps, nothing else. */
export interface ToolCtx<D extends keyof LoopyDeps> {
  readonly deps: Pick<LoopyDeps, D>;
  /** HITL: suspend the run; resolves with the typed resume value. Exposed on the
   *  tool ctx so a declarative (bodyless) agent can request approval via a tool
   *  (spec §7 / §12c — a controlled extension of the locked ToolCtx). */
  interrupt<T>(payload: unknown): Promise<T>;
}

/** An agent's run-context (loop-owner; same dep slice). */
export interface AgentCtx<D extends keyof LoopyDeps> {
  readonly deps: Pick<LoopyDeps, D>;
}

/** A workflow node's run-context — adds HITL `interrupt`. */
export interface NodeCtx<D extends keyof LoopyDeps> {
  readonly deps: Pick<LoopyDeps, D>;
  /** Suspend the run; resolves with the resume value (typed payload channel). */
  interrupt<T>(payload: unknown): Promise<T>;
}

/* ============================================================================
 * §1 — Schema → static type  (Standard-Schema-shaped phantom carrier `IO`)
 * ========================================================================== */

/** Vendor-neutral Standard-Schema-shaped carrier. Static in/out live in the
 *  phantom `types`; `validate` coerces at runtime (Schema-Aligned Parsing). */
export interface IO<In, Out = In> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => { readonly value: Out } | { readonly issues: readonly { readonly message: string }[] };
    readonly types?: { readonly input: In; readonly output: Out };
  };
}

export type InferIn<S extends IO<any, any>> = NonNullable<S["~standard"]["types"]>["input"];
export type InferOut<S extends IO<any, any>> = NonNullable<S["~standard"]["types"]>["output"];

/** Minimal schema constructor (prototype: validate is identity). Explicit
 *  return type → emitter writes `IO<…>` verbatim. */
export function io<Out, In = Out>(vendor: string = "loopy"): IO<In, Out> {
  return {
    "~standard": {
      version: 1,
      vendor,
      validate: (value: unknown): { readonly value: Out } => ({ value: value as Out }),
    },
  };
}

/* ============================================================================
 * §2 — Step supertype.   FIX ②: Tool AND Agent both satisfy Step, so an agent
 *      passed where a tool is expected recurses for free (sub-agent-as-tool).
 *      FIX ①: AnyStep widens schema slots to IO<any,any>. `run` is a PROPERTY
 *      (arrow) → strictFunctionTypes checks its param CONTRAVARIANTLY; the
 *      `any` slots are bidirectionally compatible and bypass the variance
 *      check, so real Tools/Agents bind to `readonly AnyStep[]`. (A concrete
 *      StandardSchema slot would collapse InferOut → unknown and reject every
 *      real tool with TS2322.)
 * ========================================================================== */

export interface Step<
  Name extends string,
  In extends IO<any, any>,
  Out extends IO<any, any>,
  Deps extends keyof LoopyDeps,
> {
  readonly name: Name;
  readonly input: In;
  readonly output: Out;
  /** phantom dep-key union — the extraction target for ToolDepKeys / DepsOf. */
  readonly "~deps"?: Deps;
  /** runtime dep-key array capture (Task 10) — consumed by the interpreter's ctx slicing. */
  readonly "~depKeys"?: readonly string[];
  // FIX ① (completed): BOTH slots are `any`, not just the schema-derived input.
  // `ctx: unknown` would re-introduce the contravariant failure — top-type
  // `unknown` is not assignable to a concrete `ToolCtx<…>` in param position, so
  // real Tools/Agents would fail to bind to AnyStep. `any` is bidirectional.
  readonly run: (input: InferOut<In>, ctx: any) => Promise<InferOut<Out>>;
}

/** ① the variadic-collection upper bound: `any` schema slots, not StandardSchema. */
export type AnyStep = Step<string, IO<any, any>, IO<any, any>, keyof LoopyDeps>;

/* ============================================================================
 * §3 — tool()  (model-less; deps DECLARED, not inferred)
 * ========================================================================== */

export interface Tool<
  Name extends string,
  In extends IO<any, any>,
  Out extends IO<any, any>,
  Deps extends keyof LoopyDeps,
> extends Step<Name, In, Out, Deps> {
  readonly "~kind": "tool";
  readonly description: string;
  readonly run: (input: InferOut<In>, ctx: ToolCtx<Deps>) => Promise<InferOut<Out>>;
  /** at-least-once durability contract: crash mid-tool re-issues → idempotency. */
  readonly idempotencyKey?: (input: InferOut<In>) => string;
}

export function tool<
  const Name extends string,
  In extends IO<any, any>,
  Out extends IO<any, any>,
  const D extends readonly (keyof LoopyDeps)[] = [],
>(def: {
  name: Name;
  description: string;
  input: In;
  output: Out;
  deps?: D;
  idempotencyKey?: (input: InferOut<In>) => string;
  run: (input: InferOut<In>, ctx: ToolCtx<D[number]>) => Promise<InferOut<Out>>;
}): Tool<Name, In, Out, D[number]> {
  return {
    "~kind": "tool",
    name: def.name,
    description: def.description,
    input: def.input,
    output: def.output,
    idempotencyKey: def.idempotencyKey,
    "~depKeys": def.deps ?? [],
    run: def.run,
  } as Tool<Name, In, Out, D[number]>;
}

/* ============================================================================
 * §4 — agent()  (model-owning loop; accumulates tool dep-keys + names)
 * ========================================================================== */

export type ToolMap<T extends readonly AnyStep[]> = { [E in T[number] as E["name"]]: E };

/** distributive dep-union over all tools (incl. sub-agents). */
export type ToolDepKeys<T extends readonly AnyStep[]> = NonNullable<T[number]["~deps"]>;

/** duplicate-name guard: yields the colliding names, else never. */
type Duplicates<T extends readonly AnyStep[]> = T extends readonly [
  infer H extends AnyStep,
  ...infer R extends readonly AnyStep[],
]
  ? H["name"] extends R[number]["name"]
    ? H["name"]
    : Duplicates<R>
  : never;

/** intersect into the `tools` param: unknown (clean) vs a branded error field. */
export type NoDuplicateTools<T extends readonly AnyStep[]> = [Duplicates<T>] extends [never]
  ? unknown
  : { readonly "~duplicateToolName": Duplicates<T> };

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
  readonly instructions: string;
  readonly maxSteps?: number;
  readonly parseRetries?: number;
  /** the concrete tool tuple is PRESERVED (not widened to AnyStep[]) so a
   *  consumer's `ToolDepKeys<typeof agent.tools>` stays precise across .d.ts. */
  readonly tools: Tools;
  /** phantom: union of declared passTo target NAMES (§6 candidate ii). */
  readonly "~passTo"?: Pass;
  /** runtime passTo-name array capture (Task 10) — consumed by the interpreter. */
  readonly "~passToNames"?: readonly string[];
  readonly run: (input: InferOut<In>, ctx: AgentCtx<Deps>) => Promise<InferOut<Out>>;
}

export function agent<
  const Name extends string,
  In extends IO<any, any>,
  Out extends IO<any, any>,
  const Tools extends readonly AnyStep[] = [],
  const D extends readonly (keyof LoopyDeps)[] = [],
  const Pass extends readonly string[] = [],
>(def: {
  name: Name;
  model: string;
  instructions: string;
  input: In;
  output: Out;
  tools?: Tools & NoDuplicateTools<Tools>;
  deps?: D;
  passTo?: Pass;
  maxSteps?: number;
  parseRetries?: number;
}): Agent<Name, In, Out, D[number] | ToolDepKeys<Tools>, Tools, Pass[number]> {
  return {
    "~kind": "agent",
    name: def.name,
    model: def.model,
    instructions: def.instructions,
    maxSteps: def.maxSteps,
    parseRetries: def.parseRetries,
    input: def.input,
    output: def.output,
    tools: (def.tools ?? []) as Tools,
    "~depKeys": def.deps ?? [],
    "~passToNames": def.passTo ?? [],
    run: undefined as never,
  } as Agent<Name, In, Out, D[number] | ToolDepKeys<Tools>, Tools, Pass[number]>;
}

/** ~passTo extractor — NonNullable (NOT a constrained infer; see Global Constraints). */
export type PassToOf<A> = A extends { readonly "~passTo"?: infer P } ? NonNullable<P> : never;

/** variadic upper bound for team agent records. */
export type AnyAgent = Agent<string, IO<any, any>, IO<any, any>, keyof LoopyDeps, readonly AnyStep[], string>;

/** P1: template-literal mapped type — the synthesized handoff tool manifest. */
export type PassToolNames<Pass extends string> = {
  readonly [N in Pass as `pass_to_${N}`]: { readonly target: N };
};

/* ============================================================================
 * §5 — channels + workflow (two-phase .nodes().flow(); no forward-ref leak)
 * ========================================================================== */

export interface Channel<V, U = V> {
  readonly "~value": V;
  readonly "~update": U;
  readonly reduce: (current: V, update: U) => V;
  readonly initial: () => V;
}

export type StateOf<C> = { readonly [K in keyof C]: C[K] extends Channel<infer V, any> ? V : never };

export function lastChannel<T>(init: T): Channel<T, T> {
  return { "~value": undefined as never, "~update": undefined as never, reduce: (_c, u) => u, initial: () => init };
}

export function listChannel<T>(): Channel<readonly T[], T | readonly T[]> {
  return {
    "~value": undefined as never,
    "~update": undefined as never,
    reduce: (c, u) => (Array.isArray(u) ? [...c, ...u] : [...c, u as T]),
    initial: () => [],
  };
}

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
    initial: (() => undefined) as never, // seeded at run; no static init
    "~input": true,
  };
}
/** select only the ~input-branded channels → the team's run-input shape. */
export type TeamInputOf<State> = {
  readonly [K in keyof State as State[K] extends InputChannel<any> ? K : never]:
    State[K] extends InputChannel<infer T> ? T : never;
};

export const END: "~end" = "~end";
export type END = typeof END;

/* ── workflow node binding (runtime spec §5 — additive) ───────────────────── */

export interface NodeBinding<St extends AnyStep, W extends string = never> {
  readonly "~binding": true;
  readonly step: St;
  /** state view → node input. v1 leak: source param is `any`; the RETURN is checked. */
  readonly reads?: (s: any) => InferOut<St["input"]>;
  readonly writes?: W;
}

export function node<St extends AnyStep, const W extends string = never>(
  step: St,
  binding: { reads?: (s: any) => InferOut<St["input"]>; writes?: W } = {},
): NodeBinding<St, W> {
  return { "~binding": true, step, reads: binding.reads, writes: binding.writes };
}

/** run-input auto channel: every node's reads/router sees `s.input`. */
export type WorkflowView<State, In extends IO<any, any>> = StateOf<State> & { readonly input: InferOut<In> };

/** per-slot guard: writes must name an existing channel AND output ⊑ channel value;
 *  a bare Step (no binding) is allowed only when the full state view satisfies its input;
 *  a value that is neither a Step nor a node() binding is branded "~nodeInvalid" —
 *  this closes the gap left by nodes()'s loosened Record<string, unknown> bound. */
export type BindingCheck<State, In extends IO<any, any>, N> = {
  [K in keyof N]: N[K] extends NodeBinding<infer St, infer W>
    ? [W] extends [never]
      ? N[K]
      : W extends keyof State
        ? [InferOut<St["output"]>] extends [ChannelValueOf<State[W]>]
          ? N[K]
          : { readonly "~nodeOutputNotAssignableToChannel": { readonly node: K; readonly channel: W } }
        : { readonly "~writesUnknownChannel": W }
    : N[K] extends AnyStep
      ? [WorkflowView<State, In>] extends [InferOut<N[K]["input"]>]
        ? N[K]
        : { readonly "~nodeNeedsReads": K }
      : { readonly "~nodeInvalid": K };
};

/** A workflow node = any Step (tool / agent / inline step). */
export function step<
  const Name extends string,
  In extends IO<any, any>,
  Out extends IO<any, any>,
  const D extends readonly (keyof LoopyDeps)[] = [],
>(def: {
  name: Name;
  input: In;
  output: Out;
  deps?: D;
  run: (input: InferOut<In>, ctx: NodeCtx<D[number]>) => Promise<InferOut<Out>>;
}): Step<Name, In, Out, D[number]> {
  return {
    name: def.name,
    input: def.input,
    output: def.output,
    "~depKeys": def.deps ?? [],
    run: def.run as never,
  } as Step<Name, In, Out, D[number]>;
}

export interface Workflow<
  Name extends string,
  State,
  In extends IO<any, any>,
  Out extends IO<any, any>,
  Deps extends keyof LoopyDeps,
> {
  readonly "~kind": "workflow";
  readonly name: Name;
  readonly state: State;
  readonly input: In;
  readonly output: Out;
  readonly "~deps"?: Deps;
  /** runtime graph capture (Task 10); type narrowed in the runtime module. */
  readonly "~graph"?: unknown;
}

/** dep-union accumulated from every node in the workflow. */
export type NodeDepKeys<Nodes> = NonNullable<
  { [K in keyof Nodes]: Nodes[K] extends { readonly "~deps"?: infer D } ? D : never }[keyof Nodes]
> &
  keyof LoopyDeps;

export interface FlowBuilder<S, NodeName extends string> {
  start(node: NodeName): FlowBuilder<S, NodeName>;
  edge(from: NodeName, to: NodeName | END): FlowBuilder<S, NodeName>;
  branch(from: NodeName, router: (s: S) => NodeName | END): FlowBuilder<S, NodeName>;
}

export interface WorkflowFlowed<
  Name extends string, State, In extends IO<any, any>, Out extends IO<any, any>, Deps extends keyof LoopyDeps,
> extends Workflow<Name, State, In, Out, Deps> {
  returns(fn: (s: WorkflowView<State, In>) => InferOut<Out>): Workflow<Name, State, In, Out, Deps>;
}

export interface WorkflowNodes<
  Name extends string, State, In extends IO<any, any>, Out extends IO<any, any>,
  NodeName extends string, Deps extends keyof LoopyDeps,
> {
  flow(
    build: (b: FlowBuilder<WorkflowView<State, In>, NodeName>) => FlowBuilder<WorkflowView<State, In>, NodeName>,
  ): WorkflowFlowed<Name, State, In, Out, Deps>;
}

/** node 값에서 dep-키 추출 시 바인딩을 투과 (NodeDepKeys에 바인딩 언랩 추가). */
export type UnwrapBinding<E> = E extends NodeBinding<infer St, any> ? St : E;

export interface WorkflowInit<Name extends string, State, In extends IO<any, any>, Out extends IO<any, any>> {
  // NOTE (deviation from brief): the constraint is `Record<string, unknown>`, not
  // `Record<string, AnyStep | NodeBinding<AnyStep, string>>` as the brief specifies.
  // With the tighter bound, TS's contextual instantiation feeds `NodeBinding<AnyStep,
  // string>`'s `W = string` into each nested `node(...)` call as an inference candidate
  // BEFORE the call's own (absent) `writes` argument is considered — an omitted `writes`
  // then infers `W = string` instead of the documented default `never` (verified via an
  // isolated repro; a bare `Record<string, unknown>` bound removes the leaking candidate
  // and restores `W = never` for bare `node(step, { reads })` calls). Validation strength
  // is unchanged: BindingCheck below fully checks every NodeBinding/AnyStep entry, and
  // its "~nodeInvalid" fallback brands anything that is neither (N-wf3 fixture).
  nodes<const Nodes extends Record<string, unknown>>(
    nodes: Nodes & BindingCheck<State, In, Nodes>,
  ): WorkflowNodes<
    Name, State, In, Out, Extract<keyof Nodes, string>,
    NodeDepKeys<{ [K in keyof Nodes]: UnwrapBinding<Nodes[K]> }>
  >;
}

interface WorkflowGraphCapture {
  nodes: Record<string, { step: unknown; reads?: (s: unknown) => unknown; writes?: string }>;
  start: string;
  edges: Record<string, string>;
  branches: Record<string, (s: unknown) => string>;
  returns: ((s: unknown) => unknown) | null;
}

export function workflow<
  const Name extends string,
  State extends Record<string, Channel<any, any>>,
  In extends IO<any, any>,
  Out extends IO<any, any>,
>(def: { name: Name; state: State; input: In; output: Out }): WorkflowInit<Name, State, In, Out> {
  return {
    nodes(rawNodes: Record<string, unknown>) {
      const graph: WorkflowGraphCapture = { nodes: {}, start: "", edges: {}, branches: {}, returns: null };
      for (const [k, v] of Object.entries(rawNodes)) {
        const b = v as { "~binding"?: true; step?: unknown; reads?: (s: unknown) => unknown; writes?: string };
        graph.nodes[k] = b["~binding"] ? { step: b.step, reads: b.reads, writes: b.writes } : { step: v };
      }
      const flowApi = {
        start(n: string) { graph.start = n; return flowApi; },
        edge(f: string, t: string) { graph.edges[f] = t; return flowApi; },
        branch(f: string, r: (s: unknown) => string) { graph.branches[f] = r; return flowApi; },
      };
      return {
        flow(build: (b: never) => unknown) {
          build(flowApi as never);
          const wf = {
            "~kind": "workflow" as const,
            name: def.name, state: def.state, input: def.input, output: def.output,
            "~graph": graph,
            returns(fn: (s: unknown) => unknown) { graph.returns = fn; return wf; },
          };
          return wf;
        },
      };
    },
  } as unknown as WorkflowInit<Name, State, In, Out>;
}

/* ============================================================================
 * §6 — defineLoopy registry + deps convergence.
 *      FIX ③: DepsOf uses NonNullable (NOT a constrained `infer K extends …`).
 *      A constrained infer fails to match the OPTIONAL phantom on a zero-dep
 *      entry and falls back to the full `keyof LoopyDeps` — poisoning
 *      RequiredDeps to demand EVERY dep. NonNullable collapses `undefined`
 *      before the union so a zero-dep entry contributes `never` and is absorbed.
 * ========================================================================== */

export type AnyEntry = {
  readonly name: string;
  readonly input: IO<any, any>;
  readonly output: IO<any, any>;
  readonly "~deps"?: keyof LoopyDeps;
};

export type InputOf<E> = E extends { readonly input: infer S extends IO<any, any> } ? InferOut<S> : never;
export type OutputOf<E> = E extends { readonly output: infer S extends IO<any, any> } ? InferOut<S> : never;

/** ③ extractor — NonNullable, mirroring §4's ToolDepKeys (internally consistent). */
export type DepsOf<E> = E extends { readonly "~deps"?: infer K } ? NonNullable<K> & keyof LoopyDeps : never;

/** union of every dep required across the whole registry. */
export type RequiredDeps<Reg> = DepsOf<Reg[keyof Reg]>;

/** key-collision guard: agent+workflow sharing a key silently drops input. */
export type NoKeyCollision<A, W> = keyof A & keyof W extends never
  ? unknown
  : { readonly "~duplicateRegistryKey": keyof A & keyof W };

export interface RunOpts {
  readonly threadId?: string;
}

export type RunFn<Reg> = <Name extends keyof Reg>(
  name: Name,
  input: InputOf<Reg[Name]>,
  opts?: RunOpts,
) => Promise<OutputOf<Reg[Name]>>;

/** Internal test capability (consumed by `loopy/test`). Present on defineLoopy runtimes;
 *  absent on the loopy() builder (which has no store/resume in v1). */
export interface TestHandle {
  record(name: string, input: unknown): Promise<readonly RuntimeEvent[]>;
  replay(name: string, input: unknown, goldenEvents: readonly RuntimeEvent[]): Promise<ReplayResult>;
}

export interface Runtime<Reg> {
  readonly run: RunFn<Reg>;
  resume(threadIdValue: string, value: unknown): Promise<unknown>;
  /** internal — used by loopy/test; not part of the public authoring surface. */
  readonly "~test"?: TestHandle;
}

interface RegEntry {
  readonly kind: "agent" | "workflow" | "team";
  readonly value: unknown;
}

/** Agent drivers wrap their result in an `{ output, ... }` envelope; workflow/team
 *  drivers return the value directly. This is the SINGLE place that shape is peeled —
 *  both exec() (run) and testHandle.replay() unwrap through it, so if the envelope
 *  shape ever changes there is one line to edit, not two. */
function unwrapEntryOutput(kind: RegEntry["kind"], raw: unknown): unknown {
  return kind === "agent" ? (raw as { output: unknown }).output : raw;
}

/** deps fully supplied here → directly runnable. (negative②: a missing dep
 *  errors as TS2741 "Property 'x' is missing … in Pick<LoopyDeps, …>".) */
export function defineLoopy<
  const A extends Record<string, AnyEntry>,
  const W extends Record<string, AnyEntry>,
  const T extends Record<string, AnyEntry> = {},
>(def: {
  agents: A;
  // A↔W collision stays guarded HERE (not on the optional teams param) so it is
  // enforced even when teams is omitted; teams collides against agents+workflows.
  workflows: W & NoKeyCollision<A, W>;
  teams?: T & NoKeyCollision<A & W, T>;
  deps: Pick<LoopyDeps, RequiredDeps<A & W & T>>;
  models?: Record<string, ModelClient>;
  store?: Checkpointer;
  onEvent?: (e: RuntimeEvent) => void;
}): Runtime<A & W & T> {
  const store = def.store ?? memoryStore();
  const registry = new Map<string, RegEntry>();
  for (const [k, v] of Object.entries(def.agents)) registry.set(k, { kind: "agent", value: v });
  for (const [k, v] of Object.entries(def.workflows)) registry.set(k, { kind: "workflow", value: v });
  for (const [k, v] of Object.entries(def.teams ?? {})) registry.set(k, { kind: "team", value: v });
  let counter = 0;

  const driverFor = (name: string): { driver: Driver; kind: RegEntry["kind"] } => {
    const e = registry.get(name);
    if (!e) throw new Error(`defineLoopy: unknown entry "${name}"`);
    if (e.kind === "agent") return { driver: agentDriver(e.value as never), kind: e.kind };
    if (e.kind === "workflow") return { driver: workflowDriver(e.value as never, agentNode as never), kind: e.kind };
    return { driver: teamDriver(e.value as never), kind: e.kind };
  };

  const testHandle: TestHandle = {
    async record(name, input): Promise<readonly RuntimeEvent[]> {
      const { driver } = driverFor(name);
      const recStore = memoryStore();
      const tid = "__golden__";
      await _runThread({
        driver, store: recStore, threadId: tid, entry: name,
        deps: def.deps as Record<string, unknown>, models: def.models ?? {}, input,
      });
      return recStore.readLog(mkThreadId(tid));
    },
    async replay(name, input, goldenEvents): Promise<ReplayResult> {
      const { driver, kind } = driverFor(name);
      const res = await replayThread({ driver, goldenEvents, entry: String(name), input });
      // mirror exec()'s agent-unwrap so `output` equals what run() returns (a divergence
      // leaves output undefined, so only unwrap on a clean replay).
      if (res.divergence !== null) return res;
      return { output: unwrapEntryOutput(kind, res.output), divergence: null };
    },
  };

  const exec = async (name: string, input: unknown, opts?: RunOpts, resume?: { value: unknown }): Promise<unknown> => {
    const { driver, kind } = driverFor(name);
    // restart-safe auto id; determinism only binds inside ctx — defineLoopy's body sits
    // outside the recorded-effect boundary, so Math.random here is fine.
    const out = await _runThread({
      driver, store, threadId: opts?.threadId ?? `${name}#${counter++}-${Math.random().toString(36).slice(2, 8)}`, entry: name,
      deps: def.deps as Record<string, unknown>, models: def.models ?? {}, onEvent: def.onEvent,
      input, resume,
    });
    return unwrapEntryOutput(kind, out);
  };

  return {
    run: (async (name, input, opts) => exec(String(name), input, opts)) as RunFn<A & W & T>,
    async resume(threadIdValue: string, value: unknown): Promise<unknown> {
      const log = await store.readLog(mkThreadId(threadIdValue));
      const first = log[0];
      if (!first || first.type !== "RunStarted") throw new Error(`resume("${threadIdValue}"): no RunStarted in log`);
      return exec(first.entry, undefined, { threadId: threadIdValue }, { value });
    },
    "~test": testHandle,
  };
}

/* ============================================================================
 * §7 — provide(): progressive dep injection. `run` is gated by the
 *      [Missing] extends [never] tuple-wrap (a naive `Missing extends never`
 *      distributes over never → never and mis-gates).
 * ========================================================================== */

export type RunBlocked<Missing extends keyof LoopyDeps> = {
  readonly "~missingDeps": Missing;
};

export interface Loopy<Reg, Missing extends keyof LoopyDeps> {
  provide<P extends Partial<Pick<LoopyDeps, Missing>>>(
    deps: P,
  ): Loopy<Reg, Exclude<Missing, keyof P>>;
  readonly run: [Missing] extends [never] ? RunFn<Reg> : RunBlocked<Missing>;
}

/** deps deferred → returns a builder whose `run` unlocks only when Missing=never.
 *  v1 limit: the builder surface does not expose `resume` — apps that need suspend
 *  should use defineLoopy (+ store). */
export function loopy<const A extends Record<string, AnyEntry>, const W extends Record<string, AnyEntry>>(def: {
  agents: A;
  workflows: W & NoKeyCollision<A, W>;
}): Loopy<A & W, RequiredDeps<A & W>> {
  const make = (acc: Record<string, unknown>): unknown => {
    let rt: Runtime<never> | null = null; // lazily built once per builder stage — runs share one runtime/store
    const runtime = (): Runtime<never> =>
      (rt ??= defineLoopy({ agents: def.agents, workflows: def.workflows as never, deps: acc as never }) as Runtime<never>);
    return {
      provide: (more: Record<string, unknown>) => make({ ...acc, ...more }),
      run: (name: never, input: never, opts?: RunOpts) => runtime().run(name, input, opts),
    };
  };
  return make({}) as Loopy<A & W, RequiredDeps<A & W>>;
}

/* ============================================================================
 * §8 — team (multi-agent v1). A thin opinionated preset over workflow: agents
 *      as nodes + a shared transcript + a nextAgent control channel + passTo
 *      name-capture sugar. Reuses workflow's router/State machinery (spec §2).
 *      Three small NEW type surfaces: passTo↔membership guard, inputChannel,
 *      tool-ctx interrupt. Runtime (control loop / consume-on-read / replay) is
 *      Plan B — every body here stays stubbed like the rest of the skeleton.
 * ========================================================================== */

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

/** per-slot membership guard: an agent whose passTo targets are all members of
 *  the team's agent set passes through UNCHANGED; a stray target brands ONLY
 *  that slot with a `never`-missing error field naming the stray. (Spec §6 ii /
 *  Appendix B — compiled under tsc 6.0.3; reviewer with no passTo → PassToOf =
 *  never → [never] extends [never] → passes.) The two §2.x disciplines are
 *  load-bearing: PassToOf uses NonNullable (NOT a constrained infer), and the
 *  gate is the tuple-wrap [Exclude<…>] extends [never] (NOT a naked X extends never). */
export type GuardAgents<Agents> = {
  [K in keyof Agents]:
    [Exclude<PassToOf<Agents[K]>, Extract<keyof Agents, string>>] extends [never]
      ? Agents[K]
      : {
          readonly "~passToTargetNotInTeam":
            Exclude<PassToOf<Agents[K]>, Extract<keyof Agents, string>>;
        };
};

/** router return = every agent key + END → inherited from workflow's .branch
 *  surface (a stray key errors TS2820). Independent of the passTo guard (§6). */
export type TeamRouterReturn<Agents> = AgentNames<Agents> | END;

/** union of every dep required across the team's agents — mirrors §5 NodeDepKeys.
 *  passTo synthesis contributes no deps, so this is exactly the agents' deps. Kept
 *  tight (NOT the broad keyof LoopyDeps) so RequiredDeps over a team registry
 *  converges to the real dep set (P7), not "every dep". */
export type TeamDeps<Agents> = NonNullable<
  { [K in keyof Agents]: Agents[K] extends { readonly "~deps"?: infer D } ? D : never }[keyof Agents]
> &
  keyof LoopyDeps;

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
  readonly "~deps"?: TeamDeps<Agents>;
  /** runtime team-control capture (Task 14); type narrowed in the runtime module. */
  readonly "~team"?: unknown;
}

/** a channel's stored value type. */
export type ChannelValueOf<C> = C extends Channel<infer V, any> ? V : never;

/** per-mapping output⊑channel check: for each `{ agent: channel }` entry, the
 *  agent's output must be assignable to the channel's value type, else that slot
 *  is branded with a `never`-missing error naming the mismatch (spec §4/§6 — the
 *  `.writes` boundary is where "output ⊑ channel" is compile-checked). The
 *  tuple-wrap [Out] extends [ChVal] avoids union distribution. */
export type WritesOutputCheck<Agents, State, M> = {
  [A in keyof M]: A extends keyof Agents
    ? M[A] extends infer Ch
      ? Ch extends keyof State
        ? [OutputOf<Agents[A]>] extends [ChannelValueOf<State[Ch]>]
          ? M[A]
          : {
              readonly "~agentOutputNotAssignableToChannel": {
                readonly agent: A;
                readonly channel: Ch;
                readonly output: OutputOf<Agents[A]>;
                readonly channelValue: ChannelValueOf<State[Ch]>;
              };
            }
        : M[A]
      : M[A]
    : M[A];
};

/** .writes maps an agent name → a state channel key (its output is written there).
 *  Result = the value type of the single mapped channel (Task 8 uses it for run). */
export interface TeamBuilder<Name extends string, Agents, State> {
  writes<const M extends Partial<Record<AgentNames<Agents>, keyof State>>>(
    map: M & WritesOutputCheck<Agents, State, M>,
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

/** true iff U is a union of 2+ members (single member or never → false). */
type IsUnion<U, C = U> = [U] extends [never]
  ? false
  : U extends unknown
    ? [C] extends [U] ? false : true
    : never;

/** exactly one mapping → that channel's value type; 0 or >1 → full state snapshot
 *  (no silent single-channel pick — spec §4). The single-vs-multiple split is a
 *  union-cardinality test on keyof M (the plan's `{[K]:0}[keyof M] extends 0`
 *  sketch is always true regardless of key count → replaced with IsUnion). */
export type WritesResult<State, M> =
  [keyof M] extends [never]
    ? StateOf<State>
    : IsUnion<keyof M> extends true
      ? StateOf<State>
      : M[keyof M] extends infer Ch
        ? Ch extends keyof State
          ? State[Ch] extends Channel<infer V, any> ? V : never
          : never
        : never;

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
  const capture = {
    entry: def.entry as string,
    agents: def.agents as Record<string, unknown>,
    maxTurns: def.maxTurns,
    writes: {} as Record<string, string>,
    router: null as ((s: unknown) => string) | null,
  };
  const mkTeam = (): unknown => ({
    "~kind": "team",
    name: def.name,
    entry: def.entry,
    agents: def.agents,
    state: def.state,
    maxTurns: def.maxTurns,
    input: undefined as never,  // 타입 전용 표면 (AnyEntry 호환) — 런타임 미사용
    output: undefined as never,
    "~team": capture,
  });
  return {
    writes: (map: Record<string, string>) => {
      capture.writes = map;
      return { router: (fn: (s: unknown) => string) => ((capture.router = fn), mkTeam()) };
    },
    router: (fn: (s: unknown) => string) => ((capture.router = fn), mkTeam()),
  } as unknown as TeamBuilder<Name, Agents, State>;
}

/* ============================================================================
 * §9 — runtime surface re-exports (Task 13). Values must only be touched at
 *      call time elsewhere in this module (see the ESM-cycle note up top).
 * ========================================================================== */

export { memoryStore } from "./runtime/store.ts";
export type { Checkpointer, Snapshot } from "./runtime/store.ts";
export { stubModel } from "./runtime/model.ts";
export type { ModelClient, ModelRequest, ModelResponse, ModelMsg, StubModel, ToolCallReq } from "./runtime/model.ts";
export { RunSuspended } from "./runtime/scheduler.ts";
export { ReplayDivergence } from "./runtime/effects.ts";
export { AgentMaxStepsError } from "./runtime/drivers/agent.ts";
export { TeamMaxTurnsError } from "./runtime/drivers/team.ts";
export { ParseError } from "./runtime/sap.ts";
export { digest } from "./runtime/events.ts";
export type { Event as RuntimeEvent, ThreadId, RunId } from "./runtime/events.ts";
export { verifyReplay } from "./runtime/verify.ts";
export { replayThread } from "./runtime/replay.ts";
export type { ReplayResult, ReplayDivergenceInfo } from "./runtime/replay.ts";
