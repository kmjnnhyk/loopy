import { END, lastChannel, listChannel, type Msg } from "../../index.ts";
import type { ChannelRecord, StateSnapshot } from "../channels.ts";
import { stableStringify } from "../events.ts";
import { runGraph, type Driver, type KernelCtx, type RunnableNode } from "../scheduler.ts";
import type { RuntimeCtx } from "../effects.ts";
import { agentDriver, type RtAgent } from "./agent.ts";

export class TeamMaxTurnsError extends Error {
  constructor(
    readonly team: string,
    readonly turns: number,
  ) {
    super(`team "${team}" exceeded maxTurns=${turns} — no-progress loop backstop`);
    this.name = "TeamMaxTurnsError";
  }
}

const DEFAULT_MAX_TURNS = 16;

export interface RtTeam {
  readonly name: string;
  readonly state: ChannelRecord;
  readonly "~team": {
    readonly entry: string;
    readonly agents: Record<string, RtAgent & { readonly "~passToNames"?: readonly string[] }>;
    readonly maxTurns?: number;
    readonly writes: Record<string, string>;
    readonly router: ((s: unknown) => string) | null;
  };
}

interface Envelope {
  readonly output: unknown;
  readonly handoff: string | null;
  readonly messages: unknown;
}

/** 정규 순수 렌더러 — 이 문자열이 모델 입력(=argsDigest 표면)이 된다. 변경 = 의도된 divergence. */
export function renderTeamView(name: string, state: StateSnapshot, domainKeys: readonly string[]): string {
  const domain: Record<string, unknown> = {};
  for (const k of domainKeys) domain[k] = state[k];
  const transcript = (state.transcript as readonly Msg[]).map((m) => `[${m.agent ?? m.role}] ${m.content}`).join("\n");
  return `Shared state:\n${stableStringify(domain)}\n\nTranscript:\n${transcript || "(empty)"}\n\nYou are "${name}". Continue the team's work.`;
}

export function teamDriver(t: RtTeam): Driver {
  const cfg = t["~team"];
  // fail fast at driver-build time — a router that never routes to the delegated
  // agent would otherwise hide this indefinitely (agentNodeOf only runs per-visit).
  for (const a of Object.values(cfg.agents)) {
    if ((a as { "~driverFactory"?: unknown })["~driverFactory"] !== undefined) {
      throw new Error(
        `team: agent "${a.name}" has a custom driver factory — delegated agents cannot join teams (v1; passTo/handoff is a loopy-loop concept)`,
      );
    }
  }
  const maxTurns = cfg.maxTurns ?? DEFAULT_MAX_TURNS;
  const domainKeys = Object.keys(t.state);
  const inputKeys = domainKeys.filter((k) => (t.state[k] as { "~input"?: boolean })["~input"] === true);
  const channels: ChannelRecord = {
    ...t.state,
    transcript: listChannel<Msg>(),
    nextAgent: lastChannel<string | null>(null),
  };
  const defaultRouter = (s: StateSnapshot): string | typeof END => (s.nextAgent as string | null) ?? END;

  const agentNodeOf = (name: string): RunnableNode => {
    const a = cfg.agents[name];
    if (!a) throw new Error(`team "${t.name}": unknown agent "${name}"`);
    return {
      reads: (s: StateSnapshot) => renderTeamView(name, s, domainKeys),
      run: async (input: unknown, _ctx: RuntimeCtx, k: KernelCtx, scope: string) =>
        runGraph(agentDriver(a, { passToTargets: a["~passToNames"] ?? [] }), scope, k, { view: input }),
    };
  };

  return {
    channels,
    seed: (input: unknown) => {
      const seed: Record<string, unknown> = { nextAgent: cfg.entry }; // entry 부트스트랩
      const inp = (input ?? {}) as Record<string, unknown>;
      for (const k of inputKeys) seed[k] = inp[k];
      return seed;
    },
    next: (state: StateSnapshot) =>
      (cfg.router ? (cfg.router(state) as string | typeof END) : defaultRouter(state)),
    onSelected: (_node: string, state: StateSnapshot) =>
      state.nextAgent !== null ? { nextAgent: null } : null, // consume-on-read
    node: agentNodeOf,
    updatesFor: (name: string, output: unknown, _state: StateSnapshot) => {
      const env = output as Envelope;
      const updates: Record<string, unknown> = {
        transcript: {
          role: "assistant",
          agent: name,
          content: env.output !== undefined && env.output !== null
            ? stableStringify(env.output)
            : env.handoff
              ? `→ pass_to_${env.handoff}`
              : "(no output)",
        } satisfies Msg,
      };
      if (env.handoff) updates.nextAgent = env.handoff;
      const ch = cfg.writes[name];
      if (ch && env.output !== undefined && env.output !== null) updates[ch] = env.output;
      return updates;
    },
    output: (state: StateSnapshot) => {
      const mapped = Object.values(cfg.writes);
      if (mapped.length === 1) return state[mapped[0]!];
      const snapshot: Record<string, unknown> = {};
      for (const k of [...domainKeys, "transcript"]) snapshot[k] = state[k];
      return snapshot; // 0/다수 매핑 → silent-pick 금지, 전체 스냅샷
    },
    guard: (completedTicks: number) => {
      if (completedTicks >= maxTurns) throw new TeamMaxTurnsError(t.name, maxTurns);
    },
  };
}
