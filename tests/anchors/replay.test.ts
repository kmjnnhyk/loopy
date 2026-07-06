import { expect, test } from "bun:test";
import { defineLoopy, stubModel, memoryStore, END, verifyReplay, RunSuspended } from "@loopyjs/core";
import { workflowDriver, agentNode, runThread, type Driver, type RunnableNode, rawChannel, threadId } from "@loopyjs/core/internal";
import { designFlow } from "../../examples/workflows";
import { classifier, sufficiency, fileAnalyzer, verifier, codeGen } from "../../examples/agents";
import { stubDeps } from "./designflow.test";

const answer = (o: unknown) => ({ text: JSON.stringify(o), stopReason: "end_turn" });

test("A1 replay: verifyReplay green + 기록된 모델콜 수 == 실제 stub 호출 수", async () => {
  const store = memoryStore();
  const haiku = stubModel([answer({ paths: ["src/a.ts"] }), answer({ passed: true, notes: "ok" })]);
  const sonnet = stubModel([answer({ applied: ["src/a.ts"], failed: [] })]);
  const rt = defineLoopy({
    agents: { classifier, sufficiency, fileAnalyzer, verifier, codeGen },
    workflows: { designFlow }, deps: stubDeps, models: { haiku, sonnet }, store,
  });
  const out = await rt.run("designFlow", { message: "add /healthz" }, { threadId: "r1" });

  const { output } = await verifyReplay(store, "r1", workflowDriver(designFlow as never, agentNode as never));
  expect(output).toEqual(out); // 재fold 결과 == 기록된 RunEnded.output

  const log = await store.readLog(threadId("r1"));
  const modelCalls = log.filter((e) => e.type === "ModelCallRequested").length;
  expect(modelCalls).toBe(haiku.calls.length + sonnet.calls.length); // 기록과 실호출 1:1 — 재생 시 LLM 0의 근거
});

test("verifyReplay: RunEnded 없는 스레드 → loud error", async () => {
  const store = memoryStore();
  await expect(verifyReplay(store, "nope", workflowDriver(designFlow as never, agentNode as never)))
    .rejects.toThrow(/no RunEnded|not completed|no events/);
});

test("verifyReplay: 삼켜진 Suspend(미해소 InterruptRaised + RunEnded) → unresolved interrupt", async () => {
  // scheduler.test.ts의 swallowed-Suspend 패턴 미러 — 작성자 임퓨리티: 노드가
  // ctx.interrupt의 Suspend를 catch로 삼켜 완주 → 로그에 미해소 InterruptRaised 잔존.
  const swallower: RunnableNode = {
    reads: () => null,
    run: async (_i, ctx) => {
      try {
        await ctx.interrupt({ ask: "x" });
      } catch {
        /* swallowed */
      }
      return { done: false };
    },
  };
  const driver: Driver = {
    channels: { input: rawChannel(), only: rawChannel() },
    seed: (input) => ({ input }),
    next: (_s, last) => (last === null ? "only" : END),
    onSelected: () => null,
    node: () => swallower,
    updatesFor: (name, output) => ({ [name]: output }),
    output: (s) => s.only,
    guard: () => {},
  };
  const store = memoryStore();
  const out = await runThread({ driver, store, threadId: "sw1", entry: "toy", input: { n: 1 } });
  expect(out).toEqual({ done: false }); // 스레드는 "완주"했지만
  await expect(verifyReplay(store, "sw1", driver)).rejects.toThrow(/unresolved interrupt/);
});

test("verifyReplay: 정상 HITL 완주(도구 내 interrupt→resume) → green", async () => {
  // suspend-mid-tool은 설계상 ToolReturned 없는 ToolCalled를 남기고, resume 때 같은
  // posKey·새 effectId로 재발행됨 — verifyReplay가 이걸 dangling으로 오탐하면 안 된다.
  const gate = {
    name: "gate",
    run: async (_i: unknown, tctx: { interrupt<T>(p: unknown): Promise<T> }) => {
      const ok = await tctx.interrupt<{ approved: boolean }>({ ask: "ok?" });
      return { approved: ok.approved };
    },
  };
  const node: RunnableNode = {
    reads: () => null,
    run: async (_i, ctx) => ctx.callTool(gate as never, { q: 1 }),
  };
  const driver: Driver = {
    channels: { input: rawChannel(), only: rawChannel() },
    seed: (input) => ({ input }),
    next: (_s, last) => (last === null ? "only" : END),
    onSelected: () => null,
    node: () => node,
    updatesFor: (name, output) => ({ [name]: output }),
    output: (s) => s.only,
    guard: () => {},
  };
  const store = memoryStore();
  await expect(runThread({ driver, store, threadId: "hitl1", entry: "toy", input: { n: 1 } }))
    .rejects.toThrow(RunSuspended);
  const out = await runThread({ driver, store, threadId: "hitl1", entry: "toy", resume: { value: { approved: true } } });
  expect(out).toEqual({ approved: true });

  const log = await store.readLog(threadId("hitl1"));
  // 오탐 조건이 진짜 재현됐음을 증명: dangling-by-design 원본 + 재발행 = ToolCalled 2개
  expect(log.filter((e) => e.type === "ToolCalled").length).toBe(2);

  const { output } = await verifyReplay(store, "hitl1", driver); // throw하지 않고 resolve
  expect(output).toEqual({ approved: true });
});
