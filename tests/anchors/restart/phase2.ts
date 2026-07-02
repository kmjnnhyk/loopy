// 완전히 새 프로세스: 같은 sqlite 파일에서 resume 2회 → 최종 출력 출력
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
const haiku = stubModel([]); // 빈 stub — resume 재생 경로에서 LLM 0회의 증명
const rt = defineLoopy({
  agents: { classifier, sufficiency, fileAnalyzer, verifier, codeGen },
  workflows: { jiraFlow },
  deps: deps as never,
  models: { haiku, sonnet: stubModel([]) },
  store: sqliteStore(dbPath),
});
try {
  await rt.resume("restart-1", { answers: ["r"], by: "k" });
  console.log("UNEXPECTED — expected 2nd suspend");
  process.exit(1);
} catch (e) {
  if (!(e instanceof RunSuspended)) throw e;
}
const out = await rt.resume("restart-1", { baseBranch: "main", confirmedBy: "k" });
console.log(`DONE:${JSON.stringify(out)}:LLM=${haiku.calls.length}`);
