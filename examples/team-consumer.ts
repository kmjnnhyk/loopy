// team seam assertions (P1–P7). Compile-checks the .d.ts boundary; the emitted
// forms are hand-read by the main session for hover cleanliness (spec §10).
import type { PassToOf, PassToolNames, TeamInputOf } from "loopy";
import { triage, reviewer, triageState } from "./team";
import type { Issue } from "./team";

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
