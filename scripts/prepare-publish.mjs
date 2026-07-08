// Rewrite `workspace:` protocol dependency ranges to real `^<version>` ranges,
// in place, across every package under packages/.
//
// Why: the `workspace:` protocol is a Bun/pnpm/yarn feature — `npm` does NOT
// understand or rewrite it. We publish through `npm` (for OIDC trusted
// publishing + automatic provenance), so a published manifest must not contain
// literal `workspace:*|^|~`. This script replaces each such range with
// `^<version>` of the referenced @loopyjs package (all lockstep-versioned).
//
// Run order in CI: build FIRST (Bun resolves `workspace:` from the local
// workspace at build time), THEN this script, THEN `npm publish`. It mutates
// package.json in the ephemeral CI checkout only — never commit the result.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const pkgsDir = new URL("../packages/", import.meta.url);
const dirs = readdirSync(pkgsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

// name (@loopyjs/x) -> version, so a `workspace:` range resolves to that pkg's version.
const versions = {};
for (const d of dirs) {
  const p = JSON.parse(readFileSync(new URL(`${d}/package.json`, pkgsDir), "utf8"));
  versions[p.name] = p.version;
}

const SECTIONS = ["dependencies", "peerDependencies", "devDependencies", "optionalDependencies"];
let total = 0;
for (const d of dirs) {
  const file = new URL(`${d}/package.json`, pkgsDir);
  const p = JSON.parse(readFileSync(file, "utf8"));
  let changed = false;
  for (const s of SECTIONS) {
    const deps = p[s];
    if (!deps) continue;
    for (const [name, range] of Object.entries(deps)) {
      if (typeof range === "string" && range.startsWith("workspace:")) {
        const v = versions[name];
        if (!v) throw new Error(`${p.name}: ${s}.${name} uses ${range} but ${name} has no known workspace version`);
        deps[name] = `^${v}`;
        changed = true;
        total++;
      }
    }
  }
  if (changed) {
    writeFileSync(file, JSON.stringify(p, null, 2) + "\n");
    console.log(`  rewrote workspace: deps in ${p.name}`);
  }
}
console.log(`prepare-publish: rewrote ${total} workspace: range(s) to ^<version>`);
