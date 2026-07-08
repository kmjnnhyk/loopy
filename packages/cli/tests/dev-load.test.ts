import { expect, test } from "bun:test";
import { resolveRuntime } from "../src/cli.ts";

test("resolveRuntime prefers a named `runtime` export", () => {
  const rt = { run() {}, "~dev": {} };
  expect(resolveRuntime({ runtime: rt })).toBe(rt);
});

test("resolveRuntime falls back to default export", () => {
  const rt = { run() {}, "~dev": {} };
  expect(resolveRuntime({ default: rt })).toBe(rt);
});

test("resolveRuntime fails loud when no runtime / no ~dev handle", () => {
  expect(() => resolveRuntime({})).toThrow(/no `runtime`/);
  expect(() => resolveRuntime({ runtime: { run() {} } })).toThrow(/~dev/);
});
