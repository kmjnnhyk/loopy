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

/* ── §2.9 scale check (throwaway): a 10-agent chain (s0→s1→…→s9; s9 terminates)
 *    to confirm PassToolNames ∘ PassToOf and the Team<…> emit stay NAMED and
 *    non-truncated at 10-agent scale — the spec §10.3 residual. The membership
 *    guard is per-slot, so this also exercises the guard over 10 slots. ── */
const io1 = () => io<{ n: number }>();
const s0 = agent({ name: "s0", model: "haiku", instructions: "x", input: io1(), output: io1(), passTo: ["s1"] });
const s1 = agent({ name: "s1", model: "haiku", instructions: "x", input: io1(), output: io1(), passTo: ["s2"] });
const s2 = agent({ name: "s2", model: "haiku", instructions: "x", input: io1(), output: io1(), passTo: ["s3"] });
const s3 = agent({ name: "s3", model: "haiku", instructions: "x", input: io1(), output: io1(), passTo: ["s4"] });
const s4 = agent({ name: "s4", model: "haiku", instructions: "x", input: io1(), output: io1(), passTo: ["s5"] });
const s5 = agent({ name: "s5", model: "haiku", instructions: "x", input: io1(), output: io1(), passTo: ["s6"] });
const s6 = agent({ name: "s6", model: "haiku", instructions: "x", input: io1(), output: io1(), passTo: ["s7"] });
const s7 = agent({ name: "s7", model: "haiku", instructions: "x", input: io1(), output: io1(), passTo: ["s8"] });
const s8 = agent({ name: "s8", model: "haiku", instructions: "x", input: io1(), output: io1(), passTo: ["s9"] });
const s9 = agent({ name: "s9", model: "haiku", instructions: "x", input: io1(), output: io1() });
export const scaleTeam = team({
  name: "scaleTeam", entry: "s0",
  state: { seed: inputChannel<number>() },
  agents: { s0, s1, s2, s3, s4, s5, s6, s7, s8, s9 },
}).router((s) => s.nextAgent ?? END);
