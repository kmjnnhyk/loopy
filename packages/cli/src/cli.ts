#!/usr/bin/env bun
// loopy CLI — v1 surface: `loopy test [-u] [bun test args]`, `loopy dev <module> [--port N]`.

interface DevRuntime { run: (...a: never[]) => unknown; "~dev"?: unknown; }

export function resolveRuntime(mod: Record<string, unknown>): DevRuntime {
  const rt = (mod.runtime ?? mod.default) as DevRuntime | undefined;
  if (!rt || typeof rt.run !== "function") throw new Error("loopy dev: module has no `runtime` (named) or default runtime export.");
  if (!rt["~dev"]) throw new Error("loopy dev: runtime has no ~dev handle — build it with defineLoopy({...}) (the loopy() builder is unsupported).");
  return rt;
}

export function parseDevArgs(rest: string[]): { modPath: string | undefined; port: number } {
  let modPath: string | undefined;
  let port = 5173;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--port") { port = Number(rest[++i]); continue; }        // consume the next token as the value
    if (a.startsWith("--port=")) { port = Number(a.slice("--port=".length)); continue; }
    if (a.startsWith("--")) continue;                                   // ignore any other flags
    if (modPath === undefined) modPath = a;                             // first bare token wins
  }
  return { modPath, port };
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);

  if (cmd === "test") {
    const update = rest.includes("-u") || rest.includes("--update");
    const passthrough = rest.filter((a) => a !== "-u" && a !== "--update");
    const env = { ...process.env, ...(update ? { UPDATE_GOLDEN: "1" } : {}) };
    const p = Bun.spawnSync(["bun", "test", ...passthrough], { env, stdout: "inherit", stderr: "inherit", stdin: "inherit" });
    process.exit(p.exitCode ?? 1);
  }

  if (cmd === "dev") {
    const { modPath, port } = parseDevArgs(rest);
    if (!modPath) { console.error("usage: loopy dev <module> [--port N]"); process.exit(2); }
    const { startDevServer } = await import("@loopyjs/devtools");
    const mod = (await import(Bun.resolveSync(modPath, process.cwd()))) as Record<string, unknown>;
    const runtime = resolveRuntime(mod);
    const staticDir = new URL("../browser/dist", import.meta.resolve("@loopyjs/devtools")).pathname;
    const srv = startDevServer({ runtime: runtime as never, port, staticDir });
    console.log(`loopy dev → http://localhost:${srv.port}`);
    return;
  }

  console.error(`loopy: unknown command "${cmd ?? ""}". Usage: loopy test [-u] | loopy dev <module> [--port N]`);
  process.exit(2);
}

if (import.meta.main) void main();
