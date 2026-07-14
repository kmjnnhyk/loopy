# @loopyjs/claude-code

A loopy `ModelClient` backed by the **Claude Code CLI** in headless mode
(`claude -p`), authenticated by your Claude Pro/Max **subscription** instead of
an `ANTHROPIC_API_KEY`.

`claude -p` is constrained to a single tool-less turn, so it behaves like a
plain text completion. loopy keeps ownership of the reducer graph, the tool
loop, and replay — this client only fills the `complete()` contract, exactly
like `@loopyjs/anthropic`.

```ts
import { defineLoopy, agent, io } from "@loopyjs/core";
import { claudeCode } from "@loopyjs/claude-code";

const sentiment = agent({
  name: "sentiment",
  model: "sub",
  instructions:
    'Classify the sentiment of the user message. ' +
    'Respond with a single JSON object: {"label": "positive" | "negative" | "neutral"}.',
  input: io<{ text: string }>(),
  output: io<{ label: "positive" | "negative" | "neutral" }>(),
});

const rt = defineLoopy({
  agents: { sentiment },
  workflows: {},
  deps: {},
  models: { sub: claudeCode("opus") }, // runs on the subscription
});

await rt.run("sentiment", { text: "I love this API!" }); // → { label: "positive" }
```

## Scope & caveats

- **Tool-less nodes only.** Tools are disabled, so `complete()` never returns
  `toolCalls`. Attach this model only to agents without tools (classifiers,
  judges, extractors…). Pointing a tool-using agent at it stalls the loop.
- **Requires the `claude` CLI on PATH**, logged in via a Pro/Max subscription
  (`claude` → `/status` should show a subscription login, not an API key). The
  client strips `ANTHROPIC_API_KEY` from the child env so the subscription wins.
- **Terms of service.** A personal subscription is fine for local dev,
  dogfooding, and internal tooling. Backing a service you offer to others
  violates Anthropic's consumer terms — use organization API keys there.

## API

```ts
claudeCode(cliModel: string, opts?: { bin?: string; forceSubscription?: boolean }): ModelClient
```

- `cliModel` — the `--model` value: an alias (`"opus"` | `"sonnet"` |
  `"fable"` | `"haiku"`) or a full model ID.
- `opts.bin` — CLI binary path (default `"claude"`).
- `opts.forceSubscription` — strip `ANTHROPIC_API_KEY` from the child env
  (default `true`).

## Model B — `delegatedAgent()`: whole-node delegation (tools included)

`claudeCode()` is a tool-less completion client. For a **tool-using** agent,
delegate the whole node to Claude Code instead — loopy still executes every
tool in your process (real deps), and records the node as ONE replayable effect.

```ts
import { delegatedAgent } from "@loopyjs/claude-code";

const codeReader = delegatedAgent({
  name: "codeReader",
  model: "sonnet",              // claude -p --model (not a loopy registry key)
  instructions: 'Call "readFile", then answer {"exports": [...]}.',
  input: io<{ path: string }>(),
  output: io<{ exports: readonly string[] }>(),
  tools: [readFile],            // executed by YOUR process via an in-process MCP bridge
});

const rt = defineLoopy({ agents: { codeReader }, workflows: {}, deps: { repo } });
await rt.run("codeReader", { path: "src/a.ts" });
```

Requires the **optional** peer `@modelcontextprotocol/sdk` (`bun add @modelcontextprotocol/sdk`) —
`claudeCode()` alone does not.

Limits (v1): no interrupt/HITL inside the delegated node (it's one atomic
effect), no sub-agents in `tools`, no team membership. Replay never re-runs
Claude Code — the recorded output is fed back. Args are advertised to Claude
Code with an open (typeless) schema, so it may pass them with loose types
(e.g. a number as the JSON string "3"). State each argument's type in the
tool's description, and have type-sensitive tools coerce/validate their inputs.

- The in-process tool bridge listens on 127.0.0.1 with no auth for the duration of a delegation — any local process could call your tools during that window. Keep delegated agents to trusted local/dev/internal environments (consistent with the subscription ToS).

⚠️ Subscription ToS: personal dev / dogfooding / internal tooling only.
