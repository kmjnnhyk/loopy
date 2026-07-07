import { expect, test } from "bun:test";
import { defineLoopy, stubModel, RunSuspended, memoryStore, TeamMaxTurnsError } from "@loopyjs/core";
import { threadId } from "@loopyjs/core/internal";
import { prTriage } from "../../examples/team";
import type { GitRepo } from "../../examples/deps";

const repo: GitRepo = { read: async () => "", write: async () => {}, find: async () => [] };
const answer = (o: unknown) => ({ text: JSON.stringify(o), stopReason: "end_turn" });
const passTo = (t: string, id = "p1") => ({ toolCalls: [{ id, name: `pass_to_${t}`, args: {} }], stopReason: "tool_use" });

test("A3 prTriage: passTo 핸드오프 → HITL → 반려 재진입(epoch) → 승인 END", async () => {
  const store = memoryStore();
  const issue = { id: 7, body: "crash on save" };
  // 턴 순서: triage → bugFixer#1 → reviewer#1(requestApproval → interrupt)
  const opus1 = stubModel([
    passTo("bugFixer"),
    passTo("reviewer"),
    { toolCalls: [{ id: "r1", name: "requestApproval", args: { summary: "ship?" } }], stopReason: "tool_use" },
  ]);
  const rt = defineLoopy({
    agents: {}, workflows: {}, teams: { prTriage }, deps: { repo }, models: { opus: opus1 }, store,
  });
  let suspended = false;
  try {
    await rt.run("prTriage", { issue }, { threadId: "a3" });
  } catch (e) {
    if (!(e instanceof RunSuspended)) throw e;
    suspended = true;
    expect(e.payload).toEqual({ ask: "ship?" });
  }
  expect(suspended).toBe(true);
  expect(opus1.calls.length).toBe(3);

  // resume(거절) → reviewer 반려 → bugFixer#2 재진입 → reviewer#2 승인 → END
  const opus2 = stubModel([
    answer({ approved: false, assignee: "bugFixer", notes: "needs a test" }), // reviewer#1 think2
    passTo("reviewer"),                                                        // bugFixer#2
    answer({ approved: true, notes: "lgtm" }),                                 // reviewer#2
  ]);
  const rt2 = defineLoopy({
    agents: {}, workflows: {}, teams: { prTriage }, deps: { repo }, models: { opus: opus2 }, store,
  });
  const out = await rt2.resume("a3", { approved: false });
  expect(out).toEqual({ approved: true, notes: "lgtm" }); // .writes 단일 매핑 → review 채널 투영
  expect(opus2.calls.length).toBe(3); // 이전 3콜은 전부 memo 재생 (LLM 0)

  const path = (await store.readLog(threadId("a3")))
    .filter((e) => e.type === "StepStarted" && !e.node.includes("/"))
    .map((e) => e.node);
  expect(path).toEqual(["triage#1", "bugFixer#1", "reviewer#1", "bugFixer#2", "reviewer#2"]); // 재진입 epoch
});

test("maxTurns 초과 → TeamMaxTurnsError (정상 반환 아님)", async () => {
  const { team, agent, io, inputChannel } = await import("@loopyjs/core");
  const a = agent({ name: "a", model: "opus", instructions: "x", input: io<{ seed: number }>(), output: io<{ ok: boolean }>() });
  const ping = team({ name: "ping", entry: "a", state: { seed: inputChannel<number>() }, agents: { a }, maxTurns: 3 })
    .router(() => "a"); // 방금 끝낸 에이전트 재반환 — 무진전 루프
  const opus = stubModel(Array.from({ length: 10 }, () => answer({ ok: true })));
  const rt = defineLoopy({ agents: {}, workflows: {}, teams: { ping }, deps: {} as never, models: { opus } });
  await expect(rt.run("ping", { seed: 1 }, { threadId: "mt" })).rejects.toThrow(TeamMaxTurnsError);
});
