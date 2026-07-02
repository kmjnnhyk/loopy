---
title: team()
description: Agents as nodes, a shared transcript, and handoff sugar — the multi-agent primitive. A router picks the next single agent each turn.
---

:::note[Branch status]
`team()` is a **complete, type-verified** primitive, but as of this writing it lives on the `feat/team-type-surface` branch, not `master` — it hasn't merged yet. Every signature and example on this page is copied from that branch's `src/index.ts` and `examples/team.ts`, not invented. See [Status & Roadmap](/status-roadmap/) for the merge status, and [The team model, explained](/team-model/) for a guided walkthrough instead of a signature reference.
:::

`team()` is a thin, opinionated preset over the same graph machinery as [`workflow()`](/reference/workflow/): agents are the nodes, a shared `transcript` channel and a `nextAgent` control channel are auto-injected, and agents can request their own handoff via `passTo` in addition to (or instead of) an explicit `.router(...)`.

## Signature

```ts
export interface Team<Name extends string, Agents, State, Result> {
  readonly "~kind": "team";
  readonly name: Name;
  readonly entry: AgentNames<Agents>;
  readonly agents: Agents;
  readonly state: TeamFullState<State, AgentNames<Agents>>;
  readonly maxTurns?: number;
  readonly input: IO<TeamInputOf<State>>;
  readonly output: IO<Result>;
  readonly "~deps"?: TeamDeps<Agents>;
}

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
}): TeamBuilder<Name, Agents, State>;

interface TeamBuilder<Name, Agents, State> {
  writes<const M extends Partial<Record<AgentNames<Agents>, keyof State>>>(
    map: M & WritesOutputCheck<Agents, State, M>,
  ): TeamRouted<Name, Agents, State, M>;
  router(
    fn: (s: StateOf<TeamFullState<State, AgentNames<Agents>>>) => TeamRouterReturn<Agents>,
  ): Team<Name, Agents, State, unknown>;
}
```

`team({...})` returns a builder — `.writes(...)` is optional, `.router(...)` finalizes it into a `Team`. `.writes(...)` can be skipped entirely if no agent's output needs to land in a channel the router reads.

## Fields

- **`entry`** — which agent goes first. Must be one of the keys in `agents`.
- **`state`** — your domain channels (see [Channels & state](/core-concepts/channels-and-state/)). At least one [`inputChannel()`](/reference/channels/#inputchannel) is typical, to seed the run.
- **`agents`** — a record of `agent()`s. Every `passTo` target declared by any agent here must be a key of this same record — see the guard below.
- **`maxTurns`** — a safety cap on how many agent turns a run can take before it's treated as stuck (throws, rather than silently returning a partial result).

## Auto-injected state

Every team gets two channels you never declare yourself:

```ts
export interface Msg {
  readonly role: "user" | "assistant" | "tool";
  readonly agent?: string;
  readonly content: string;
}
export type TeamAutoState<Names extends string> = {
  readonly transcript: Channel<readonly Msg[], Msg | readonly Msg[]>;
  readonly nextAgent: Channel<Names | null, Names | null>;
};
```

- **`transcript`** — every message any agent has produced so far, so an agent joining later has full context.
- **`nextAgent`** — a one-slot "handoff note." When an agent's `passTo` targets one of its allowed names, that name lands here; your `.router(...)` reads it to decide who goes next.

## `passTo` vs `.router()`

Both answer "who goes next?" — the difference is **who decides**.

- **`passTo`** (declared on [`agent()`](/reference/agent/#the-passto-extension-used-by-team)) — the *model* decides, because the decision requires actually reading the input (e.g. "is this a bug or a docs request?"). When the agent picks a target, it lands in `nextAgent`.
- **`.router(fn)`** — *your code* decides, because the rule is fixed (e.g. "if the review is approved, stop"). `fn` receives the full state snapshot, including `nextAgent`, and returns the next agent name or [`END`](/reference/channels/#end).

They compose — a router typically checks `nextAgent` first, then falls back to its own rules:

```ts
// examples/team.ts
.router((s) => {
  if (s.nextAgent) return s.nextAgent;   // follow a handoff request first
  if (s.review?.approved) return END;    // fixed rule: approved → stop
  if (s.review) return s.review.assignee; // fixed rule: rejected → back to whoever's named
  return END;
})
```

## The `passTo` membership guard

`agents: Agents & GuardAgents<Agents>` checks, per agent, that every name in its `passTo` is actually a key of the `agents` record. A stray target doesn't fail the whole call — it brands *only that agent's slot* with a named error:

```ts
export type GuardAgents<Agents> = {
  [K in keyof Agents]:
    [Exclude<PassToOf<Agents[K]>, Extract<keyof Agents, string>>] extends [never]
      ? Agents[K]
      : { readonly "~passToTargetNotInTeam": Exclude<PassToOf<Agents[K]>, Extract<keyof Agents, string>> };
};
```

An agent with no `passTo` at all (e.g. a reviewer that only ever terminates via `.router`) passes trivially.

## `.writes()` — output ⊑ channel, checked

`.writes({ agentName: "channelKey" })` says "write this agent's output into this channel." Each mapping is checked at compile time: the agent's output type must be assignable to the channel's value type, or that specific slot is branded with a named mismatch error (`WritesOutputCheck`) — not a generic type error pointing at the whole call.

```ts
// examples/team.ts
.writes({ reviewer: "review" })
```

The **cardinality** of the map also decides what `rt.run(...)` returns, via `WritesResult`:

| `.writes({...})` | `rt.run(...)` resolves to |
|---|---|
| exactly one mapping | that channel's value type |
| zero mappings, or two or more | the full `StateOf<...>` snapshot |

This is deliberate — a single mapping is the common case ("give me the reviewer's verdict"), and anything else falls back to the whole state rather than silently guessing which one channel you meant.

## Full example — PR triage

```ts
// examples/team.ts (feat/team-type-surface)
export const triageState = {
  issue:  inputChannel<Issue>(),
  review: lastChannel<ReviewResult | null>(null),
};

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

See [The team model, explained](/team-model/) for the full walkthrough, including `triage`/`bugFixer`/`docsWriter`/`reviewer`'s definitions and the turn-by-turn trace.

## Registering a team

```ts
// examples/team.ts — bugFixer declares deps:["repo"]; passTo synthesis contributes no deps.
export const teamRt = defineLoopy({
  agents: {},
  workflows: {},
  teams: { prTriage },
  deps: { repo },
});

const out: ReviewResult | null = await teamRt.run("prTriage", { issue: { id: 7, body: "…" } });
```

`defineLoopy`'s `teams` field converges each team's `TeamDeps<Agents>` into the same `RequiredDeps` union as `agents`/`workflows` — see [Registry](/reference/registry/).

## Human-in-the-loop inside a team

Because an `agent()` can't have an arbitrary body (its "body" *is* the model loop), a team that needs a human approval step routes it through a tool instead — `ToolCtx` on this branch carries `interrupt`:

```ts
export const requestApproval = tool({
  name: "requestApproval",
  description: "Pause for human approval.",
  input: io<{ summary: string }>(),
  output: io<{ approved: boolean }>(),
  run: async (i, ctx) => ctx.interrupt<{ approved: boolean }>({ ask: i.summary }),
});
```

See [Human-in-the-loop](/guides/human-in-the-loop/) for the full pattern.

## Next

- [The team model, explained](/team-model/) — a guided, turn-by-turn walkthrough.
- [Guides → A multi-agent team](/guides/multi-agent-team/)
- [Status & Roadmap](/status-roadmap/) — the branch-merge status.
