import { describe, expect, test } from "bun:test";
import { agent, tool, io } from "@loopyjs/core";
import { agentDriver, AgentMaxStepsError } from "../../src/runtime/drivers/agent";
import { runThread } from "../../src/runtime/scheduler";
import { memoryStore } from "../../src/runtime/store";
import { threadId } from "../../src/runtime/events";
import { stubModel, type ModelResponse } from "../../src/runtime/model";
import { ParseError } from "../../src/runtime/sap";
import { ReplayDivergence } from "../../src/runtime/effects";

const answer = (obj: unknown): ModelResponse => ({ text: JSON.stringify(obj), stopReason: "end_turn" });
const callTools = (...calls: Array<{ id: string; name: string; args: unknown }>): ModelResponse => ({
  toolCalls: calls, stopReason: "tool_use",
});
let echoRuns = 0;
const echo = tool({
  name: "echo", description: "echo",
  input: io<{ x: number }>(), output: io<{ x: number }>(),
  run: async (i) => ((echoRuns++), { x: i.x }),
});
const mkAgent = (over: Partial<Parameters<typeof agent>[0]> = {}) =>
  agent({
    name: "a1", model: "stub", instructions: "answer as JSON {done:boolean}",
    input: io<{ q: string }>(), output: io<{ done: boolean }>(),
    tools: [echo], ...over,
  } as never);
const run = (fixtures: ModelResponse[] | ((r: never) => ModelResponse)[], agentDef = mkAgent(), tid = "a") => {
  const m = stubModel(fixtures as never);
  return {
    m,
    p: runThread({
      driver: agentDriver(agentDef as never), store: memoryStore(), threadId: tid,
      entry: agentDef.name, input: { q: "hi" }, models: { stub: m },
    }),
  };
};

