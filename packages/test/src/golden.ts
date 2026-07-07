import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { digest, type RuntimeEvent as Event } from "@loopyjs/core";

export interface GoldenFile {
  readonly loopyGoldenVersion: 1;
  readonly entry: string;
  readonly input: unknown;
  readonly events: readonly Event[];
}

/** test-name → filesystem-safe stem: strip diacritics-free, collapse non-word runs to "_" / "-". */
function sanitize(name: string): string {
  return name
    .trim()
    .replace(/\s*[:/\\]+\s*/g, "_")
    .replace(/\s+/g, "-")
    .replace(/[^\w.-]+/g, "")
    .replace(/_+/g, "_")
    .replace(/-+/g, "-");
}

export function goldenPath(dir: string, testName: string): string {
  // digest is over the RAW name, so names that sanitize to the same stem
  // (differ only in ":" / "/" / whitespace) still get distinct files.
  return join(dir, "__golden__", `${sanitize(testName)}.${digest(testName).slice(0, 8)}.json`);
}

export function goldenExists(path: string): boolean {
  return existsSync(path);
}

export function readGolden(path: string): GoldenFile {
  const g = JSON.parse(readFileSync(path, "utf8")) as GoldenFile;
  if (g.loopyGoldenVersion !== 1) {
    throw new Error(`readGolden("${path}"): unsupported loopyGoldenVersion ${g.loopyGoldenVersion} — re-record with -u`);
  }
  return g;
}

/** `ts` is metadata (never folded/compared); blank it so re-records diff only on real changes. */
export function writeGolden(path: string, g: { entry: string; input: unknown; events: readonly Event[] }): void {
  mkdirSync(dirname(path), { recursive: true });
  const events = g.events.map((e) => ({ ...e, ts: "" }));
  const file: GoldenFile = { loopyGoldenVersion: 1, entry: g.entry, input: g.input, events };
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
}
