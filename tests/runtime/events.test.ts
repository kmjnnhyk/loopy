import { describe, expect, test } from "bun:test";
import { stableStringify, digest, posKey, serializeError, threadId } from "../../src/runtime/events";

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
