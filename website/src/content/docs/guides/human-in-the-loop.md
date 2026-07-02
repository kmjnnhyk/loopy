---
title: "Guide: human-in-the-loop"
description: Pause a run for a human decision with ctx.interrupt, and understand how resume picks up exactly where it left off.
---

Human-in-the-loop in loopy is one primitive — `ctx.interrupt<T>(payload)` — used from either a workflow `step()` or, inside a [`team()`](/reference/team/), a `tool()`. See [Event sourcing & replay](/core-concepts/event-sourcing/) for why this is designed around suspending a graph *position* rather than a paused function.

:::caution
`interrupt`'s type signature exists today; the suspend/resume runtime behind it does not. This guide describes the intended usage shape.
:::

## Inside a workflow: `NodeCtx.interrupt`

A workflow `step()`'s run context extends the plain tool context with `interrupt`:

```ts
export interface NodeCtx<D extends keyof LoopyDeps> {
  readonly deps: Pick<LoopyDeps, D>;
  /** Suspend the run; resolves with the resume value (typed payload channel). */
  interrupt<T>(payload: unknown): Promise<T>;
}
```

`examples/workflows.ts`'s `jiraFlow` uses it twice — once to ask a human to clarify an underspecified issue, once to ask which base branch to target:

```ts
export interface UserClarification {
  readonly answers: readonly string[];
  readonly by: string;
}

const needsInput = step({
  name: "needsInput",
  input: io<{ missing: readonly string[] }>(),
  output: io<{ clarified: UserClarification }>(),
  run: async (_i, ctx) => {
    const clarified = await ctx.interrupt<UserClarification>({ kind: "clarify" });
    return { clarified };
  },
});
```

`ctx.interrupt<UserClarification>({ kind: "clarify" })` suspends the run and, once resumed with a value matching `UserClarification`, returns that value and lets `needsInput` finish normally. The `{ kind: "clarify" }` payload is whatever context you want to hand to whatever's presenting the approval UI (a dashboard, a Slack message, a CLI prompt) — it's opaque to loopy.

The channel this flows into is a named type across the whole workflow, not `unknown` — `jiraFlow.state.clarification` is `Channel<UserClarification | null, ...>`, checked in `examples/consumer.ts` as a real compile-assertion (`StateOf<typeof jiraFlow.state>["clarification"]` really does equal `UserClarification | null`, surviving the `.d.ts` package boundary).

## Inside a team: route it through a tool

An `agent()` has no author-written body — its "body" *is* the model loop — so it can't call `ctx.interrupt` directly the way a `step()` can. Instead, a team that needs human approval gives an agent a tool whose `run` calls `interrupt`. On the `feat/team-type-surface` branch, `ToolCtx` carries `interrupt` for exactly this reason:

```ts
export const requestApproval = tool({
  name: "requestApproval",
  description: "Pause for human approval.",
  input: io<{ summary: string }>(),
  output: io<{ approved: boolean }>(),
  run: async (i, ctx) => ctx.interrupt<{ approved: boolean }>({ ask: i.summary }),
});

export const reviewer = agent({
  name: "reviewer", model: "opus", instructions: "Review; approve or reassign.",
  input: io<{ issue: Issue }>(), output: io<ReviewResult>(),
  tools: [requestApproval],
});
```

When `reviewer` decides to call `requestApproval`, the whole team run suspends at that point — the model's own reasoning up to and including "I should ask for approval" is preserved in the event log, so resuming doesn't re-run the model, only continues past the interrupt.

## What resume looks like (design intent)

```ts
// runtime.resume(threadId, value) — a different process, days later, is fine
await runtime.resume("th_1", { approved: true });
```

Everything before the interrupt replays as cache hits (no LLM calls, no re-executed tools); only what comes after the interrupt does real work. See [Event sourcing & replay](/core-concepts/event-sourcing/) for the full worked example.

## Next

- [team()](/reference/team/#human-in-the-loop-inside-a-team)
- [Event sourcing & replay](/core-concepts/event-sourcing/)
