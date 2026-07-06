import { describe, expect, test } from "bun:test";
import { lastChannel, listChannel } from "@loopyjs/core";
import { initialState, applyPatch, foldScoped, rawChannel, UnknownChannelError } from "../../src/runtime/channels";
import { threadId, runId, type Event } from "../../src/runtime/events";

const ch = {
  n: lastChannel<number>(0),
  log: listChannel<string>(),
  seed: rawChannel<string>(),
};

test("initialState uses channel factories", () => {
  expect(initialState(ch)).toEqual({ n: 0, log: [], seed: undefined });
});

describe("applyPatch", () => {
  test("folds present keys only; absent keys untouched", () => {
    const s1 = applyPatch(ch, initialState(ch), { n: 5 });
    expect(s1).toEqual({ n: 5, log: [], seed: undefined });
    const s2 = applyPatch(ch, s1, { log: "a" });
    expect(s2.n).toBe(5);
    expect(s2.log).toEqual(["a"]);
  });
  test("unknown channel key throws loud", () => {
    expect(() => applyPatch(ch, initialState(ch), { nope: 1 })).toThrow(UnknownChannelError);
  });
});

test("foldScoped folds only StatePatched of the exact scope", () => {
  const base = { threadId: threadId("t"), runId: runId("r"), ts: "" };
  const events: Event[] = [
    { ...base, seq: 0, node: "", type: "StatePatched", update: { n: 1 } },
    { ...base, seq: 1, node: "agentA#1", type: "StatePatched", update: { n: 99 } },
    { ...base, seq: 2, node: "", type: "StatePatched", update: { log: ["x", "y"] } },
    { ...base, seq: 3, node: "", type: "RunEnded", output: null },
  ];
  const s = foldScoped(ch, events, "");
  expect(s.n).toBe(1);
  expect(s.log).toEqual(["x", "y"]);
});
