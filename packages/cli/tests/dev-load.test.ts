import { expect, test } from "bun:test";
import { parseDevArgs, resolveRuntime } from "../src/cli.ts";

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

test("parseDevArgs: bare module → default port", () => {
  expect(parseDevArgs(["./app.ts"])).toEqual({ modPath: "./app.ts", port: 5173 });
});

test("parseDevArgs: space-separated --port after module", () => {
  expect(parseDevArgs(["./app.ts", "--port", "8080"])).toEqual({ modPath: "./app.ts", port: 8080 });
});

test("parseDevArgs: --port=N after module", () => {
  expect(parseDevArgs(["./app.ts", "--port=8080"])).toEqual({ modPath: "./app.ts", port: 8080 });
});

test("parseDevArgs: space-separated --port BEFORE module (value not mistaken for module)", () => {
  expect(parseDevArgs(["--port", "8080", "./app.ts"])).toEqual({ modPath: "./app.ts", port: 8080 });
});

test("parseDevArgs: --port=N before module", () => {
  expect(parseDevArgs(["--port=8080", "./app.ts"])).toEqual({ modPath: "./app.ts", port: 8080 });
});

test("parseDevArgs: --port with no module → modPath undefined (port value not mistaken for module)", () => {
  expect(parseDevArgs(["--port", "8080"])).toEqual({ modPath: undefined, port: 8080 });
});

test("parseDevArgs: no args → undefined module, default port", () => {
  expect(parseDevArgs([])).toEqual({ modPath: undefined, port: 5173 });
});
