// 5 agents — model-owning loops. codeGen mixes a sub-agent (fileAnalyzer) into
// its `tools`, exercising the Step supertype (sub-agent-as-tool).
import { agent, io } from "@loopyjs/core";
import { editFile, createFile, readFile } from "./tools";

export const classifier = agent({
  name: "classifier",
  model: "haiku",
  instructions: "Classify the incoming message.",
  input: io<{ message: string }>(),
  output: io<{ kind: "design" | "code" | "question" }>(),
});

export const sufficiency = agent({
  name: "sufficiency",
  model: "haiku",
  instructions: "Judge whether requirements are sufficient to proceed.",
  input: io<{ issue: string }>(),
  output: io<{ verdict: "sufficient" | "partial" | "insufficient"; missing: readonly string[] }>(),
});

export const fileAnalyzer = agent({
  name: "fileAnalyzer",
  model: "haiku",
  instructions: "Identify the files relevant to a goal.",
  input: io<{ goal: string }>(),
  output: io<{ paths: readonly string[] }>(),
  deps: ["repo"],
});

export const verifier = agent({
  name: "verifier",
  model: "haiku",
  instructions: "Verify the applied changes against the goal.",
  input: io<{ diff: string }>(),
  output: io<{ passed: boolean; notes: string }>(),
  deps: ["repo"],
});

export const codeGen = agent({
  name: "codeGen",
  model: "sonnet",
  instructions: "Generate code changes in a think→act→observe loop.",
  input: io<{ task: string }>(),
  output: io<{ applied: readonly string[]; failed: readonly string[] }>(),
  // edit/create/read tools + a sub-agent passed where a tool is expected.
  tools: [editFile, createFile, readFile, fileAnalyzer],
  deps: ["repo"],
});
