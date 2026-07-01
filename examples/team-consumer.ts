// team seam assertions (P1–P7). Compile-checks the .d.ts boundary; the emitted
// forms are hand-read by the main session for hover cleanliness (spec §10).
import type { PassToOf } from "loopy";
import { triage, reviewer } from "./team";

type Expect<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// passTo names captured as a literal union; an agent with no passTo → never (absorbed).
export type _T1a = Expect<Equal<PassToOf<typeof triage>, "bugFixer" | "docsWriter">>;
export type _T1b = Expect<Equal<PassToOf<typeof reviewer>, never>>;
