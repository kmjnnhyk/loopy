// Consumer-side reads — the actual seam assertions. These compile-check the
// .d.ts boundary; the emitted forms are read by hand for hover cleanliness.
import type { ToolDepKeys, StateOf } from "@loopyjs/core";
import { codeGen } from "./agents";
import { jiraFlow } from "./workflows";
import type { BaseBranchChoice, UserClarification } from "./workflows";
import { runtime, deferred } from "./loopy";

type Expect<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// ── seam ①: ToolDepKeys<codeGen.tools> = "repo" (name preserved, not a blob)
//    codeGen.tools = [editFile, createFile, readFile, fileAnalyzer(sub-agent)],
//    all repo-typed → the accumulated union must be exactly "repo".
export type CodeGenToolDeps = ToolDepKeys<typeof codeGen.tools>;
export type _Seam1 = Expect<Equal<CodeGenToolDeps, "repo">>;

// ── seam ④: jiraFlow interrupt channels survive the boundary as NAMED types.
export type JiraState = StateOf<(typeof jiraFlow)["state"]>;
export type _Seam4a = Expect<Equal<JiraState["baseBranch"], BaseBranchChoice | null>>;
export type _Seam4b = Expect<Equal<JiraState["clarification"], UserClarification | null>>;

// ── seam ②/③: rt.run input/output typed across the package boundary.
//    (Hover on the return + the autocomplete on the name is read by hand.)
export async function demoDesign(): Promise<{ prUrl: string }> {
  return runtime.run("designFlow", { message: "add /healthz" });
}
export async function demoJira(): Promise<{ prUrl: string }> {
  return runtime.run("jiraFlow", { issueKey: "PROJ-142" });
}
export async function demoDeferred(): Promise<{ prUrl: string }> {
  return deferred.run("designFlow", { message: "x" });
}
