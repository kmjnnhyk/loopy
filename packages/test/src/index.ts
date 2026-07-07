import { test as bunTest } from "bun:test";
import { ReplayDivergence, type Runtime } from "@loopyjs/core";
import { goldenExists, goldenPath, readGolden, writeGolden } from "./golden.ts";

export interface ReplayCtx {
  replay(name: string, input: unknown): Promise<{ output: unknown }>;
}
export interface ReplayFixtureOpts {
  readonly dir: string;
  readonly update?: boolean;
  /** golden file identity. Defaults to the entry name passed to replay(); defineLoopyTest
   *  sets it to the TEST name so each test owns one golden (one replay per test). */
  readonly goldenKey?: string;
}

/** testable record-or-replay core (no bun:test coupling). */
export function replayFixture(runtime: Runtime<any>, opts: ReplayFixtureOpts): ReplayCtx {
  const handle = runtime["~test"];
  if (!handle) {
    throw new Error("defineLoopyTest: this runtime has no test handle — build it with defineLoopy({...}) (the loopy() builder is unsupported in v1).");
  }
  const update = opts.update ?? process.env.UPDATE_GOLDEN === "1";

  return {
    async replay(name, input): Promise<{ output: unknown }> {
      const path = goldenPath(opts.dir, opts.goldenKey ?? name);
      if (update || !goldenExists(path)) {
        const events = await handle.record(name, input);
        writeGolden(path, { entry: name, input, events });
        // Self-check via replay of the fresh golden: this also agent-unwraps the output
        // the same way a real replay would. A divergence here means the just-recorded
        // golden does NOT reproduce itself — the author's orchestration is impure
        // (non-deterministic reads/router/returns). Fail loud: a golden that can't replay
        // against itself is worthless as a regression baseline, and this is the ONE place
        // that impurity is observable (the immediate self-replay sees the mutated state).
        const rec = await handle.replay(name, input, events);
        if (rec.divergence) {
          const d = rec.divergence;
          throw new ReplayDivergence(d.pos, d.expected, d.actual, d.expectedPreview, d.actualPreview);
        }
        return { output: rec.output };
      }
      const golden = readGolden(path);
      const res = await handle.replay(name, input, golden.events);
      if (res.divergence) {
        const d = res.divergence;
        throw new ReplayDivergence(d.pos, d.expected, d.actual, d.expectedPreview, d.actualPreview);
      }
      return { output: res.output };
    },
  };
}

export function defineLoopyTest(
  runtime: Runtime<any>,
  opts: { dir: string },
): { test: (name: string, fn: (t: ReplayCtx) => unknown | Promise<unknown>) => void } {
  return {
    test(name, fn) {
      const fixture = replayFixture(runtime, { dir: opts.dir, goldenKey: name });
      bunTest(name, async () => {
        await fn(fixture);
      });
    },
  };
}
