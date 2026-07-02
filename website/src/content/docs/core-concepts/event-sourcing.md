---
title: Event sourcing & replay
description: "loopy's state model is designed around one invariant: state = fold(reducer, log). This page describes the runtime design; the engine itself is not implemented yet."
---

:::caution
Everything on this page describes the **runtime design**, not something you can run today. `src/index.ts` implements the [channel](/core-concepts/channels-and-state/) and [Step](/core-concepts/step/) *type* machinery. The control loop, event log, and replay engine described below are the next milestone. See [Status & Roadmap](/status-roadmap/).
:::

## One invariant

The design commits to a single rule: **`state = fold(reduce, log, initial)`**. The event log — an append-only record of everything that happened in a run — is the only source of truth. Whatever "live" state a running process holds is just a cache of folding that log through each channel's reducer. A checkpoint snapshot is an acceleration structure that can lag behind the log but can never *disagree* with it, because it's always recoverable by re-folding.

Once that's the rule, several things that are usually separate features turn out to be the same operation, run under different boundary conditions:

- **Replay** — fold the whole log from the start, with no LLM calls (every model/tool call was already recorded, so every step is a cache hit).
- **Resume** — fold the log up to the last checkpoint, then continue live from there.
- **Time-travel debugging** — fold the log up to an arbitrary earlier point and inspect that state.
- **Deterministic regression tests** — commit a log to your test suite; replaying it later *is* the test, with zero mocks and zero real LLM calls.

## Effects are requested, not performed inline

For the fold to stay pure and replayable, a transition can't call `fetch`, an SDK, `Date.now()`, or `Math.random()` directly — any of those would make replay non-deterministic. Instead, effects go through the run context (`ctx`): `ctx.callModel(...)`, `ctx.callTool(...)`, `ctx.interrupt(...)`. Every effect is logged as a matched pair — a `*Requested` event written *before* the I/O happens, and a `*Returned` event written *after*. That makes a crash mid-effect recoverable: on restart, an unpaired `*Requested` means "this didn't finish," and the effect can be safely re-issued. That's also the origin of the [`idempotencyKey`](/reference/tool/) contract on tools: a re-issued effect must be safe to run twice.

## Suspending a *position*, not a closure

JavaScript can't serialize a paused `async` function's continuation, so loopy doesn't try to. Instead of persisting a function, it persists three plain-data things: **which node you're at, the current channel values, and any pending effect**. Resuming means re-entering the graph at that node with that state — not "waking up" a frozen call stack. `ctx.interrupt(payload)` is the primitive this enables: it suspends the run. A later `runtime.resume(threadId, value)` — potentially in a completely different process, days later — re-folds the log (no LLM calls for the already-completed prefix) and continues from exactly where the interrupt was raised. [Human-in-the-loop](/guides/human-in-the-loop/) is built entirely on this one primitive.

## A worked example (design sketch)

A run that fails a build once, succeeds on retry, pauses for a human to approve, then resumes days later — condensed from the design's worked event log:

```jsonc
{seq:2, t:"ToolCalled", tool:"runBuild"}   {seq:3, t:"ToolReturned", ok:false, value:{log:"TS2322…"}}
{seq:7, t:"ToolCalled", tool:"runBuild"}   {seq:8, t:"ToolReturned", ok:true,  value:{log:"OK"}}
{seq:10, t:"InterruptRaised", payload:{diff:"…"}, resumeKey:"th_1:10"}
// ── process exits; nothing held in memory ──
// days later: runtime.resume("th_1", {approved:true})
{seq:11, t:"Resumed", value:{approved:true}}
{seq:14, t:"ToolCalled", tool:"openPR"}    {seq:15, t:"ToolReturned", value:"…/pull/42"}
{seq:16, t:"RunEnded", output:{pr:"…/pull/42"}}
```

Sequences 0–10 replay as cache hits on resume — `runBuild` is never called a third time. Only `openPR`, which hadn't happened yet, performs real I/O. The committed log doubles as a deterministic regression test of the entire run, human approval included.

## Next

- [Human-in-the-loop](/guides/human-in-the-loop/) — the one primitive (`ctx.interrupt`) this design exists to support.
- [Status & Roadmap](/status-roadmap/) — what's implemented today vs. designed for later.
