import { defineLoopy, stubModel } from "@loopyjs/core";
import { designFlow } from "../../../../examples/workflows";
import { classifier, sufficiency, fileAnalyzer, verifier, codeGen } from "../../../../examples/agents";
import type { GitRepo, FigmaApi, VercelApi, GitCli, GitHubCli, JiraApi, Shell } from "../../../../examples/deps";

// deviation from brief: the brief's `import { stubDeps } from ".../tests/anchors/designflow.test"`
// crashes when this module is loaded outside `bun test` ("Cannot use test() outside of the test
// runner") — designflow.test.ts calls bun:test's test() at module top level, and this file is
// `bun`-executed directly (serve-fixture.ts, Playwright's webServer command). Inlined the same
// stub shape instead so fixture-app.ts has no bun:test dependency.
const stubDeps = {
  repo: { read: async () => "", write: async () => {}, find: async () => [] } satisfies GitRepo,
  figma: { fetchNode: async () => ({ nodeId: "n", frames: ["f"] }) } satisfies FigmaApi,
  jira: { getIssue: async (k: string) => ({ key: k, summary: "Fix /healthz", description: "add endpoint" }), comment: async () => {}, transition: async () => {} } satisfies JiraApi,
  vercel: { waitForDeploy: async () => ({ ok: true, url: "https://d.example/pull/9" }) } satisfies VercelApi,
  git: { ensureRepo: async () => "/tmp/repo" } satisfies GitCli,
  gh: { openPR: async () => "https://example/pull/1" } satisfies GitHubCli,
  shell: { claude: async () => ({ committed: true, sha: "abc123" }) } satisfies Shell,
};

const answer = (o: unknown) => ({ text: JSON.stringify(o), stopReason: "end_turn" });
export const runtime = defineLoopy({
  agents: { classifier, sufficiency, fileAnalyzer, verifier, codeGen },
  workflows: { designFlow },
  deps: stubDeps,
  models: {
    haiku: stubModel([answer({ paths: ["src/a.ts"] }), answer({ passed: true, notes: "lgtm" })]),
    sonnet: stubModel([answer({ applied: ["src/a.ts"], failed: [] })]),
  },
});
