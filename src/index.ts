// loopy.js — core type-machinery + factories.
// "React for agents": every unit reduces to a Step<In, Out, Err, Deps>.
//
// Three compile-forced fixes from the verification campaign are applied here and
// flagged inline:  ①AnyStep schema slots = IO<any,any>  ②shared Step supertype
// ③DepsOf NonNullable extractor.  Every exported factory carries an EXPLICIT
// return type so `isolatedDeclarations: true` passes and the emitted .d.ts keeps
// the synthetic type *names* (no anonymous blobs). Internal const tables may use
// `satisfies`; exported factory returns never do.

/* ============================================================================
 * §0 — Dependency registry (augmentable) + capability contexts
 * ========================================================================== */

/** Consumers augment via `declare module "loopy" { interface LoopyDeps {…} }`. */
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
  /** the concrete tool tuple is PRESERVED (not widened to AnyStep[]) so a
   *  consumer's `ToolDepKeys<typeof agent.tools>` stays precise across .d.ts. */
  readonly tools: Tools;
  /** phantom: union of declared passTo target NAMES (§6 candidate ii). */
  readonly "~passTo"?: Pass;
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
}): Agent<Name, In, Out, D[number] | ToolDepKeys<Tools>, Tools, Pass[number]> {
  return {
    "~kind": "agent",
    name: def.name,
    model: def.model,
    input: def.input,
    output: def.output,
    tools: (def.tools ?? []) as Tools,
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
  return { name: def.name, input: def.input, output: def.output, run: def.run as never } as Step<
    Name,
    In,
    Out,
    D[number]
  >;
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

export interface WorkflowNodes<
  Name extends string,
  State,
  In extends IO<any, any>,
  Out extends IO<any, any>,
  NodeName extends string,
  Deps extends keyof LoopyDeps,
> {
  flow(
    build: (b: FlowBuilder<StateOf<State>, NodeName>) => FlowBuilder<StateOf<State>, NodeName>,
  ): Workflow<Name, State, In, Out, Deps>;
}

export interface WorkflowInit<Name extends string, State, In extends IO<any, any>, Out extends IO<any, any>> {
  nodes<const Nodes extends Record<string, AnyStep>>(
    nodes: Nodes,
  ): WorkflowNodes<Name, State, In, Out, Extract<keyof Nodes, string>, NodeDepKeys<Nodes>>;
}

export function workflow<
  const Name extends string,
  State extends Record<string, Channel<any, any>>,
  In extends IO<any, any>,
  Out extends IO<any, any>,
>(def: { name: Name; state: State; input: In; output: Out }): WorkflowInit<Name, State, In, Out> {
  void def;
  return {
    nodes: (() => ({ flow: () => undefined as never })) as never,
  } as WorkflowInit<Name, State, In, Out>;
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

export type RunFn<Reg> = <Name extends keyof Reg>(
  name: Name,
  input: InputOf<Reg[Name]>,
) => Promise<OutputOf<Reg[Name]>>;

export interface Runtime<Reg> {
  readonly run: RunFn<Reg>;
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
}): Runtime<A & W & T> {
  void def;
  return { run: (async () => undefined as never) as RunFn<A & W & T> };
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

/** deps deferred → returns a builder whose `run` unlocks only when Missing=never. */
export function loopy<const A extends Record<string, AnyEntry>, const W extends Record<string, AnyEntry>>(def: {
  agents: A;
  workflows: W & NoKeyCollision<A, W>;
}): Loopy<A & W, RequiredDeps<A & W>> {
  void def;
  return { provide: (() => undefined as never) as never, run: undefined as never } as Loopy<
    A & W,
    RequiredDeps<A & W>
  >;
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
  void def;
  return {
    writes: (() => ({ router: () => undefined as never })) as never,
    router: (() => undefined as never) as never,
  } as TeamBuilder<Name, Agents, State>;
}
