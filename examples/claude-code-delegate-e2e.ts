// End-to-end (model B): a TOOL-USING loopy agent delegated wholesale to Claude
// Code on the Max SUBSCRIPTION. The readFile tool executes IN THIS PROCESS
// (watch the console) while Claude Code drives the loop.
//
// Run:  bun examples/claude-code-delegate-e2e.ts
import { defineLoopy, io } from "@loopyjs/core";
import { delegatedAgent } from "@loopyjs/claude-code";
import { readFile } from "./tools";
import type { GitRepo } from "./deps";

const files = new Map<string, string>([
  ["src/hello.ts", 'export const hello = (): string => "hi";\nexport const bye = (): string => "bye";'],
]);
const repo: GitRepo = {
  read: async (p) => {
    console.log(`  [loopy-side tool] repo.read(${p})  ← 이 로그가 곧 "tool이 loopy에서 실행" 증거`);
    return files.get(p) ?? "";
  },
  write: async (p, c) => void files.set(p, c),
  find: async () => [...files.keys()],
};

const exportLister = delegatedAgent({
  name: "exportLister",
  model: "sonnet",
  instructions:
    'The user message is JSON {"path"}. Call the "readFile" tool with that path, ' +
    'then respond with a single JSON object {"exports": [<exported symbol names>]}.',
  input: io<{ path: string }>(),
  output: io<{ exports: readonly string[] }>(),
  tools: [readFile],
});

const rt = defineLoopy({ agents: { exportLister }, workflows: {}, deps: { repo } });
const out = await rt.run("exportLister", { path: "src/hello.ts" });
console.log("delegated agent output:", out); // → { exports: ["hello", "bye"] }
if (!out.exports.includes("hello")) throw new Error("e2e failed: expected 'hello' in exports");
