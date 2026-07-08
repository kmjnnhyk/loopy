---
title: DevTools (loopy dev)
description: Watch a loopy run happen — a local, offline, read-only web UI over your runtime's event log.
---

`loopy dev` starts a local web UI that observes a loopy [`runtime`](/reference/registry/) while it runs. It doesn't add instrumentation to your code or send anything anywhere — it loads your app in-process, subscribes to the same event stream that powers [event sourcing & replay](/core-concepts/event-sourcing/), and renders it live in the browser.

- **Local.** It runs on your machine, serving `http://localhost:<port>`.
- **Offline.** No account, no external service — the whole thing is one process reading your app's event log.
- **Read-only (v1).** DevTools observes; it doesn't let you edit state, replay from the middle of a run, or resume an interrupted one from the UI. See [Scope](#scope-read-only-v1-and-whats-next) below.

## How to run it

Point it at whatever module exports your `runtime` — the same object [`defineLoopy(...)`](/reference/registry/) returns:

```ts
// loopy.config.ts
export const runtime = defineLoopy({ agents, workflows, teams, deps });
```

```bash
loopy dev ./loopy.config.ts --port 5173
```

`--port` defaults to `5173` if you omit it. `loopy dev` looks for a named `runtime` export (or a default export) with a working `run` function; a runtime built with the `loopy({...}).provide(...)` builder isn't supported here — use `defineLoopy` for anything you want to open in DevTools.

Open the printed URL and trigger a run from the UI — you pick an entry (an agent, workflow, or team) and provide its input as JSON.

## The three panes

- **Timeline** (left) — every step in the run, in order, with its status: ✓ done, ⟳ running, ✗ errored. Click a step to select it.
- **Graph** (top-right) — a node-edge view of the workflow or team, built with React Flow: the static graph you declared with `.nodes()` / `.flow()`, with the path actually taken so far overlaid on top of it.
- **Detail** (bottom-right) — whatever the selected step actually did: the model prompt and response if it called one, tool arguments and results, and which state channels it wrote.

Selecting a step in the timeline highlights it in the graph and loads its detail — the three panes are one connected view of the same run, not three separate tools.

## Live runs and the scrub slider

While a run is in progress, its events stream to the browser over a WebSocket, so the timeline and graph update as steps complete — no refresh needed.

The **scrub slider** above the timeline is read-only time-travel: drag it to any point in the run and every pane snaps to the state as of that step, without affecting the run itself. Release it (or drag to the end) to go back to following the run live.

## Scope: read-only v1, and what's next

Today's DevTools is deliberately narrow: it observes a run you trigger, and lets you look at any point in its history. It does **not** currently support:

- Resuming an interrupted run, or replaying from an arbitrary point, from the UI.
- Full diffs of a channel's value across steps (the detail pane shows what a step wrote, not a before/after diff).
- Clicking an edge to inspect the payload that crossed it.
- Observing a production deployment — v1 is a local dev tool, not a hosted observability product.

These are the planned shape of a v2, not implemented yet. See [Status & Roadmap](/status-roadmap/) for where this sits relative to the rest of loopy.

## Next

- [Event sourcing & replay](/core-concepts/event-sourcing/) — the event log DevTools is reading.
- [Quick Start](/getting-started/) — includes `loopy test`, the CI-friendly way to replay the same events without a browser.
