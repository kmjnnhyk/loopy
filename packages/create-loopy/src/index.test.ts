import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffold } from "./index.ts";

test("scaffold copies template, renames _gitignore, substitutes name + version", () => {
  const dir = mkdtempSync(join(tmpdir(), "loopy-scaffold-"));
  const target = join(dir, "my-app");

  scaffold(target, "0.1.0");

  expect(existsSync(join(target, "index.ts"))).toBe(true);
  expect(existsSync(join(target, "tsconfig.json"))).toBe(true);
  expect(existsSync(join(target, ".vscode", "settings.json"))).toBe(true);
  expect(existsSync(join(target, ".gitignore"))).toBe(true);
  expect(existsSync(join(target, "_gitignore"))).toBe(false);

  const pkg = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
  expect(pkg.name).toBe("my-app");
  expect(pkg.dependencies["@loopyjs/core"]).toBe("^0.1.0");
  expect(pkg.devDependencies["@loopyjs/cli"]).toBe("^0.1.0");
  expect(pkg.devDependencies["@loopyjs/devtools"]).toBe("^0.1.0");

  rmSync(dir, { recursive: true, force: true });
});

test("scaffold refuses a non-empty target directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "loopy-scaffold-"));
  const target = join(dir, "app");
  scaffold(target, "0.1.0");
  expect(() => scaffold(target, "0.1.0")).toThrow(/not empty/);
  rmSync(dir, { recursive: true, force: true });
});
