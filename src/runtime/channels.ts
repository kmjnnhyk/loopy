import type { Channel } from "../index";
import type { Event } from "./events";

export type ChannelRecord = Record<string, Channel<any, any>>;
export type StateSnapshot = Record<string, unknown>;

export class UnknownChannelError extends Error {
  constructor(readonly key: string) {
    super(`StatePatched references unknown channel "${key}" — fail loud, never fail-open`);
    this.name = "UnknownChannelError";
  }
}

export function initialState(channels: ChannelRecord): StateSnapshot {
  const out: StateSnapshot = {};
  for (const [k, c] of Object.entries(channels)) out[k] = c.initial();
  return out;
}

export function applyPatch(
  channels: ChannelRecord,
  state: StateSnapshot,
  update: Readonly<Record<string, unknown>>,
): StateSnapshot {
  const next: StateSnapshot = { ...state };
  for (const key of Object.keys(update)) {
    const c = channels[key];
    if (!c) throw new UnknownChannelError(key);
    next[key] = c.reduce(next[key], update[key]);
  }
  return next;
}

export function foldScoped(
  channels: ChannelRecord,
  events: readonly Event[],
  scope: string,
  base?: StateSnapshot,
): StateSnapshot {
  let state = base ?? initialState(channels);
  for (const e of events) {
    if (e.type === "StatePatched" && e.node === scope) state = applyPatch(channels, state, e.update);
  }
  return state;
}

/** internal last-write channel with no initial value (auto input / handoff slots). */
export function rawChannel<T>(): Channel<T, T> {
  return {
    "~value": undefined as never,
    "~update": undefined as never,
    reduce: (_c: T, u: T): T => u,
    initial: (() => undefined) as never,
  };
}
