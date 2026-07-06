#!/usr/bin/env bun
export {}; // force module scope — otherwise this script-mode file's top-level const leaks as an ambient global under isolatedDeclarations
// loopy CLI — v1 surface: `loopy test [-u] [bun test args]`.
const [cmd, ...rest] = process.argv.slice(2);

if (cmd === "test") {
  const update = rest.includes("-u") || rest.includes("--update");
  const passthrough = rest.filter((a) => a !== "-u" && a !== "--update");
  const env = { ...process.env, ...(update ? { UPDATE_GOLDEN: "1" } : {}) };
  const p = Bun.spawnSync(["bun", "test", ...passthrough], { env, stdout: "inherit", stderr: "inherit", stdin: "inherit" });
  process.exit(p.exitCode ?? 1);
}

console.error(`loopy: unknown command "${cmd ?? ""}". Usage: loopy test [-u] [bun test args]`);
process.exit(2);
