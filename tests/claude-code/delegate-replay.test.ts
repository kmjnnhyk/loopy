import { expect, test } from "bun:test";
import { defineLoopy, io } from "@loopyjs/core";
import { delegatedAgent, type DelegateBackend } from "@loopyjs/claude-code";

function make(): { calls: () => number; rt: ReturnType<typeof defineLoopy> } {
  let n = 0;
  const stub: DelegateBackend = {
    run: async () => {
      n++;
      return '{"ok":true}';
    },
  };
  const d = delegatedAgent({
    name: "d", model: "sonnet", instructions: "irrelevant",
    input: io<{ q: number }>(), output: io<{ ok: boolean }>(),
    claude: { backend: stub },
  });
  const rt = defineLoopy({ agents: { d }, workflows: {}, deps: {} });
  return { calls: () => n, rt };
}

test("record: 위임 노드는 delegate:<name> ToolCalled 1쌍으로 기록, ModelCall 이벤트 0", async () => {
  const { calls, rt } = make();
  const events = await rt["~test"]!.record("d", { q: 1 });
  expect(calls()).toBe(1);
  const toolCalled = events.filter((e) => e.type === "ToolCalled");
  expect(toolCalled.length).toBe(1);
  expect((toolCalled[0] as { tool: string }).tool).toBe("delegate:d");
  expect(events.filter((e) => e.type === "ToolReturned").length).toBe(1);
  expect(events.filter((e) => e.type === "ModelCallRequested").length).toBe(0); // 내부 턴은 블랙박스
});

test("replay: 같은 input → 동일 output, backend/브리지 실행 0회", async () => {
  const { calls, rt } = make();
  const events = await rt["~test"]!.record("d", { q: 1 });
  expect(calls()).toBe(1);
  const res = await rt["~test"]!.replay("d", { q: 1 }, events);
  expect(res.divergence).toBeNull();
  expect(res.output).toEqual({ ok: true });
  expect(calls()).toBe(1); // ← replay가 claude를 다시 돌리지 않았다는 직접 증거
});

test("replay: input이 바뀌면 divergence (argsDigest 불일치)", async () => {
  const { rt } = make();
  const events = await rt["~test"]!.record("d", { q: 1 });
  const res = await rt["~test"]!.replay("d", { q: 2 }, events);
  expect(res.divergence).not.toBeNull();
});
