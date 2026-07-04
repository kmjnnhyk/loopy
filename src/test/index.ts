import { test as bunTest } from "bun:test";
import { ReplayDivergence, type Runtime } from "loopy";
import { goldenExists, goldenPath, readGolden, writeGolden } from "./golden";

export interface ReplayCtx {
  replay(name: string, input: unknown): Promise<{ output: unknown }>;
}
export interface ReplayFixtureOpts {
  readonly dir: string;
  readonly update?: boolean;
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
      const path = goldenPath(opts.dir, name);
      if (update || !goldenExists(path)) {
        const events = await handle.record(name, input);
        writeGolden(path, { entry: name, input, events });
        // return the output the same way replay would (agent-unwrapped) by replaying the fresh golden.
        const rec = await handle.replay(name, input, events);
        return { output: rec.output };
      }
      const golden = readGolden(path);
      const res = await handle.replay(name, input, golden.events);
      if (res.divergence) {
        throw new ReplayDivergence(res.divergence.pos, res.divergence.expected, res.divergence.actual);
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
      const fixture = replayFixture(runtime, { dir: opts.dir });
      bunTest(name, async () => {
        await fn(fixture);
      });
    },
  };
}
