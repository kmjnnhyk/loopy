// scripts/delegate-smoke.ts — LIVE contract check for the delegate backend.
// Requires: `claude` on PATH, logged in with a Max subscription (no API key needed).
// Run: bun scripts/delegate-smoke.ts
import { io, tool } from "@loopyjs/core";
import { claudeCliBackend, startToolBridge } from "@loopyjs/claude-code";

const calls: unknown[] = [];
const add = tool({
  name: "add",
  description: 'Add two numbers. Arguments: {"a": <number>, "b": <number>}. Returns {"sum": <number>}.',
  input: io<{ a: number; b: number }>(),
  output: io<{ sum: number }>(),
  run: async (i) => {
    calls.push(i);
    return { sum: i.a + i.b };
  },
});

const bridge = await startToolBridge([add], {});
try {
  const text = await claudeCliBackend().run({
    prompt: '{"a":3,"b":4}',
    system:
      'The user message is JSON {"a","b"}. You MUST call the "add" tool to add them — do not compute yourself. ' +
      'Then respond with a single JSON object {"sum": <number>} and nothing else.',
    model: "sonnet",
    mcpUrl: bridge.url,
    allowedTools: ["mcp__loopy__add"],
  });
  console.log("final text:", text);
  console.log("in-process tool calls:", JSON.stringify(calls));
  const m = text.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(m ? m[0] : text) as { sum: number };
  if (parsed.sum !== 7) throw new Error(`expected sum 7, got: ${text}`);
  if (calls.length < 1) throw new Error("tool was NEVER executed in the loopy process — MCP wiring broken");
  console.log("✅ delegate CLI contract OK (subscription + MCP + in-process tool + JSON result)");
} finally {
  await bridge.close();
}
