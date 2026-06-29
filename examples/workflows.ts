// 2 workflows — two-phase .nodes().flow(). designFlow has build↔codeGen and
// verify↔codeGen cycles (router typing). jiraFlow has 2 interrupts (HITL).
import { workflow, step, io, lastChannel, END } from "loopy";
import { fetchFigma, getIssue, openPR, waitForDeploy } from "./tools";
import { fileAnalyzer, codeGen, verifier, sufficiency } from "./agents";
import type { FigmaData, DeployResult } from "./deps";

// HITL payload types — named so they must survive .d.ts emit as channel values.
export interface UserClarification {
  readonly answers: readonly string[];
  readonly by: string;
}
export interface BaseBranchChoice {
  readonly baseBranch: string;
  readonly confirmedBy: string;
}

// ── inline workflow nodes (deps declared) ──────────────────────────────────
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
    build: lastChannel<{ ok: boolean } | null>(null),
    deploy: lastChannel<DeployResult | null>(null),
  },
  input: io<{ message: string }>(),
  output: io<{ prUrl: string }>(),
})
  .nodes({ fetchFigma, fileAnalyzer, codeGen, build, verify: verifier, push, deploy: waitForDeploy })
  .flow((b) =>
    b
      .start("fetchFigma")
      .edge("fetchFigma", "fileAnalyzer")
      .edge("fileAnalyzer", "codeGen")
      .edge("codeGen", "build")
      .branch("build", (s) => (s.build?.ok ? "verify" : "codeGen")) // build↔codeGen cycle
      .branch("verify", (s) => (s.figma ? "push" : "codeGen")) // verify↔codeGen cycle
      .edge("push", "deploy")
      .edge("deploy", END),
  );

// ── jiraFlow: 2 interrupts (needsInput, awaitBase) ─────────────────────────
const preprocess = step({
  name: "preprocess",
  input: io<{ issue: string }>(),
  output: io<{ normalized: string }>(),
  run: async (i) => ({ normalized: i.issue }),
});

const needsInput = step({
  name: "needsInput",
  input: io<{ missing: readonly string[] }>(),
  output: io<{ clarified: UserClarification }>(),
  run: async (_i, ctx) => {
    const clarified = await ctx.interrupt<UserClarification>({ kind: "clarify" }); // interrupt #1
    return { clarified };
  },
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
  output: io<{ chosen: BaseBranchChoice }>(),
  run: async (_i, ctx) => {
    const chosen = await ctx.interrupt<BaseBranchChoice>({ kind: "pick-base" }); // interrupt #2
    return { chosen };
  },
});

export const jiraFlow = workflow({
  name: "jiraFlow",
  state: {
    verdict: lastChannel<"sufficient" | "partial" | "insufficient" | null>(null),
    clarification: lastChannel<UserClarification | null>(null),
    baseBranch: lastChannel<BaseBranchChoice | null>(null),
    prUrl: lastChannel<string | null>(null),
  },
  input: io<{ issueKey: string }>(),
  output: io<{ prUrl: string }>(),
})
  .nodes({ gate: getIssue, preprocess, sufficiency, needsInput, implement, awaitBase, openPR })
  .flow((b) =>
    b
      .start("gate")
      .edge("gate", "preprocess")
      .edge("preprocess", "sufficiency")
      .branch("sufficiency", (s) => (s.verdict === "insufficient" ? "needsInput" : "implement"))
      .edge("needsInput", "implement")
      .edge("implement", "awaitBase")
      .branch("awaitBase", (s) => (s.baseBranch ? "openPR" : "awaitBase"))
      .edge("openPR", END),
  );
