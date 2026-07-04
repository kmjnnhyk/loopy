import { describe, expect, test } from "bun:test";
import { io } from "loopy";
import { parseStructured, ParseError } from "../../src/runtime/sap";

const schema = io<{ verdict: string; n: number }>();

describe("parseStructured", () => {
  test("plain JSON", () => {
    expect(parseStructured(schema, '{"verdict":"ok","n":1}')).toEqual({ verdict: "ok", n: 1 });
  });
  test("markdown fenced + surrounding prose", () => {
    const raw = 'Sure! Here you go:\n```json\n{"verdict":"ok","n":2}\n```\nLet me know.';
    expect(parseStructured(schema, raw)).toEqual({ verdict: "ok", n: 2 });
  });
  test("prose-embedded JSON without fences (balanced scan)", () => {
    expect(parseStructured(schema, 'result: {"verdict":"ok","n":3} — done')).toEqual({ verdict: "ok", n: 3 });
  });
  test("trailing comma repaired", () => {
    expect(parseStructured(schema, '{"verdict":"ok","n":4,}')).toEqual({ verdict: "ok", n: 4 });
  });
  test("no JSON at all → ParseError with raw preserved", () => {
    expect(() => parseStructured(schema, "I refuse.")).toThrow(ParseError);
    try {
      parseStructured(schema, "I refuse.");
    } catch (e) {
      expect((e as ParseError).raw).toBe("I refuse.");
    }
  });
  test("stray brace in prose before the payload is skipped (backtrack)", () => {
    expect(parseStructured(schema, 'The schema uses { for objects. Answer: {"verdict":"ok","n":5}')).toEqual({ verdict: "ok", n: 5 });
  });
  test("comma repair is string-safe: literal ,} inside a string survives", () => {
    expect(parseStructured(schema, '{"verdict":"x,}","n":6,}')).toEqual({ verdict: "x,}", n: 6 });
  });
  test("scanner is string-safe: braces/brackets inside string values", () => {
    expect(parseStructured(schema, '{"verdict":"has { and ] inside","n":7}')).toEqual({ verdict: "has { and ] inside", n: 7 });
  });
});
