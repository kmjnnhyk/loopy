---
title: Introduction
description: loopy is a type-safe TypeScript DSL for LLM agents, tools, workflows, and multi-agent teams — React for agents.
banner:
  content: |
    loopy is a prototype — the type surface is complete and compile-checked, the runtime is not yet implemented. See <a href="/status-roadmap/">Status &amp; Roadmap</a>.
---

loopy is a type-safe TypeScript DSL for building LLM applications — **"React for agents."** Tools, agents, deterministic workflows, and multi-agent teams are all one primitive, a `Step`, so the whole spectrum from "you decide every step" to "the model decides" lives in a single, compile-checked model.

## Why loopy?

Hand-rolled agent loops tend to rot the same way:

- Tool names are strings, so a typo surfaces at runtime — or never.
- Model output is parsed with regex + `JSON.parse`, and failures pass silently.
- State lives in a mutable context bag nobody can type.
- A failed run can't be replayed, so debugging means paying for more LLM calls.

loopy turns each of these into a compile-time contract. Tools are referenced by value, not by name. Schemas type both inputs *and* outputs. State is a set of typed channels. And because every run is an event log, replay is a pure fold — deterministic and free.

## loopy at a glance

```ts
import { agent, tool, io, team, inputChannel, lastChannel, END, defineLoopy } from "loopy";

// A tool declares only the dependency slice it needs.
const editFile = tool({
  name: "editFile",
  description: "Apply an edit to a file.",
  input: io<{ path: string; patch: string }>(),
  output: io<{ applied: boolean }>(),
  deps: ["repo"],
  run: async (i, { deps }) => {
    await deps.repo.write(i.path, i.patch);
    return { applied: true };
  },
});

// An agent owns a model loop; `passTo` captures its handoff targets by name.
const bugFixer = agent({
  name: "bugFixer", model: "claude-opus",
  instructions: "Fix the bug, then hand to the reviewer.",
  input: io<{ issue: Issue }>(), output: io<{ done: boolean }>(),
  tools: [editFile], deps: ["repo"], passTo: ["reviewer"],
});

// A team is a multi-agent loop over shared state — a router picks the next
// single agent each turn; `passTo` targets are membership-checked at compile time.
const prTriage = team({
  name: "prTriage",
  entry: "triage",
  state: {
    issue:  inputChannel<Issue>(),                     // run input, provided at run
    review: lastChannel<ReviewResult | null>(null),    // domain channel
    // `transcript` + `nextAgent` are auto-injected by the team
  },
  agents: { triage, bugFixer, docsWriter, reviewer },
  maxTurns: 20,
})
  .writes({ reviewer: "review" })          // agent output → state channel (output ⊑ channel, checked)
  .router((s) => {                         // control rule; a stray key is a compile error
    if (s.nextAgent) return s.nextAgent;   // follow a handoff request first
    if (s.review?.approved) return END;    // discriminated union narrows — no `!` needed
    if (s.review) return s.review.assignee;
    return END;
  });

// The registry proves every declared dependency is supplied, then types rt.run.
const rt = defineLoopy({ agents: {}, workflows: {}, teams: { prTriage }, deps: { repo } });
const out: ReviewResult | null = await rt.run("prTriage", { issue });
```

*(`triage`, `docsWriter`, `reviewer`, `Issue`, and `ReviewResult` are elided for brevity — see [the team model, explained](/team-model/) for the full version.)*

## Features

- 🧩 **One primitive.** A tool, an agent, a workflow node, and a team member are all a `Step` — one shape to learn, everything composes.
- 🔒 **Type-safe end to end.** Inputs, outputs, dependencies, and handoff targets are inferred and checked at compile time.
- 🧬 **Functional dependency injection.** No decorators, no globals — each unit declares its dependency slice, the registry proves it's supplied.
- 📼 **Event-sourced core.** Every turn and tool call is a logged event; replay is deterministic and needs zero LLM calls.
- 🤝 **Multi-agent teams.** A router over shared, typed state — with compile-checked handoffs and an auto-managed transcript.
- ⏸️ **Human-in-the-loop, first-class.** Interrupt and resume are part of the v1 design, not a retrofit.
- 🧾 **Vendor-neutral schemas.** Zod, Valibot, and ArkType flow through a [Standard Schema](https://standardschema.dev/)-shaped carrier unchanged.
- 📦 **Convention layer.** Prescribed folders, value-imported tools, and a registry that lists only entry points — structure LangChain never standardized.

## Next steps

- [Quick Start](/getting-started/) — clone the repo and explore the type surface with `tsc`.
- [The Step spine](/core-concepts/step/) — the one shape every primitive reduces to.
- [Status & Roadmap](/status-roadmap/) — exactly what's done and what's next.
