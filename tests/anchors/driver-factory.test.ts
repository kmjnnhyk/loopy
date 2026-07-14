import { expect, test } from "bun:test";
import { agent, defineLoopy, io, memoryStore, stubModel, team, inputChannel, END } from "@loopyjs/core";
import { agentNode, runThread, rawChannel, type Driver, type RunnableNode } from "@loopyjs/core/internal";

// lastChannel은 "."에서 export — Driver 채널 구성에 사용
import { lastChannel } from "@loopyjs/core";

/** 커스텀 driver: 모델 없이 {ok:true, got:<input>} 반환하는 1-노드 그래프 (delegation driver의 축소 모형) */
const toyDriver: Driver = {
  channels: { input: rawChannel<unknown>(), output: rawChannel<unknown>(), phase: lastChannel<"run" | "done">("run") },
  seed: (input) => ({ input }),
  next: (s) => (s.phase === "done" ? END : "run"),
  onSelected: () => null,
  node: (): RunnableNode => ({
    reads: (s) => s.input,
    run: async (input) => ({ ok: true, got: input }),
  }),
  updatesFor: (_n, output) => ({ output, phase: "done" }),
  output: (s) => ({ output: s.output }),
  guard: () => {},
};

/** agent() authoring 객체 + ~driverFactory — delegatedAgent()가 만들 모양의 최소형 */
const toy = {
  ...agent({
    name: "toy", model: "unused-alias", instructions: "n/a",
    input: io<{ n: number }>(), output: io<{ ok: boolean }>(),
  }),
  "~driverFactory": (): Driver => toyDriver,
};

test("① top-level: rt.run이 ~driverFactory의 driver를 사용 (모델 레지스트리 불필요)", async () => {
  const rt = defineLoopy({ agents: { toy }, workflows: {}, deps: {} });
  // agentDriver였다면 'unknown model alias "unused-alias"'로 throw했을 것
  const out = await rt.run("toy", { n: 1 });
  expect(out).toEqual({ ok: true, got: { n: 1 } });
});

test("② workflow embed 경로: agentNode가 ~driverFactory를 존중", async () => {
  const node = agentNode(toy as never);
  const outer: Driver = {
    channels: { input: rawChannel<unknown>(), only: rawChannel<unknown>() },
    seed: (input) => ({ input }),
    next: (_s, last) => (last === null ? "only" : END),
    onSelected: () => null,
    node: () => node,
    updatesFor: (_n, o) => ({ only: o }),
    output: (s) => s.only,
    guard: () => {},
  };
  const out = await runThread({ driver: outer, store: memoryStore(), threadId: "df1", entry: "toy", input: { n: 2 } });
  // agentNode는 env.output만 벗겨 반환 — reads:(s)=>s라 inner input은 스냅샷 전체
  expect((out as { ok: boolean }).ok).toBe(true);
});

test("③ sub-agent-as-tool 경로: 일반 agent의 tools 안에서 ~driverFactory 존중", async () => {
  const outer = agent({
    name: "outer", model: "m", instructions: "call the tool",
    input: io<{ q: string }>(), output: io<{ echo: unknown }>(),
    tools: [toy],
  });
  const m = stubModel([
    { toolCalls: [{ id: "1", name: "toy", args: { n: 3 } }], stopReason: "tool_use" },
    (req) => ({ text: JSON.stringify({ echo: JSON.parse(req.messages.at(-1)!.content) }), stopReason: "end_turn" }),
  ]);
  const rt = defineLoopy({ agents: { outer }, workflows: {}, deps: {}, models: { m } });
  const out = await rt.run("outer", { q: "x" });
  // tool 결과 = stableStringify(toyDriver의 output) → 두 번째 stub이 그대로 echo
  expect(out).toEqual({ echo: { ok: true, got: { n: 3 } } });
});

test("④ team: delegated agent는 명시적 에러", async () => {
  const tg = team({
    name: "tg", entry: "toy",
    state: { seed: inputChannel<number>() },
    agents: { toy }, maxTurns: 2,
  }).router(() => END);
  const rt = defineLoopy({ agents: {}, workflows: {}, teams: { tg }, deps: {} as never, models: {} });
  await expect(rt.run("tg", 1 as never)).rejects.toThrow(/delegated agents cannot join teams/);
});
