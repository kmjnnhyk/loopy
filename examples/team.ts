// team (multi-agent v1) fixture — the PR-triage team. Built up progressively
// across the plan's tasks; this file is the anchor scenario the type surface is
// validated against (spec §1).
import { agent, tool, io, inputChannel, lastChannel, team, END, defineLoopy } from "loopy";
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
export const requestApproval = tool({
  name: "requestApproval",
  description: "Pause for human approval.",
  input: io<{ summary: string }>(),
  output: io<{ approved: boolean }>(),
  run: async (i, ctx) => ctx.interrupt<{ approved: boolean }>({ ask: i.summary }),
});
export const reviewer = agent({
  name: "reviewer", model: "opus", instructions: "Review; approve or reassign.",
  input: io<{ issue: Issue }>(), output: io<ReviewResult>(),
  tools: [requestApproval],
  // no passTo — termination via router
});
export const triageState = {
  issue:  inputChannel<Issue>(),
  review: lastChannel<ReviewResult | null>(null),
};

export const prTriage = team({
  name: "prTriage",
  entry: "triage",
  state: triageState,
  agents: { triage, bugFixer, docsWriter, reviewer },
  maxTurns: 20,
})
  .writes({ reviewer: "review" })
  .router((s) => {
    if (s.nextAgent) return s.nextAgent;
    if (s.review?.approved) return END;
    if (s.review) return s.review.assignee;
    return END;
  });

// team runtime registration: bugFixer declares deps:["repo"] → the team requires
// exactly "repo" (passTo synthesis contributes no deps). See P7.
const repo: GitRepo = { read: async () => "", write: async () => {}, find: async () => [] };
export const teamRt = defineLoopy({
  agents: {},
  workflows: {},
  teams: { prTriage },
  deps: { repo },
});
