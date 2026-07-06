import { expect, test } from "bun:test";
import { defineLoopy, loopy, memoryStore, stubModel, workflow, step, node, io, lastChannel, END } from "@loopyjs/core";
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

test("auto threadId survives a runtime restart against a shared store", async () => {
  const store = memoryStore();
  const mk = () =>
    defineLoopy({
      agents: { classifier, sufficiency, fileAnalyzer, verifier, codeGen },
      workflows: { designFlow },
      deps: stubDeps,
      models: {
        haiku: stubModel([answer({ paths: ["src/a.ts"] }), answer({ passed: true, notes: "lgtm" })]),
        sonnet: stubModel([answer({ applied: ["src/a.ts"], failed: [] })]),
      },
      store,
    });
  // 두 인스턴스 모두 counter=0에서 시작 — auto id에 엔트로피가 없으면 둘 다 "designFlow#0"을
  // 만들어 두 번째 run이 "already exists"로 죽는다 (프로세스 재시작 + 공유 store 시나리오).
  const out1 = await mk().run("designFlow", { message: "add /healthz" });
  const out2 = await mk().run("designFlow", { message: "add /healthz" });
  expect(out1).toEqual({ prUrl: "https://d.example/pull/9" });
  expect(out2).toEqual({ prUrl: "https://d.example/pull/9" });
});

// loopy() 빌더용 최소 픽스처: dep 하나를 요구하는 단일 step 워크플로우 — .provide() 경로를 통과시킨다.
const ping = step({
  name: "ping",
  input: io<{ n: number }>(),
  output: io<{ n: number }>(),
  deps: ["repo"],
  run: async (i, { deps }) => {
    void deps;
    return { n: i.n };
  },
});
const pingFlow = workflow({
  name: "pingFlow",
  state: { out: lastChannel<{ n: number } | null>(null) },
  input: io<{ n: number }>(),
  output: io<{ n: number }>(),
})
  .nodes({ ping: node(ping, { reads: (s) => ({ n: s.input.n }), writes: "out" }) })
  .flow((b) => b.start("ping").edge("ping", END))
  .returns((s) => ({ n: s.out?.n ?? -1 }));

test("loopy() builder reuses one runtime/store across runs", async () => {
  const app = loopy({ agents: {}, workflows: { pingFlow } }).provide({ repo: stubDeps.repo });
  const out = await app.run("pingFlow", { n: 1 }, { threadId: "dup" });
  expect(out).toEqual({ n: 1 });
  // 메모이즈 전엔 run마다 새 defineLoopy(→ 새 memoryStore)가 생겨 아래가 조용히 성공했다.
  // 하나의 runtime/store를 공유해야 같은 threadId 재사용이 "already exists"로 거부된다.
  await expect(app.run("pingFlow", { n: 2 }, { threadId: "dup" })).rejects.toThrow(/already exists/);
});
