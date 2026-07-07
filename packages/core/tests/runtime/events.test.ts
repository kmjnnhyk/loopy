import { describe, expect, test } from "bun:test";
import { stableStringify, digest, preview, posKey, serializeError, threadId } from "../../src/runtime/events";

describe("stableStringify", () => {
  test("key order-insensitive", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  });
  test("arrays keep order", () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });
});

describe("digest", () => {
  test("deterministic + arg-sensitive", () => {
    expect(digest({ x: 1 })).toBe(digest({ x: 1 }));
    expect(digest({ x: 1 })).not.toBe(digest({ x: 2 }));
  });
  test("Date is value-sensitive, not collapsed to {}", () => {
    const a = new Date("2026-01-01T00:00:00.000Z");
    const b = new Date("2026-01-02T00:00:00.000Z");
    expect(digest({ at: a })).not.toBe(digest({ at: b }));
    expect(digest({ at: a })).toBe(digest({ at: new Date("2026-01-01T00:00:00.000Z") }));
  });
  test("bigint does not throw and is value-sensitive", () => {
    expect(() => digest({ big: 10n })).not.toThrow();
    expect(digest({ big: 10n })).not.toBe(digest({ big: 11n }));
  });
});

describe("preview", () => {
  test("short values pass through as stable JSON", () => {
    expect(preview({ n: 5 })).toBe('{"n":5}');
  });
  test("long values are truncated with a trailing ellipsis", () => {
    const p = preview({ s: "x".repeat(200) }, 40);
    expect(p.length).toBe(41); // 40 sliced chars + the "…"
    expect(p.endsWith("…")).toBe(true);
  });
});

test("posKey encodes scope/ordinal/op", () => {
  expect(posKey("build#1", 0, "tool")).toBe("build#1|0|tool");
});

test("serializeError captures name/message", () => {
  const e = serializeError(new RangeError("boom"));
  expect(e.name).toBe("RangeError");
  expect(e.message).toBe("boom");
});

test("threadId brands a string", () => {
  const t = threadId("t-1");
  expect(t).toBe("t-1" as string);
});
