// MUST-error fixtures. Excluded from the positive build; compiled standalone via
// tsconfig.negative.json to capture the exact diagnostic codes at the seam.
import { workflow, io, lastChannel, defineLoopy } from "loopy";
import type { GitRepo, FigmaApi, JiraApi, VercelApi, GitCli, GitHubCli } from "./deps";
import { fetchFigma } from "./tools";
import { fileAnalyzer, codeGen, verifier, classifier, sufficiency } from "./agents";
import { designFlow, jiraFlow } from "./workflows";

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
