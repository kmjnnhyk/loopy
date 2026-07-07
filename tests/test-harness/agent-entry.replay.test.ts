import { expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { defineLoopy, stubModel } from "@loopyjs/core";
import { classifier } from "../../examples/agents";
import { replayFixture } from "@loopyjs/test";

const answer = (o: unknown) => ({ text: JSON.stringify(o), stopReason: "end_turn" });

// classifier = an AGENT registered as a *top-level entry* (no deps, no tools). Every
// anchor/fixture entry elsewhere is workflow-kind, so this file is the only coverage for
// the agent-envelope unwrap shared by exec() and testHandle.replay(): an agent driver
// returns `{ output, handoff, messages }`, and run()/replay() must peel `.output` so the
// caller sees the bare answer — not the envelope.
const mkRuntime = () =>
  defineLoopy({
    agents: { classifier },
    workflows: {},
    deps: {} as never,
    models: { haiku: stubModel([answer({ kind: "design" })]) },
  });

const TMP = "/tmp/loopy-agent-entry-test";
const cleanup = () => rmSync(`${TMP}/__golden__`, { recursive: true, force: true });

test("run() on an agent entry returns the UNWRAPPED output (not the {output,...} envelope)", async () => {
  const out = await mkRuntime().run("classifier", { message: "add /healthz" });
  expect(out).toEqual({ kind: "design" });
});

test("~test.replay on an agent entry unwraps the envelope and replays green", async () => {
  const golden = await mkRuntime()["~test"]!.record("classifier", { message: "add /healthz" });
  expect(golden[golden.length - 1]!.type).toBe("RunEnded");
  const r = await mkRuntime()["~test"]!.replay("classifier", { message: "add /healthz" }, golden);
  expect(r.divergence).toBeNull();
  expect(r.output).toEqual({ kind: "design" }); // unwrapped — NOT { output: { kind: "design" }, ... }
});

test("replayFixture record→replay round-trips an agent entry (record self-replay stays green)", async () => {
  cleanup();
  try {
    // record path (agent-unwrapped output + the ⓐ self-replay check, which must stay clean for a pure agent)
    const rec = await replayFixture(mkRuntime(), { dir: TMP }).replay("classifier", { message: "add /healthz" });
    expect(rec.output).toEqual({ kind: "design" });
    // replay path (agent-unwrapped output, 0 model calls)
    const rep = await replayFixture(mkRuntime(), { dir: TMP }).replay("classifier", { message: "add /healthz" });
    expect(rep.output).toEqual({ kind: "design" });
  } finally {
    cleanup();
  }
});
