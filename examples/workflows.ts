// 2 workflows — node() bindings + .returns() (runtime spec §5). jiraFlow: interrupt 2x.
import { workflow, step, node, io, lastChannel, END } from "@loopyjs/core";
import { fetchFigma, getIssue, openPR, waitForDeploy } from "./tools";
import { fileAnalyzer, codeGen, verifier, sufficiency } from "./agents";
import type { FigmaData, DeployResult, JiraIssue } from "./deps";

export interface UserClarification {
  readonly answers: readonly string[];
  readonly by: string;
}
export interface BaseBranchChoice {
  readonly baseBranch: string;
  readonly confirmedBy: string;
}

const build = step({
  name: "build",
  input: io<{ paths: readonly string[] }>(),
  output: io<{ ok: boolean; log: string }>(),
  deps: ["repo"],
  run: async (_i, { deps }) => {
    void deps;
    return { ok: true, log: "OK" };
  },
});

const push = step({
  name: "push",
  input: io<{ sha: string }>(),
  output: io<{ pushedAt: number }>(),
  deps: ["git"],
  run: async (_i, { deps }) => {
    void deps;
    return { pushedAt: 0 };
  },
});

export const designFlow = workflow({
  name: "designFlow",
  state: {
    figma: lastChannel<FigmaData | null>(null),
    paths: lastChannel<{ paths: readonly string[] } | null>(null),
    gen: lastChannel<{ applied: readonly string[]; failed: readonly string[] } | null>(null),
    build: lastChannel<{ ok: boolean; log: string } | null>(null),
    verify: lastChannel<{ passed: boolean; notes: string } | null>(null),
    deploy: lastChannel<DeployResult | null>(null),
  },
  input: io<{ message: string }>(),
  output: io<{ prUrl: string }>(),
})
  .nodes({
    fetchFigma: node(fetchFigma, { reads: (s) => ({ url: s.input.message }), writes: "figma" }),
    fileAnalyzer: node(fileAnalyzer, { reads: (s) => ({ goal: s.input.message }), writes: "paths" }),
    codeGen: node(codeGen, { reads: (s) => ({ task: s.input.message }), writes: "gen" }),
    build: node(build, { reads: (s) => ({ paths: s.paths?.paths ?? [] }), writes: "build" }),
    verify: node(verifier, { reads: (s) => ({ diff: (s.gen?.applied ?? []).join(",") }), writes: "verify" }),
    push: node(push, { reads: (s) => ({ sha: s.gen?.applied[0] ?? "HEAD" }) }),
    deploy: node(waitForDeploy, { reads: () => ({ since: 0 }), writes: "deploy" }),
  })
  .flow((b) =>
    b
      .start("fetchFigma")
      .edge("fetchFigma", "fileAnalyzer")
      .edge("fileAnalyzer", "codeGen")
      .edge("codeGen", "build")
      .branch("build", (s) => (s.build?.ok ? "verify" : "codeGen"))
      .branch("verify", (s) => (s.verify?.passed ? "push" : "codeGen"))
      .edge("push", "deploy")
      .edge("deploy", END),
  )
  .returns((s) => ({ prUrl: s.deploy?.url ?? "" }));

const preprocess = step({
  name: "preprocess",
  input: io<{ issue: string }>(),
  output: io<{ normalized: string }>(),
  run: async (i) => ({ normalized: i.issue }),
});

const needsInput = step({
  name: "needsInput",
  input: io<{ missing: readonly string[] }>(),
  output: io<UserClarification>(),
  run: async (_i, ctx) => ctx.interrupt<UserClarification>({ kind: "clarify" }),
});

const implement = step({
  name: "implement",
  input: io<{ task: string }>(),
  output: io<{ committed: boolean; sha: string | null }>(),
  deps: ["shell"],
  run: async (i, { deps }) => deps.shell.claude("/tmp/repo", i.task),
});

const awaitBase = step({
  name: "awaitBase",
  input: io<{ branch: string }>(),
  output: io<BaseBranchChoice>(),
  run: async (_i, ctx) => ctx.interrupt<BaseBranchChoice>({ kind: "pick-base" }),
});

export const jiraFlow = workflow({
  name: "jiraFlow",
  state: {
    issue: lastChannel<JiraIssue | null>(null),
    sufficiency: lastChannel<{ verdict: "sufficient" | "partial" | "insufficient"; missing: readonly string[] } | null>(null),
    clarification: lastChannel<UserClarification | null>(null),
    impl: lastChannel<{ committed: boolean; sha: string | null } | null>(null),
    baseBranch: lastChannel<BaseBranchChoice | null>(null),
    // deviation from brief: openPR's tool output is `{ url: string }` (examples/tools.ts,
    // out of scope for this task), not `string` — the channel value must match the tool's
    // actual output shape or the writes-side BindingCheck rejects the binding.
    pr: lastChannel<{ url: string } | null>(null),
  },
  input: io<{ issueKey: string }>(),
  output: io<{ prUrl: string }>(),
})
  .nodes({
    gate: node(getIssue, { reads: (s) => ({ key: s.input.issueKey }), writes: "issue" }),
    preprocess: node(preprocess, { reads: (s) => ({ issue: s.issue?.description ?? "" }) }),
    sufficiency: node(sufficiency, { reads: (s) => ({ issue: s.issue?.description ?? "" }), writes: "sufficiency" }),
    needsInput: node(needsInput, { reads: (s) => ({ missing: s.sufficiency?.missing ?? [] }), writes: "clarification" }),
    implement: node(implement, { reads: (s) => ({ task: s.issue?.summary ?? "" }), writes: "impl" }),
    awaitBase: node(awaitBase, { reads: () => ({ branch: "main" }), writes: "baseBranch" }),
    openPR: node(openPR, {
      reads: (s) => ({ head: s.impl?.sha ?? "", base: s.baseBranch?.baseBranch ?? "", title: s.issue?.summary ?? "" }),
      writes: "pr",
    }),
  })
  .flow((b) =>
    b
      .start("gate")
      .edge("gate", "preprocess")
      .edge("preprocess", "sufficiency")
      .branch("sufficiency", (s) => (s.sufficiency?.verdict === "insufficient" ? "needsInput" : "implement"))
      .edge("needsInput", "implement")
      .edge("implement", "awaitBase")
      .branch("awaitBase", (s) => (s.baseBranch ? "openPR" : "awaitBase"))
      .edge("openPR", END),
  )
  .returns((s) => ({ prUrl: s.pr?.url ?? "" }));
