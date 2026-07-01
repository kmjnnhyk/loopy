// team (multi-agent v1) fixture — the PR-triage team. Built up progressively
// across the plan's tasks; this file is the anchor scenario the type surface is
// validated against (spec §1).
import { agent, tool, io, inputChannel, lastChannel } from "loopy";
import type { GitRepo } from "./deps";

export interface Issue { readonly id: number; readonly body: string }
export type ReviewResult =
  | { readonly approved: true;  readonly notes: string }
  | { readonly approved: false; readonly assignee: "bugFixer" | "docsWriter"; readonly notes: string };

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
export const reviewer = agent({
  name: "reviewer", model: "opus", instructions: "Review; approve or reassign.",
  input: io<{ issue: Issue }>(), output: io<ReviewResult>(),
  // no passTo — termination via router
});
export const triageState = {
  issue:  inputChannel<Issue>(),
  review: lastChannel<ReviewResult | null>(null),
};

void (null as unknown as GitRepo); // keep deps import referenced until later tasks
