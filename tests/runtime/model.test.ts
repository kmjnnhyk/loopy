import { expect, test } from "bun:test";
import { stubModel, type ModelRequest } from "../../src/runtime/model";

const req = (content: string): ModelRequest => ({ model: "stub", messages: [{ role: "user", content }] });

test("stubModel consumes fixtures in order and records calls", async () => {
  const m = stubModel([
    { text: "first", stopReason: "end_turn" },
    (r) => ({ text: `echo:${r.messages[0]!.content}`, stopReason: "end_turn" }),
  ]);
  expect((await m.complete(req("a"))).text).toBe("first");
  expect((await m.complete(req("b"))).text).toBe("echo:b");
  expect(m.calls.length).toBe(2);
});

test("stubModel throws loud when exhausted", async () => {
  const m = stubModel([]);
  await expect(m.complete(req("x"))).rejects.toThrow("stubModel exhausted");
});
