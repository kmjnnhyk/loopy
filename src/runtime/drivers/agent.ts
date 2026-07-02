import { END, lastChannel, listChannel, type IO } from "../../index";
import { rawChannel, type ChannelRecord, type StateSnapshot } from "../channels";
import { isSuspend, type RuntimeCtx, type ToolLike } from "../effects";
import { stableStringify } from "../events";
import type { ModelMsg, ModelRequest, ModelResponse, ToolCallReq, ToolDecl } from "../model";
import { parseStructured, ParseError } from "../sap";
import { runGraph, type Driver, type KernelCtx, type RunnableNode } from "../scheduler";
import type { RtStep } from "./workflow";

export interface RtAgent {
  readonly name: string;
  readonly model: string;
  readonly instructions: string;
  readonly output: IO<any, any>;
  readonly tools: readonly RtStep[];
  readonly maxSteps?: number;
  readonly parseRetries?: number;
  readonly "~passToNames"?: readonly string[];
}

export class AgentMaxStepsError extends Error {
  constructor(
    readonly agent: string,
    readonly steps: number,
  ) {
    super(`agent "${agent}" exceeded maxSteps=${steps} without producing an answer`);
    this.name = "AgentMaxStepsError";
  }
}

const DEFAULT_MAX_STEPS = 12;
const DEFAULT_PARSE_RETRIES = 2;

function renderSystem(agent: RtAgent, passTo: readonly string[]): string {
  const base = `${agent.instructions}\n\nWhen you are done, respond with a single JSON object as the final answer.`;
  if (passTo.length === 0) return base;
  return `${base}\nTo hand control to a teammate, call one of: ${passTo.map((t) => `pass_to_${t}`).join(", ")}.`;
}

function manifest(agent: RtAgent, passTo: readonly string[]): readonly ToolDecl[] {
  const tools = agent.tools.map((t) => ({
    name: t.name,
    description: (t as { description?: string }).description ?? `sub-agent ${t.name}`,
  }));
  return [...tools, ...passTo.map((t) => ({ name: `pass_to_${t}`, description: `Hand off control to ${t}` }))];
}

interface ActResult {
  readonly results: readonly ModelMsg[];
  readonly handoff: string | null;
}

