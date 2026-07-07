// team seam assertions (P1–P7). Compile-checks the .d.ts boundary; the emitted
// forms are hand-read by the main session for hover cleanliness (spec §10).
import type { PassToOf, PassToolNames, TeamInputOf, StateOf, TeamFullState, Msg, GuardAgents, TeamRouterReturn, WritesResult, InputOf, RequiredDeps } from "@loopyjs/core";
import { triage, reviewer, triageState, bugFixer, docsWriter, prTriage, requestApproval, teamRt } from "./team";
import type { Issue, ReviewResult } from "./team";

type Expect<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// passTo names captured as a literal union; an agent with no passTo → never (absorbed).
export type _T1a = Expect<Equal<PassToOf<typeof triage>, "bugFixer" | "docsWriter">>;
export type _T1b = Expect<Equal<PassToOf<typeof reviewer>, never>>;

// P1: pass_to_* tool names synthesized from the captured passTo union, NAMED.
export type _P1 = Expect<Equal<
  keyof PassToolNames<PassToOf<typeof triage>>,
  "pass_to_bugFixer" | "pass_to_docsWriter"
>>;

// P4 (input half): only ~input-branded channels are selected as run input.
export type _P4in = Expect<Equal<TeamInputOf<typeof triageState>, { readonly issue: Issue }>>;

// P3: team auto-injects transcript + nextAgent; author channels survive named.
type Names = "triage" | "bugFixer" | "docsWriter" | "reviewer";
type FullState = TeamFullState<typeof triageState, Names>;
type S = StateOf<FullState>;
export type _P3a = Expect<Equal<S["nextAgent"], Names | null>>;
export type _P3b = Expect<Equal<S["transcript"], readonly Msg[]>>;
export type _P3c = Expect<Equal<S["review"], ReviewResult | null>>;   // author channel named
export type _P3d = Expect<Equal<S["issue"], Issue>>;                  // inputChannel value survives

// T5: a valid agents map (all passTo targets are members) passes the guard
// UNCHANGED — no "~passToTargetNotInTeam" slot appears (reviewer's empty passTo
// is absorbed to never → [never] extends [never] → passes).
type ValidAgents = {
  triage: typeof triage; bugFixer: typeof bugFixer;
  docsWriter: typeof docsWriter; reviewer: typeof reviewer;
};
export type _T5 = Expect<Equal<
  { [K in keyof GuardAgents<ValidAgents>]: 1 },
  { [K in keyof ValidAgents]: 1 }
>>;

// P2: router return union INCLUDES entry "triage" (inherited .branch surface).
export type _P2 = Expect<Equal<
  TeamRouterReturn<{ triage: 1; bugFixer: 1; docsWriter: 1; reviewer: 1 }>,
  "triage" | "bugFixer" | "docsWriter" | "reviewer" | "~end"
>>;
void prTriage;  // fixture must compile (.writes + .router chain type-checks)

// P6: WritesResult cardinality split — exactly 1 mapping → that channel's value;
// 0 or 2+ → full StateOf snapshot (no silent single-channel pick, spec §4/§10.1).
export type _P6single = Expect<Equal<
  WritesResult<typeof triageState, { reviewer: "review" }>,
  ReviewResult | null
>>;
export type _P6multi = Expect<Equal<
  WritesResult<typeof triageState, { reviewer: "review"; triage: "issue" }>,
  StateOf<typeof triageState>
>>;
export type _P6zero = Expect<Equal<
  WritesResult<typeof triageState, {}>,
  StateOf<typeof triageState>
>>;

// P5: the tool's run-ctx exposes interrupt<T> (HITL flows through the tool, not
// the declarative agent). Verify the ctx param shape carries interrupt.
type ReviewToolCtx = Parameters<(typeof requestApproval)["run"]>[1];
export type _P5 = Expect<Equal<
  ReviewToolCtx extends { interrupt: infer F } ? F : never,
  <T>(payload: unknown) => Promise<T>
>>;

// P4 (output half): rt.run narrows to the single .writes-mapped channel value.
export async function demoTriage(): Promise<ReviewResult | null> {
  return teamRt.run("prTriage", { issue: { id: 7, body: "x" } });
}
// P4 (input): rt.run input = the inputChannel-selected shape.
export type _P4input = Expect<Equal<InputOf<typeof prTriage>, { readonly issue: Issue }>>;
// P7: team deps converge (bugFixer's "repo"); passTo synthesis contributes none.
export type _P7 = Expect<Equal<RequiredDeps<{ prTriage: typeof prTriage }>, "repo">>;
