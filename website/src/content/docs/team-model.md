---
title: "The team model, explained"
description: A conceptual, no-jargon-first walkthrough of team() — channels, ReviewResult, passTo vs router, and a full turn-by-turn trace.
---

This page explains the *ideas* behind [`team()`](/reference/team/), in plain language, before any type signature. It's adapted from the project's internal design notes for anyone who wants the mental model before the reference page. If you want to build one right now instead, see [Guide: a multi-agent team](/guides/multi-agent-team/).

The concepts build on each other in this order: **channels → `ReviewResult` → `passTo` vs `.router()` → the rest of the code → the full run.**

## 0. One sentence, one metaphor

**A `team` is several employees (agents) picking up the same case in turn.**

The running example throughout this page is a **PR/issue triage team**. As an office:

```
Issue arrives → [intake] → [bug specialist] or [docs specialist] → [reviewer] ─┬─ approved → done
                                                                                └─ rejected → back to whoever's assigned
```

- **Intake (`triage`)** — reads the issue, decides "this is a bug" or "this is a docs request," and hands it to the right specialist.
- **Bug specialist (`bugFixer`) / Docs specialist (`docsWriter`)** — does the actual work, then hands off to the reviewer.
- **Reviewer (`reviewer`)** — checks the result: approve → done; not good enough → send it back to whoever's responsible.

That's exactly how a human team works. The rest of this page unpacks how that maps onto code, one unfamiliar term at a time.

## 1. What's a channel? (the first thing to understand)

**A channel is one square on the whiteboard the whole team shares.**

For a team to collaborate, information has to live somewhere shared. That shared space is the whiteboard, and the whiteboard is divided into squares. Each square is one channel. Every square has:
- a **name** (e.g. `issue`, `review`), and
- a **rule for merging** a new value with whatever's already there.

That merge rule is what distinguishes the channel kinds:

| Kind | Meaning | Analogy | Example |
|---|---|---|---|
| `lastChannel` | **keeps only the newest value** (a new one overwrites the old) | erase the square and rewrite it | `review` (the latest verdict) |
| `listChannel` | **keeps accumulating** (a new value is appended) | minutes, written line after line | `transcript` (the conversation so far) |
| `inputChannel` | **input provided from outside, at the start** | the case file handed in at intake | `issue` (the thing being triaged) |