export function agentDriver(agent: RtAgent, opts: { passToTargets?: readonly string[] } = {}): Driver {
  const passTo = opts.passToTargets ?? [];
  const maxSteps = agent.maxSteps ?? DEFAULT_MAX_STEPS;
  const parseRetries = agent.parseRetries ?? DEFAULT_PARSE_RETRIES;
  const byName = new Map(agent.tools.map((t) => [t.name, t]));

  const channels: ChannelRecord = {
    messages: listChannel<ModelMsg>(),
    phase: lastChannel<"think" | "act" | "done">("think"),
    thinks: lastChannel<number>(0),
    parseFails: lastChannel<number>(0),
    pending: lastChannel<readonly ToolCallReq[]>([]),
    handoff: lastChannel<string | null>(null),
    output: rawChannel<unknown>(),
    lastError: lastChannel<string | null>(null),
  };

  const think: RunnableNode = {
    reads: (s: StateSnapshot) => s.messages,
    run: async (input: unknown, ctx: RuntimeCtx, k: KernelCtx) => {
      const client = k.models[agent.model];
      if (!client) throw new Error(`unknown model alias "${agent.model}" — register it in defineLoopy({ models })`);
      const req: ModelRequest = {
        model: agent.model,
        system: renderSystem(agent, passTo),
        messages: input as readonly ModelMsg[],
        tools: manifest(agent, passTo),
      };
      return ctx.callModel(client, req);
    },
  };

  const act: RunnableNode = {
    reads: (s: StateSnapshot) => s.pending,
    run: async (input: unknown, ctx: RuntimeCtx, k: KernelCtx, scope: string): Promise<ActResult> => {
      const calls = input as readonly ToolCallReq[];
      const results: ModelMsg[] = [];
      let handoff: string | null = null;
      for (let i = 0; i < calls.length; i++) {
        const call = calls[i]!;
        if (call.name.startsWith("pass_to_")) {
          const target = call.name.slice("pass_to_".length);
          results.push({ role: "tool", toolCallId: call.id, content: `handed off to ${target}` });
          handoff = target;
          break; // 완전 제어 이양 — 턴 종료
        }
        const t = byName.get(call.name);
        if (!t) {
          results.push({ role: "tool", toolCallId: call.id, content: `ERROR: unknown tool "${call.name}"` });
          continue;
        }
        if (t["~kind"] === "agent") {
          // sub-agent-as-tool: 중첩 그래프. 같은 act 배치 내 재호출 구분자 @i
          try {
            const env = (await runGraph(
              agentDriver(t as unknown as RtAgent), `${scope}/${call.name}@${i}`, k, call.args,
            )) as { output: unknown };
            results.push({ role: "tool", toolCallId: call.id, content: stableStringify(env.output) });
          } catch (err) {
            if (isSuspend(err)) throw err; // HITL — 커널로 전파 (sub-agent 안의 interrupt 포함)
            const msg = err instanceof Error ? err.message : String(err);
            results.push({ role: "tool", toolCallId: call.id, content: `ERROR ${call.name}: ${msg}` });
          }
          continue;
        }
        try {
          const value = await ctx.callTool(t as ToolLike, call.args);
          results.push({ role: "tool", toolCallId: call.id, content: stableStringify(value) });
        } catch (err) {
          if (isSuspend(err)) throw err; // HITL — 커널로 전파
          const msg = err instanceof Error ? err.message : String(err);
          results.push({ role: "tool", toolCallId: call.id, content: `ERROR ${call.name}: ${msg}` });
        }
      }
      return { results, handoff };
    },
  };

  return {
    channels,
    seed: (input: unknown) => ({
      messages: { role: "user", content: stableStringify(input) } satisfies ModelMsg,
    }),
    next: (s: StateSnapshot) => (s.phase === "done" ? END : (s.phase as "think" | "act")),
    onSelected: () => null,
    node: (name: string) => (name === "think" ? think : act),
    updatesFor: (name: string, output: unknown, s: StateSnapshot) => {
      if (name === "act") {
        const r = output as ActResult;
        return {
          messages: r.results,
          pending: [] as readonly ToolCallReq[],
          ...(r.handoff ? { handoff: r.handoff, phase: "done" as const } : { phase: "think" as const }),
        };
      }
      // think — 분기·파싱은 순수 계산 (replay 시 동일 재계산)
      const res = output as ModelResponse;
      const thinks = (s.thinks as number) + 1;
      if (res.toolCalls && res.toolCalls.length > 0) {
        const assistant: ModelMsg = { role: "assistant", content: res.text ?? "", toolCalls: res.toolCalls };
        return { messages: assistant, pending: res.toolCalls, phase: "act" as const, thinks };
      }
      try {
        const parsed = parseStructured(agent.output, res.text ?? "");
        return { output: parsed, phase: "done" as const, thinks };
      } catch (err) {
        if (!(err instanceof ParseError)) throw err;
        const fails = (s.parseFails as number) + 1;
        if (fails > parseRetries) throw err; // fail loud
        const feedback: ModelMsg = {
          role: "user",
          content: `ParseError: ${err.message}. Respond again with ONLY a valid JSON object.`,
        };
        return {
          messages: [{ role: "assistant", content: res.text ?? "" }, feedback] as readonly ModelMsg[],
          parseFails: fails, lastError: err.message, phase: "think" as const, thinks,
        };
      }
    },
    output: (s: StateSnapshot) => ({ output: s.output, handoff: s.handoff, messages: s.messages }),
    guard: (_ticks: number, s: StateSnapshot) => {
      if (s.phase === "think" && (s.thinks as number) >= maxSteps) throw new AgentMaxStepsError(agent.name, maxSteps);
    },
  };
}

/** workflow 노드용 래퍼: 중첩 그래프 실행 후 envelope.output만 반환. */
export function agentNode(agent: RtAgent): RunnableNode {
  return {
    reads: (s: StateSnapshot) => s, // 외부 바인딩의 reads가 이미 적용된 input이 run으로 옴
    run: async (input: unknown, _ctx: RuntimeCtx, k: KernelCtx, scope: string) => {
      const env = (await runGraph(agentDriver(agent), scope, k, input)) as { output: unknown };
      return env.output;
    },
  };
}
