// team seam assertions (P1–P7). Compile-checks the .d.ts boundary; the emitted
// forms are hand-read by the main session for hover cleanliness (spec §10).
import type { PassToOf, PassToolNames, TeamInputOf, StateOf, TeamFullState, Msg, GuardAgents } from "loopy";
import { triage, reviewer, triageState, bugFixer, docsWriter } from "./team";
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
