import { expect, test } from "bun:test";
import { defineLoopy, stubModel, RunSuspended, memoryStore } from "@loopyjs/core";
import { jiraFlow } from "../../examples/workflows";
import { classifier, sufficiency, fileAnalyzer, verifier, codeGen } from "../../examples/agents";
import { stubDeps } from "./designflow.test";

const answer = (o: unknown) => ({ text: JSON.stringify(o), stopReason: "end_turn" });

test("A2 jiraFlow: interrupt 2회 → resume 2회 → 완주 (같은 store, 새 rt 인스턴스)", async () => {
  const store = memoryStore();
  const haiku = stubModel([answer({ verdict: "insufficient", missing: ["repro"] })]);
  const rt = defineLoopy({
    agents: { classifier, sufficiency, fileAnalyzer, verifier, codeGen },
    workflows: { jiraFlow }, deps: stubDeps, models: { haiku, sonnet: stubModel([]) }, store,
  });

  // interrupt #1: needsInput (clarification)
  let payload1: unknown;
  try {
    await rt.run("jiraFlow", { issueKey: "PROJ-142" }, { threadId: "a2" });
    throw new Error("unreachable — expected RunSuspended");
  } catch (e) {
    if (!(e instanceof RunSuspended)) throw e;
    payload1 = e.payload;
  }
  expect(payload1).toEqual({ kind: "clarify" });

  // resume #1 → interrupt #2: awaitBase — 새 rt 인스턴스(같은 store)로 프로세스 경계 동형 재현
  const rt2 = defineLoopy({
    agents: { classifier, sufficiency, fileAnalyzer, verifier, codeGen },
    workflows: { jiraFlow }, deps: stubDeps, models: { haiku: stubModel([]), sonnet: stubModel([]) }, store,
  });
  try {
    await rt2.resume("a2", { answers: ["steps to repro"], by: "kim" });
    throw new Error("unreachable — expected 2nd RunSuspended");
  } catch (e) {
    if (!(e instanceof RunSuspended)) throw e;
    expect(e.payload).toEqual({ kind: "pick-base" });
  }

  // resume #2 → 완주. sufficiency 모델은 재호출 0 (memo) — 빈 stub이어도 통과해야 함
  const out = await rt2.resume("a2", { baseBranch: "main", confirmedBy: "kim" });
  expect(out).toEqual({ prUrl: "https://example/pull/1" });
  expect(haiku.calls.length).toBe(1); // 최초 1회만
});
