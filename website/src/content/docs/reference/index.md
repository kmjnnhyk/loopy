---
title: API Reference
description: One page per loopy primitive — signature, options, and a minimal example, straight from src/index.ts.
---

Every page in this section documents one exported primitive, with its real signature and a minimal working example drawn from `src/index.ts` and `examples/*.ts`.

`team()` is documented too — its type surface is complete and verified, but as of this writing it lives on the `feat/team-type-surface` branch rather than `master`. See the note on [the team() page](/reference/team/) and [Status & Roadmap](/status-roadmap/) for the exact state.

## Primitives

| Export | What it makes |
|---|---|
| [`tool(def)`](/reference/tool/) | A model-less `Step` — a capability with declared dependencies. |
| [`agent(def)`](/reference/agent/) | A model-owning `Step` — a think→act→observe loop with tools and, optionally, handoff targets. |
| [`workflow(def).nodes(...).flow(...)`](/reference/workflow/) | An explicit graph of `Step` nodes with a typed, data-driven router. |
| [`team(def).writes(...).router(...)`](/reference/team/) | Agents as nodes, a shared transcript, and handoff sugar — the multi-agent primitive. |

## Channels & schemas

| Export | What it makes |
|---|---|
| [`io<Out, In>()`](/core-concepts/schemas/) | A Standard-Schema-shaped carrier for a static input/output type. |
| [`lastChannel(init)` / `listChannel()` / `inputChannel()`](/reference/channels/) | Typed state slots with a declared reducer. |
| `END` | The sentinel a router (or a `passTo`-free agent) returns to terminate a run. |

## Registry

| Export | What it makes |
|---|---|
| [`defineLoopy(def)`](/reference/registry/) | The registry — converges every dependency requirement, then types `run`. |
| [`loopy(def).provide(...)`](/reference/registry/#progressive-injection-loopydefprovide) | The progressive-injection variant of the registry. |
