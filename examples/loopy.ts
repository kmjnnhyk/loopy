// defineLoopy registry: 7 deps + 5 agents + 2 workflows → typed rt.run(...).
import { defineLoopy, loopy } from "loopy";
import type { GitRepo, FigmaApi, JiraApi, VercelApi, GitCli, GitHubCli, Shell } from "./deps";
import { classifier, sufficiency, fileAnalyzer, verifier, codeGen } from "./agents";
import { designFlow, jiraFlow } from "./workflows";

// dep instances (stubs) — must satisfy the augmented LoopyDeps.
const repo: GitRepo = { read: async () => "", write: async () => {}, find: async () => [] };
const figma: FigmaApi = { fetchNode: async () => ({ nodeId: "", frames: [] }) };
const jira: JiraApi = {
  getIssue: async () => ({ key: "", summary: "", description: "" }),
  comment: async () => {},
  transition: async () => {},
};
const vercel: VercelApi = { waitForDeploy: async () => ({ ok: true, url: "" }) };
const git: GitCli = { ensureRepo: async () => "/tmp/repo" };
const gh: GitHubCli = { openPR: async () => "https://example/pull/1" };
const shell: Shell = { claude: async () => ({ committed: true, sha: "abc" }) };

export const runtime = defineLoopy({
  agents: { classifier, sufficiency, fileAnalyzer, verifier, codeGen },
  workflows: { designFlow, jiraFlow },
  deps: { repo, figma, jira, vercel, git, gh, shell },
});

// provide(): progressive injection — `run` unlocks only when Missing collapses
// to never (the [Missing] extends [never] gate).
export const deferred = loopy({
  agents: { classifier, sufficiency, fileAnalyzer, verifier, codeGen },
  workflows: { designFlow, jiraFlow },
})
  .provide({ repo, figma, jira, vercel })
  .provide({ git, gh, shell });
