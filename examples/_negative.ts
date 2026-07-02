// MUST-error fixtures. Excluded from the positive build; compiled standalone via
// tsconfig.negative.json to capture the exact diagnostic codes at the seam.
import { workflow, io, lastChannel, defineLoopy, team, agent, inputChannel, END } from "loopy";
import type { GitRepo, FigmaApi, JiraApi, VercelApi, GitCli, GitHubCli } from "./deps";
import { fetchFigma } from "./tools";
import { fileAnalyzer, codeGen, verifier, classifier, sufficiency } from "./agents";
import { designFlow, jiraFlow } from "./workflows";
import { bugFixer, docsWriter, reviewer } from "./team";
import type { Issue, ReviewResult } from "./team";

// ── negative ①: edge typo → expect TS2820 "Did you mean 'codeGen'?"
export const badFlow = workflow({
  name: "bad",
  state: { x: lastChannel<number>(0) },
  input: io<{ message: string }>(),
  output: io<{ done: boolean }>(),
})
  .nodes({ fetchFigma, fileAnalyzer, codeGen, verify: verifier })
  .flow((b) =>
    b
      .start("fetchFigma")
      .edge("fetchFigma", "codGen") // typo in edge ARGUMENT position
      .branch("fileAnalyzer", () => "codGen")); // typo in ROUTER RETURN position

// ── negative ②: missing dep (shell omitted) → expect TS2741
const repo: GitRepo = { read: async () => "", write: async () => {}, find: async () => [] };
const figma: FigmaApi = { fetchNode: async () => ({ nodeId: "", frames: [] }) };
const jira: JiraApi = {
  getIssue: async () => ({ key: "", summary: "", description: "" }),
  comment: async () => {},
  transition: async () => {},
};
const vercel: VercelApi = { waitForDeploy: async () => ({ ok: true, url: "" }) };
const git: GitCli = { ensureRepo: async () => "/tmp/repo" };
const gh: GitHubCli = { openPR: async () => "u" };

export const badRuntime = defineLoopy({
  agents: { classifier, sufficiency, fileAnalyzer, verifier, codeGen },
  workflows: { designFlow, jiraFlow },
  deps: { repo, figma, jira, vercel, git, gh },
});

/* ── team must-error fixtures (N1–N5) — codes annotated from the actual compiler
 *    output (see the commit message / negative-build capture), not guessed. ── */

// ── N1: router returns a non-member key → TS2322 ("~end" | "bugFx" not assignable
//    to TeamRouterReturn<…>). The ternary widens the return to a union so it is
//    TS2322, not the TS2820 "Did you mean" a single bad literal would give.
export const badRouter = team({
  name: "n1", entry: "triage",
  state: { issue: inputChannel<Issue>(), review: lastChannel<ReviewResult | null>(null) },
  agents: { triage: reviewer, bugFixer, docsWriter, reviewer },
}).router((s) => (s.review?.approved ? END : "bugFx")); // typo in router RETURN

// ── N2: agent passTo targets a NON-member → TS2322 per-slot brand — the triage
//    slot must be `& { readonly "~passToTargetNotInTeam": "ghost" }` naming the
//    stray target (docsWriter is a member and is excluded). (Appendix B measurement.)
const strayTriage = agent({
  name: "triage", model: "opus", instructions: "x",
  input: io<{ issue: Issue }>(), output: io<{ kind: string }>(),
  passTo: ["ghost", "docsWriter"], // "ghost" ∉ agents
});
export const badMembership = team({
  name: "n2", entry: "triage",
  state: { issue: inputChannel<Issue>(), review: lastChannel<ReviewResult | null>(null) },
  agents: { triage: strayTriage, bugFixer, docsWriter, reviewer },
});

// ── N3: agent output ⊄ .writes-mapped channel type → TS2322 — the "review" key is
//    branded "~agentOutputNotAssignableToChannel" because weakReviewer's output
//    { approved: boolean } is not assignable to the review channel (ReviewResult | null).
//    (Enforced by WritesOutputCheck on .writes — spec §4/§6.)
const weakReviewer = agent({
  name: "reviewer", model: "opus", instructions: "x",
  input: io<{ issue: Issue }>(), output: io<{ approved: boolean }>(), // missing notes/assignee
});
export const badWrites = team({
  name: "n3", entry: "reviewer",
  state: { issue: inputChannel<Issue>(), review: lastChannel<ReviewResult | null>(null) },
  agents: { reviewer: weakReviewer, bugFixer, docsWriter },
}).writes({ reviewer: "review" });

// ── N4: entry omitted → TS2345 — the def object is not assignable to team()'s
//    param, elaborated as "Property 'entry' is missing" (nested inside TS2345
//    rather than a standalone TS2741 because entry is a required field of the arg).
export const badEntry = team({
  name: "n4",
  state: { issue: inputChannel<Issue>(), review: lastChannel<ReviewResult | null>(null) },
  agents: { reviewer, bugFixer, docsWriter },
});

// ── N5: .writes maps a non-existent channel key → TS2820 "Did you mean 'review'?"
//    ("revie" is not a keyof State — the channel-key constraint still fires under
//    the WritesOutputCheck intersection).
export const badChannelKey = team({
  name: "n5", entry: "reviewer",
  state: { issue: inputChannel<Issue>(), review: lastChannel<ReviewResult | null>(null) },
  agents: { reviewer, bugFixer, docsWriter },
}).writes({ reviewer: "revie" }); // channel typo
