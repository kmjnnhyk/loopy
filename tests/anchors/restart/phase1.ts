// 실제 별도 프로세스로 실행됨: jiraFlow를 첫 suspend까지 → exit 0
import { defineLoopy, stubModel, sqliteStore, RunSuspended } from "loopy";
import { jiraFlow } from "../../../examples/workflows";
import { classifier, sufficiency, fileAnalyzer, verifier, codeGen } from "../../../examples/agents";

const dbPath = process.argv[2]!;
const deps = {
  repo: { read: async () => "", write: async () => {}, find: async () => [] },
  figma: { fetchNode: async () => ({ nodeId: "n", frames: [] }) },
  jira: { getIssue: async (k: string) => ({ key: k, summary: "s", description: "d" }), comment: async () => {}, transition: async () => {} },
  vercel: { waitForDeploy: async () => ({ ok: true, url: "" }) },
  git: { ensureRepo: async () => "/tmp/r" },
  gh: { openPR: async () => "https://example/pull/1" },
  shell: { claude: async () => ({ committed: true, sha: "abc" }) },
};
const rt = defineLoopy({
  agents: { classifier, sufficiency, fileAnalyzer, verifier, codeGen },
  workflows: { jiraFlow },
  deps: deps as never,
  models: { haiku: stubModel([{ text: '{"verdict":"insufficient","missing":["repro"]}', stopReason: "end_turn" }]), sonnet: stubModel([]) },
  store: sqliteStore(dbPath),
});
try {
  await rt.run("jiraFlow", { issueKey: "PROJ-1" }, { threadId: "restart-1" });
  console.log("UNEXPECTED_COMPLETION");
  process.exit(1);
} catch (e) {
  if (e instanceof RunSuspended) {
    console.log(`SUSPENDED:${JSON.stringify(e.payload)}`);
    process.exit(0);
  }
  throw e;
}
