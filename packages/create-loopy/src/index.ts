#!/usr/bin/env node
import { cpSync, renameSync, readFileSync, writeFileSync, existsSync, readdirSync, realpathSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATE_DIR: string = fileURLToPath(new URL("../template/", import.meta.url));
const SELF_PKG: { version: string } = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
) as { version: string };

export function scaffold(targetDir: string, version: string): void {
  const dest = resolve(process.cwd(), targetDir);
  if (existsSync(dest) && readdirSync(dest).length > 0) {
    throw new Error(`Target directory "${targetDir}" exists and is not empty.`);
  }
  cpSync(TEMPLATE_DIR, dest, { recursive: true });

  // npm strips a published top-level `.gitignore`; the template ships `_gitignore`.
  const shippedGitignore = join(dest, "_gitignore");
  if (existsSync(shippedGitignore)) renameSync(shippedGitignore, join(dest, ".gitignore"));

  // Substitute project name + lockstep loopy version into package.json.
  const pkgPath = join(dest, "package.json");
  const substituted = readFileSync(pkgPath, "utf8")
    .replaceAll("__NAME__", basename(dest))
    .replaceAll("__VERSION__", version);
  writeFileSync(pkgPath, substituted);
}

function main(): void {
  const arg = process.argv[2] ?? "loopy-app";
  scaffold(arg, SELF_PKG.version);
  process.stdout.write(
    `\n✔ Created ${arg}\n\nNext steps:\n  cd ${arg}\n  bun install\n  bun run dev\n`,
  );
}

const entry = process.argv[1];
if (entry && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) main();
