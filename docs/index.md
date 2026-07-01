# loopy documentation

**React for agents** — a type-safe TypeScript DSL for LLM agents, tools, workflows, and teams.

> loopy is in the design / prototype phase. The library is currently a fully
> type-checked **type surface**; the runtime is the next milestone. See the
> [project README](../README.md) for status.

## Design docs

- **[team, explained](design/team-explained.md)** — the `team` multi-agent model
  (agents-as-nodes, shared transcript, `passTo` handoff sugar, router-over-shared-state).
- **[core state & types](design/core-state-and-types.md)** — the `Step` spine, the
  channel/state model, and the type machinery that makes the DSL type-safe.
- **[research: design space](design/research-design-space.md)** — the study of
  LangChain, LangGraph, Vercel AI SDK, Spring MVC, Redux, and TS DSLs that the API
  was synthesized from.
- **[bell-agent → loopy](design/bell-agent-to-loopy.md)** — the migration surface
  the design was pressure-tested against.
- **[HANDOFF](design/HANDOFF.md)** — project context and the verification discipline
  (compile-assertions, hand-read `.d.ts`, must-error fixtures).

## Specs & plans

- **[specs/](superpowers/specs)** — approved design specifications.
- **[plans/](superpowers/plans)** — task-by-task implementation plans.
