// End-to-end: a tool-less loopy agent whose model runs on the Claude Max
// SUBSCRIPTION via claudeCode() (`claude -p`), no ANTHROPIC_API_KEY.
//
// Run:  bun examples/claude-code-e2e.ts
//
// Flow (all real loopy machinery, only the model backend is swapped):
//   run("sentiment", {text})
//     → seed: user message = JSON.stringify({text})            (agent.ts seed)
//     → think: complete({ system: instructions + "respond with JSON", … })
//              → claudeCode → `claude -p --system-prompt … --allowedTools ""`
//     → parseStructured(output schema, result text)            (sap.ts)
//     → { label: … }
import { defineLoopy, agent, io } from "@loopyjs/core";
import { claudeCode } from "@loopyjs/claude-code";

// renderSystem() only appends "respond with a single JSON object" — it does NOT
// describe the output shape. So the shape must live in `instructions`, or the
// model emits arbitrary JSON and schema validation fails (then loopy retries).
const sentiment = agent({
  name: "sentiment",
  model: "sub", // ← registry key; resolved against `models` below
  instructions:
    'Classify the sentiment of the user message (given as JSON with a "text" field). ' +
    'Respond with a single JSON object: {"label": "positive" | "negative" | "neutral"}.',
  input: io<{ text: string }>(),
  output: io<{ label: "positive" | "negative" | "neutral" }>(),
});

const rt = defineLoopy({
  agents: { sentiment },
  workflows: {},
  deps: {},
  models: { sub: claudeCode("opus") }, // subscription-backed model A
});

const out = await rt.run("sentiment", { text: "I absolutely love how clean this API is!" });
console.log("agent output:", out); // → { label: "positive" }
