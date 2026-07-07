import { expect, test } from "bun:test";

// Drive the CLI as a subprocess against a tiny inline "bun test" replacement is overkill;
// instead assert the CLI's env/arg wiring by running it with a no-op test dir and reading
// the propagated UPDATE_GOLDEN via a probe test file.
test("loopy test -u sets UPDATE_GOLDEN=1 for the delegated runner", () => {
  // "./" prefix: bun test treats a bare relative path as a name filter (subject to the
  // .test/.spec naming convention) and a path-prefixed one as an explicit file — _probe.env.ts
  // intentionally doesn't match the convention, so it needs the prefix to be found at all.
  const probe = "./packages/cli/tests/_probe.env.ts";
  // _probe.env.ts prints the env var; the CLI should forward it.
  const p = Bun.spawnSync(["bun", "packages/cli/src/cli.ts", "test", "-u", probe]);
  if (p.exitCode !== 0) console.error("cli stderr:", p.stderr.toString());
  expect(p.stdout.toString()).toContain("UPDATE_GOLDEN=1");
});

test("loopy test (no -u) leaves UPDATE_GOLDEN unset", () => {
  const probe = "./packages/cli/tests/_probe.env.ts";
  const p = Bun.spawnSync(["bun", "packages/cli/src/cli.ts", "test", probe]);
  expect(p.stdout.toString()).toContain("UPDATE_GOLDEN=<unset>");
});

test("unknown command → exit code 2 with a usage error on stderr", () => {
  const p = Bun.spawnSync(["bun", "packages/cli/src/cli.ts", "bogus"]);
  expect(p.exitCode).toBe(2);
  expect(p.stderr.toString()).toContain('unknown command "bogus"');
});

test("no command → exit code 2 with a usage error on stderr", () => {
  const p = Bun.spawnSync(["bun", "packages/cli/src/cli.ts"]);
  expect(p.exitCode).toBe(2);
  expect(p.stderr.toString()).toContain('unknown command ""');
});