describe("agentDriver", () => {
  test("direct structured answer → envelope.output, 1 model call", async () => {
    const { m, p } = run([answer({ done: true })]);
    const env = (await p) as { output: unknown; handoff: string | null };
    expect(env.output).toEqual({ done: true });
    expect(env.handoff).toBeNull();
    expect(m.calls.length).toBe(1);
  });

  test("tool round-trip: act executes tool, result fed back, then answer", async () => {
    echoRuns = 0;
    const { m, p } = run([
      callTools({ id: "c1", name: "echo", args: { x: 5 } }),
      (req: { messages: Array<{ role: string; content: string }> }) => {
        const last = req.messages[req.messages.length - 1]!;
        if (last.role !== "tool" || !last.content.includes('"x":5')) throw new Error("tool result not fed back");
        return answer({ done: true });
      },
    ] as never);
    expect(((await p) as { output: unknown }).output).toEqual({ done: true });
    expect(echoRuns).toBe(1);
    expect(m.calls.length).toBe(2);
  });

  test("parse retry: garbage then valid → succeeds with feedback message", async () => {
    const { m, p } = run([
      { text: "not json at all", stopReason: "end_turn" },
      (req: { messages: Array<{ content: string }> }) => {
        const last = req.messages[req.messages.length - 1]!;
        if (!last.content.includes("ParseError")) throw new Error("no parse feedback");
        return answer({ done: true });
      },
    ] as never);
    expect(((await p) as { output: unknown }).output).toEqual({ done: true });
    expect(m.calls.length).toBe(2);
  });

  test("parse fail beyond parseRetries → ParseError", async () => {
    const { p } = run([{ text: "junk", stopReason: "end_turn" }], mkAgent({ parseRetries: 0 } as never));
    await expect(p).rejects.toThrow(ParseError);
  });

  test("maxSteps exceeded → AgentMaxStepsError", async () => {
    const loop = callTools({ id: "c", name: "echo", args: { x: 1 } });
    const { p } = run([loop, loop, loop, loop], mkAgent({ maxSteps: 2 } as never));
    await expect(p).rejects.toThrow(AgentMaxStepsError);
  });

  test("tool error → recorded + fed back as ERROR tool result, loop continues", async () => {
    const bad = tool({
      name: "bad", description: "always fails",
      input: io<{ x: number }>(), output: io<{ x: number }>(),
      run: async () => { throw new RangeError("no such file"); },
    });
    const { p } = run(
      [
        callTools({ id: "c1", name: "bad", args: { x: 1 } }),
        (req: { messages: Array<{ role: string; content: string }> }) => {
          const last = req.messages[req.messages.length - 1]!;
          if (!(last.role === "tool" && last.content.includes("ERROR") && last.content.includes("no such file")))
            throw new Error("error not fed back");
          return answer({ done: false });
        },
      ] as never,
      mkAgent({ tools: [bad] } as never),
    );
    expect(((await p) as { output: unknown }).output).toEqual({ done: false });
  });

  test("sub-agent-as-tool: nested graph under scope, parent completes", async () => {
    const sub = agent({
      name: "sub", model: "stub", instructions: "return {v:number}",
      input: io<{ goal: string }>(), output: io<{ v: number }>(),
    });
    const parent = mkAgent({ tools: [sub] } as never);
    const m = stubModel([
      callTools({ id: "c1", name: "sub", args: { goal: "g" } }), // parent think → call sub
      answer({ v: 42 }),                                          // sub think → answer
      answer({ done: true }),                                     // parent think #2
    ]);
    const store = memoryStore();
    const env = (await runThread({
      driver: agentDriver(parent as never), store, threadId: "nest",
      entry: "a1", input: { q: "hi" }, models: { stub: m },
    })) as { output: unknown };
    expect(env.output).toEqual({ done: true });
    const nested = (await store.readLog(threadId("nest"))).filter((e) => e.node.includes("/sub@0/"));
    expect(nested.length).toBeGreaterThan(0); // sub의 think가 하위 scope에 기록됨
  });

  test("failing sub-agent feeds back as ERROR tool result, parent continues", async () => {
    const sub = agent({
      name: "sub", model: "stub", instructions: "return {v:number}",
      input: io<{ goal: string }>(), output: io<{ v: number }>(),
      parseRetries: 0,
    } as never);
    const parent = mkAgent({ tools: [sub] } as never);
    const m = stubModel([
      callTools({ id: "c1", name: "sub", args: { goal: "g" } }), // parent think → call sub
      { text: "not json at all", stopReason: "end_turn" },       // sub think → ParseError (parseRetries 0)
      (req: { messages: Array<{ role: string; content: string }> }) => {
        const last = req.messages[req.messages.length - 1]!;
        if (!(last.role === "tool" && last.content.includes("ERROR") && last.content.includes("sub")))
          throw new Error("sub-agent failure not fed back");
        return answer({ done: true });                           // parent think #2
      },
    ] as never);
    const env = (await runThread({
      driver: agentDriver(parent as never), store: memoryStore(), threadId: "subfail",
      entry: "a1", input: { q: "hi" }, models: { stub: m },
    })) as { output: unknown };
    expect(env.output).toEqual({ done: true }); // 부모 run이 완주함
  });

  // I-1 regression: infra/control errors must fail loud through act's catch, not
  // get swallowed into an ERROR tool_result feedback message. ReplayDivergence is
  // the determinism-enforcement signal — feeding it back as a normal tool error
  // would let a replay divergence silently continue instead of aborting the run.
  test("tool ReplayDivergence fails loud, not fed back as ERROR tool result", async () => {
    const divergent = tool({
      name: "divergent", description: "always raises a replay divergence",
      input: io<{ x: number }>(), output: io<{ x: number }>(),
      run: async () => { throw new ReplayDivergence("p", "a", "b"); },
    });
    const { p } = run(
      [callTools({ id: "c1", name: "divergent", args: { x: 1 } })],
      mkAgent({ tools: [divergent] } as never),
    );
    await expect(p).rejects.toThrow(ReplayDivergence);
  });

  // Opposite polarity of "failing sub-agent feeds back as ERROR tool result" above:
  // that test uses a sub-agent ParseError (tool-domain — not on the allowlist, so it
  // still feeds back). Here the sub-agent exceeds its own maxSteps, which is a
  // control/infra signal (allowlisted) — the parent run must reject, not continue.
  test("sub-agent AgentMaxStepsError fails loud, parent rejects (contrast with ParseError case above)", async () => {
    const sub = agent({
      name: "sub", model: "stub", instructions: "call tools forever",
      input: io<{ goal: string }>(), output: io<{ v: number }>(),
      tools: [echo],
      maxSteps: 1,
    } as never);
    const parent = mkAgent({ tools: [sub] } as never);
    const { p } = run(
      [
        callTools({ id: "c1", name: "sub", args: { goal: "g" } }), // parent think → call sub
        callTools({ id: "s1", name: "echo", args: { x: 1 } }),     // sub think #1 → tool call (thinks=1 == maxSteps)
      ] as never,
      parent,
      "submaxsteps",
    );
    await expect(p).rejects.toThrow(AgentMaxStepsError);
  });
});