**"Why not just use a plain variable?"** Because loopy logs everything to an event log so it can later **replay it exactly and time-travel debug**. A channel is that "recorded, rewindable variable." (This is the same `state = fold(reducer, log)` idea that runs through all of loopy — see [Event sourcing & replay](/core-concepts/event-sourcing/). You don't need to internalize it to keep reading here.)

**Two squares every team gets automatically** (you never declare these yourself):
- **`transcript`** — everything said so far, by anyone. An agent joining late can read this square and know what already happened.
- **`nextAgent`** — a single sticky note that says "whoever's turn is next." (This becomes the key idea below.)

The squares *you* declare are only the ones your own work needs — in this example, `issue` (the input) and `review` (the verdict).

## 2. What's `ReviewResult`?

**`ReviewResult` isn't a loopy concept. It's just the "verdict" data this specific triage example invented.**

When the reviewer finishes, it reaches a conclusion. The shape of that conclusion is `ReviewResult`. There are exactly two cases:

```ts
type ReviewResult =
  | { approved: true;  notes: string }                                     // approved: pass + a note
  | { approved: false; assignee: "bugFixer" | "docsWriter"; notes: string } // rejected: who it goes back to + a note
```

- **Approved** → `approved: true` plus a note.
- **Rejected** → `approved: false` plus **who it goes back to** (`assignee`) plus a note.

**Why split it this way (a discriminated union):** to make the compiler *force* "if it's rejected, an assignee is required." Approval doesn't need an assignee; rejection does. Written this way, "rejected but nobody's assigned" is a type error, not a bug you find at 3&nbsp;a.m.

**The key point:** `ReviewResult` is just this example's own domain data. If your app processes orders, this slot holds an `OrderResult`; if it's an analysis pipeline, an `AnalysisReport`. loopy doesn't mandate it — you define the result type your team actually produces.

## 3. `passTo` vs `.router()` — the part people mix up

Both answer **"whose turn is next?"** The only difference is **who decides**.

### `passTo` = the employee (the model) hands off on their own

Tell the intake agent up front: "you're allowed to hand off to the bug specialist or the docs specialist" (`passTo: ["bugFixer", "docsWriter"]`). The intake *model* reads the issue and **decides for itself** which one to press.

- "Is this a bug or a docs issue?" is a judgement call that **requires actually reading the issue** — only the model can make it.
- When the model "presses the `pass_to_bugFixer` button," that write lands on the **`nextAgent` sticky note**, saying `"bugFixer"`.

### `.router()` = your code decides by rule

"If the review is approved, end the run." "If it's rejected, send it back to whoever's assigned." These aren't judgement calls — they're **fixed rules**, so your code handles them. That's `.router(...)`.

### Walking through the router line by line

```ts
.router((s) => {                          // s = the whole whiteboard's current state
  if (s.nextAgent) return s.nextAgent;    // ① if there's a handoff sticky note, honor it first
  if (s.review?.approved) return END;     // ② if the review says "approved," stop
  if (s.review) return s.review.assignee; // ③ if it's rejected, go to the named assignee
  return END;                             // ④ nothing to hand off, no verdict either → stop
})
```

- **①** `s.nextAgent` is that "whose turn is next" sticky note. **If the model has already written one via a `pass_to_*` call, that wins over everything else.** (Note: on turn zero, this note is pre-seeded with `entry` — the intake agent — so intake goes first automatically.)
- **②** If the reviewer's verdict is "approved" (`review.approved`) → **stop** (`END`).
- **③** If the review is "rejected" → hand it back to whoever the reviewer named (`assignee`).
- **④** No sticky note and no verdict → **stop**.

### Why check the sticky note (`nextAgent`) before the review verdict?

When a rejected issue goes back to the specialist, gets fixed again, and the specialist **hands it back to the reviewer**, that hand-off writes a *fresh* sticky note (`nextAgent = "reviewer"`). At that moment, you need to look at the *new* sticky note before the *stale* rejection verdict still sitting in `review`. Otherwise the router would see only the old "rejected" result and send the case back to the specialist in an infinite loop. (This was a real bug caught during the design's own verification pass.)

### At a glance

| | `passTo` | `.router()` |
|---|---|---|
| **who decides** | the employee (the model), on its own | code, by rule |
| **when to use it** | judgement calls that **need the input read** ("bug or docs?") | fixed rules ("approved → done") |
| **mechanism** | the model calls `pass_to_X()` → written to the sticky note | `.router()` reads the sticky note + results and decides |
| **required?** | optional | optional (omit it and the default is "follow the sticky note, otherwise stop") |

**They aren't competing mechanisms.** `.router()` has final say. `passTo` is the model **requesting** "please hand this to that person" via the sticky note. A simple team can run on `passTo` alone (skip `.router()`). You reach for `.router()` only when you need rule-based termination or bounce-backs.

## 4. The rest of the code — `.writes()`, `defineLoopy`, `rt.run`

```ts
.writes({ reviewer: "review" })
```
This says which square the reviewer's result (`ReviewResult`) gets written into: "write `reviewer`'s output into the `review` square." Without this, the router's `s.review` would never populate.

```ts
const rt = defineLoopy({ teams: { prTriage } }).provide(/* deps */);
```
- `defineLoopy(...)` — the **app registry.** Register the teams and agents you've built here.
- `.provide(...)` — **actual dependency injection** (the real tools/APIs your agents use get plugged in here).

```ts
const out: ReviewResult | null = await rt.run("prTriage", { issue }, { threadId: "t-7" });
```
- `rt.run("prTriage", { issue })` — **"run the triage team on this issue."** `{ issue }` is what fills the `inputChannel` square.
- `threadId: "t-7"` — this run's **identifier**, used later to suspend/resume or replay it.
- Return value `out: ReviewResult | null` — **the final value of the `review` square.** If the reviewer reached a verdict, you get a `ReviewResult`; if the run ended with nobody having reviewed anything, `null`. (Hitting the `maxTurns` safety cap doesn't return a value at all — it throws.)

## 5. One full run, traced turn by turn

A bug issue comes in, gets rejected once, then passes:

| Turn | Active employee | What happens | Sticky note / verdict | Router decision |
|---|---|---|---|---|
| 0 | **Intake** | reads the issue → "it's a bug" → hands to bug specialist | note = `bugFixer` | → bug specialist |
| 1 | **Bug specialist** | fixes the code → hands to reviewer | note = `reviewer` | → reviewer |
| 2 | **Reviewer** | reviews → "not good enough, back to bug specialist" | verdict = rejected (`assignee: bugFixer`) | → bug specialist (bounced back) |
| 3 | **Bug specialist** | fixes it again → hands to reviewer | note = `reviewer` | → reviewer |
| 4 | **Reviewer** | reviews → "approved!" | verdict = approved | → **end** (`END`) |

Final return = the approved `ReviewResult`. The entire sequence is recorded in the event log, so it can be replayed identically or paused for a human to step in (see [Human-in-the-loop](/guides/human-in-the-loop/)) — once the runtime exists.

## 6. One-page summary

- **A channel** is one square on the team's shared whiteboard (a recorded, replayable variable). `last` (overwrite) / `list` (append) / `input` (seeded at the start).
- **`ReviewResult`** is this example's own "verdict" data — not a loopy concept, your domain type.
- **`passTo`** is the model handing off on its own ("next is that person") — for judgement calls that require reading the input.
- **`.router()`** is code deciding "next is X / stop" by fixed rule.
- They cooperate: `.router()` decides, `passTo` requests via a sticky note.

## Next

- [Guide: a multi-agent team](/guides/multi-agent-team/) — build this exact team, step by step, with full code.
- [API Reference → team()](/reference/team/)
- [Human-in-the-loop](/guides/human-in-the-loop/)
