---
title: A multi-agent team
description: Build a PR-triage team step by step — an intake agent hands off to a specialist, a reviewer approves or bounces it back.
---

This guide builds `prTriage`. An issue comes in, a triage agent decides whether it's a bug or a docs request, and hands it to the right specialist. The specialist hands it to a reviewer, who either approves it or bounces it back. For the concepts behind each piece — what a channel is, why `passTo` and `.router()` are both needed — see [The team model, explained](/team-model/). This guide is the "how do I build one," start to finish.

## 1. Shape the domain types and state

```ts
import { agent, tool, io, inputChannel, lastChannel, team, END, defineLoopy } from "@loopyjs/core";

export interface Issue { readonly id: number; readonly body: string }

export type ReviewResult =
  | { readonly approved: true;  readonly notes: string }
  | { readonly approved: false; readonly assignee: "bugFixer" | "docsWriter"; readonly notes: string };

export const triageState = {
  issue:  inputChannel<Issue>(),                  // seeded by rt.run's input
  review: lastChannel<ReviewResult | null>(null),  // the reviewer's latest verdict
};
```

`ReviewResult` is a discriminated union, not a loopy concept — it's this example's own domain data. Splitting it into `approved: true` (no assignee needed) and `approved: false` (assignee *required*) means "rejected but nobody's assigned" is a type error at the call site, not a runtime bug.

## 2. Define the agents, with `passTo` where the model decides

```ts
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
```

`triage` can hand off to either specialist — whichever the model decides fits, after actually reading the issue. `bugFixer` and `docsWriter` each only ever hand off to `reviewer`. That's a fixed next step, not a judgement call — but it's still expressed as `passTo`, because it's still *this specific agent* announcing where its own work goes next.

## 3. Give the reviewer a way to ask a human, and no `passTo`

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
  // no passTo — termination is a fixed rule, handled by .router(), not by the model
});
```

`reviewer` has no `passTo`: whether the run ends or loops back to a specialist is a *rule* ("approved → done, rejected → back to the assignee"), so it belongs in `.router()`, not in the model's hands. See [Human-in-the-loop](/guides/human-in-the-loop/) for what `requestApproval`'s `ctx.interrupt` does.

## 4. Assemble the team

```ts
export const prTriage = team({
  name: "prTriage",
  entry: "triage",
  state: triageState,
  agents: { triage, bugFixer, docsWriter, reviewer },
  maxTurns: 20,
})
  .writes({ reviewer: "review" })
  .router((s) => {
    if (s.nextAgent) return s.nextAgent;    // ① a handoff request wins first
    if (s.review?.approved) return END;     // ② approved → done
    if (s.review) return s.review.assignee; // ③ rejected → back to the named assignee
    return END;                             // ④ nothing to do → done
  });
```

`entry: "triage"` also seeds `nextAgent` for turn zero, so `triage` runs first without anything special in the router. `.writes({ reviewer: "review" })` is what makes `s.review` in the router populated at all — without it, the reviewer's output never lands anywhere the router can see.

**Why check `nextAgent` before `review` (line ①, before ②/③):** when a rejected issue goes back to, say, `bugFixer`, and `bugFixer` finishes and hands off to `reviewer` again, that fresh handoff needs to win over the *stale* `review` value still sitting in the channel from the previous round. Otherwise the router would keep reading the old "rejected" verdict and loop `bugFixer` forever, instead of routing to `reviewer` for a fresh look.

## 5. Register and run it

```ts
const repo: GitRepo = { read: async () => "", write: async () => {}, find: async () => [] };
export const teamRt = defineLoopy({
  agents: {},
  workflows: {},
  teams: { prTriage },
  deps: { repo }, // only "repo" — from bugFixer; passTo synthesizes no extra deps
});

const out: ReviewResult | null = await teamRt.run("prTriage", { issue: { id: 7, body: "…" } });
```

`{ issue: { id: 7, body: "…" } }` is exactly the shape `TeamInputOf<typeof triageState>` derives from the one `inputChannel` in `state` — `review` isn't part of the run's input, because `lastChannel` isn't input-branded.

## Trace one run

| Turn | Active agent | What happens | Router decision |
|---|---|---|---|
| 0 | `triage` | reads the issue, decides "bug" | → `bugFixer` |
| 1 | `bugFixer` | fixes it, hands off | → `reviewer` |
| 2 | `reviewer` | rejects, assigns back to `bugFixer` | → `bugFixer` |
| 3 | `bugFixer` | fixes again, hands off | → `reviewer` |
| 4 | `reviewer` | approves | → `END` |

Final return: the approved `ReviewResult`. See [The team model, explained](/team-model/) for the same trace narrated turn by turn, including exactly what's in `nextAgent`/`review` at each step.

## Next

- [The team model, explained](/team-model/) — the conceptual deep dive behind every decision made in this guide.
- [API Reference → team()](/reference/team/)
