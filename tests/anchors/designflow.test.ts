import { expect, test } from "bun:test";
import { defineLoopy, stubModel } from "loopy";
import { designFlow } from "../../examples/workflows";
import { classifier, sufficiency, fileAnalyzer, verifier, codeGen } from "../../examples/agents";
import type { GitRepo, FigmaApi, VercelApi, GitCli, GitHubCli, JiraApi, Shell } from "../../examples/deps";

export const stubDeps = {
  repo: { read: async () => "", write: async () => {}, find: async () => [] } satisfies GitRepo,
  figma: { fetchNode: async () => ({ nodeId: "n", frames: ["f"] }) } satisfies FigmaApi,
  jira: { getIssue: async (k: string) => ({ key: k, summary: "Fix /healthz", description: "add endpoint" }), comment: async () => {}, transition: async () => {} } satisfies JiraApi,
  vercel: { waitForDeploy: async () => ({ ok: true, url: "https://d.example/pull/9" }) } satisfies VercelApi,
  git: { ensureRepo: async () => "/tmp/repo" } satisfies GitCli,
  gh: { openPR: async () => "https://example/pull/1" } satisfies GitHubCli,
  shell: { claude: async () => ({ committed: true, sha: "abc123" }) } satisfies Shell,
};
const answer = (o: unknown) => ({ text: JSON.stringify(o), stopReason: "end_turn" });

test("A1 designFlow: e2e with stub models/deps", async () => {
  const haiku = stubModel([answer({ paths: ["src/a.ts"] }), answer({ passed: true, notes: "lgtm" })]);
  const sonnet = stubModel([answer({ applied: ["src/a.ts"], failed: [] })]);
  const rt = defineLoopy({
    agents: { classifier, sufficiency, fileAnalyzer, verifier, codeGen },
    workflows: { designFlow },
    deps: stubDeps,
    models: { haiku, sonnet },
  });
  const out = await rt.run("designFlow", { message: "add /healthz" }, { threadId: "a1" });
  expect(out).toEqual({ prUrl: "https://d.example/pull/9" });
  expect(haiku.calls.length).toBe(2); // fileAnalyzer + verifier 각 1 think
  expect(sonnet.calls.length).toBe(1); // codeGen 1 think
});
