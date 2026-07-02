import type { Checkpointer } from "./store";
import { digest, posKey, serializeError } from "./events";
import type { Event, EventBody, RunId, SerializedError, ThreadId } from "./events";
import type { ModelClient, ModelRequest, ModelResponse } from "./model";

export interface EffectMemoEntry {
  readonly argsDigest: string;
  result?: { readonly ok: boolean; readonly value?: unknown; readonly error?: SerializedError };
}

export class Memo {
  private effects = new Map<string, EffectMemoEntry>();
  private byEffectId = new Map<number, EffectMemoEntry>();
  private resumes = new Map<string, unknown>();
  private started = new Set<string>();
  private ended = new Set<string>();

  static fromEvents(events: readonly Event[]): Memo {
    const m = new Memo();
    for (const e of events) {
      switch (e.type) {
        case "ToolCalled":
        case "ModelCallRequested": {
          const entry: EffectMemoEntry = { argsDigest: e.argsDigest };
          m.effects.set(e.posKey, entry);
          m.byEffectId.set(e.effectId, entry);
          break;
        }
        case "ToolReturned":
        case "ModelCallReturned": {
          const entry = m.byEffectId.get(e.effectId);
          if (entry) entry.result = { ok: e.ok, value: e.value, error: e.error };
          break;
        }
        case "NowRead":
        case "RandomRead":
          m.effects.set(e.posKey, { argsDigest: "", result: { ok: true, value: e.value } });
          break;
        case "SleepScheduled": {
          const entry: EffectMemoEntry = { argsDigest: "" };
          m.effects.set(e.posKey, entry);
          m.byEffectId.set(e.effectId, entry);
          break;
        }
        case "TimerFired": {
          const entry = m.byEffectId.get(e.effectId);
          if (entry) entry.result = { ok: true, value: undefined };
          break;
        }
        case "Resumed":
          m.resumes.set(e.resumeKey, e.value);
          break;
        case "StepStarted":
          m.started.add(e.node);
          break;
        case "StepEnded":
          m.ended.add(e.node);
          break;
        default:
          break;
      }
    }
    return m;
  }

  effect(pos: string): EffectMemoEntry | undefined {
    return this.effects.get(pos);
  }
  resume(key: string): { found: boolean; value?: unknown } {
    return this.resumes.has(key) ? { found: true, value: this.resumes.get(key) } : { found: false };
  }
  hasStepStarted(scope: string): boolean {
    return this.started.has(scope);
  }
  hasStepEnded(scope: string): boolean {
    return this.ended.has(scope);
  }
}

export class EventSession {
  private seq: number;
  private pendingWrites = new Map<number, { body: EventBody & { node: string }; resolve: (e: Event) => void; reject: (err: unknown) => void }>();
  private nextToFlush: number;
  private chain: Promise<void> = Promise.resolve();
  /** first store failure — once set, the session is dead and every write rejects with it */
  private failure: unknown = null;

  constructor(
    private store: Checkpointer,
    private tid: ThreadId,
    private rid: RunId,
    startSeq: number,
    private onEvent?: (e: Event) => void,
  ) {
    this.seq = startSeq;
    this.nextToFlush = startSeq;
  }

  reserve(): number {
    return this.seq++;
  }

  lastWritten(): number {
    return this.nextToFlush - 1;
  }

  write(body: EventBody & { node: string }): Promise<Event> {
    return this.writeReserved(this.reserve(), body);
  }

  /** persists in strict seq order regardless of arrival order of concurrent effects */
  writeReserved(seq: number, body: EventBody & { node: string }): Promise<Event> {
    return new Promise<Event>((resolve, reject) => {
      if (this.failure !== null) {
        reject(this.failure);
        return;
      }
      this.pendingWrites.set(seq, { body, resolve, reject });
      this.chain = this.chain.then(() => this.flush());
    });
  }

  private async flush(): Promise<void> {
    while (this.pendingWrites.has(this.nextToFlush)) {
      const { body, resolve, reject } = this.pendingWrites.get(this.nextToFlush)!;
      const event = { ...body, seq: this.nextToFlush, threadId: this.tid, runId: this.rid, ts: new Date().toISOString() } as Event;
      try {
        await this.store.appendEvents(this.tid, [event]);
      } catch (err) {
        // fail loud: first store failure kills the session — reject this write,
        // everything queued behind it, and (via `failure`) every future write.
        // the chain itself stays resolved so it never becomes an unhandled rejection.
        this.failure = err;
        this.pendingWrites.delete(this.nextToFlush);
        reject(err);
        for (const [seq, w] of this.pendingWrites) {
          this.pendingWrites.delete(seq);
          w.reject(err);
        }
        return;
      }
      this.pendingWrites.delete(this.nextToFlush);
      this.nextToFlush++;
      try {
        // synchronous listener, invoked inline on the flush path — a slow/heavy sink
        // blocks event persistence for every writer behind it; self-queue if needed.
        this.onEvent?.(event);
      } catch {
        // onEvent is a non-blocking sink — listener errors must never affect the run
      }
      resolve(event);
    }
  }
}

export class Suspend {
  readonly kind = "loopy.suspend";
  constructor(
    readonly effectId: number,
    readonly resumeKey: string,
    readonly payload: unknown,
  ) {}
}
export function isSuspend(x: unknown): x is Suspend {
  return typeof x === "object" && x !== null && (x as { kind?: unknown }).kind === "loopy.suspend";
}

export class ReplayDivergence extends Error {
  constructor(
    readonly pos: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`replay divergence at ${pos}: recorded args digest ${expected}, replay produced ${actual}`);
    this.name = "ReplayDivergence";
  }
}

export function deserializeError(e: SerializedError): Error {
  const err = new Error(e.message);
  err.name = e.name;
  return err;
}

export function pickDeps(deps: Record<string, unknown>, keys?: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys ?? []) out[k] = deps[k];
  return out;
}

export interface ToolLike {
  readonly name: string;
  readonly run: (input: never, ctx: never) => Promise<unknown>;
  readonly "~depKeys"?: readonly string[];
}

export interface RuntimeCtx {
  readonly deps: Record<string, unknown>;
  callModel(client: ModelClient, req: ModelRequest): Promise<ModelResponse>;
  callTool(tool: ToolLike, args: unknown): Promise<unknown>;
  interrupt<T>(payload: unknown): Promise<T>;
  sleep(ms: number): Promise<void>;
  now(): number;
  random(): number;
}

export function makeCtx(o: {
  scope: string;
  session: EventSession;
  memo: Memo;
  deps: Record<string, unknown>;
}): RuntimeCtx {
  let ordinal = 0;
  const nextPos = (op: string): string => posKey(o.scope, ordinal++, op);

  async function effect<T>(
    op: string,
    args: unknown,
    writeCalled: (effectId: number, pos: string, argsDigest: string) => Promise<unknown>,
    io: () => Promise<T>,
    returnedType: "ToolReturned" | "ModelCallReturned",
  ): Promise<T> {
    const pos = nextPos(op); // sync — source-order determinism
    const argsDigest = digest(args);
    const hit = o.memo.effect(pos);
    if (hit?.result) {
      if (hit.argsDigest !== argsDigest) throw new ReplayDivergence(pos, hit.argsDigest, argsDigest);
      if (hit.result.ok) return hit.result.value as T;
      throw deserializeError(hit.result.error!);
    }
    // miss OR dangling call (crash mid-effect / suspend mid-tool) → (re-)issue: at-least-once
    const effectId = o.session.reserve();
    await writeCalled(effectId, pos, argsDigest);
    try {
      const value = await io();
      await o.session.write({ type: returnedType, effectId, ok: true, value, node: o.scope });
      return value;
    } catch (err) {
      if (isSuspend(err)) throw err; // control signal — never record as failure
      try {
        await o.session.write({ type: returnedType, effectId, ok: false, error: serializeError(err), node: o.scope });
      } catch {
        // store failure while recording the failure: the session latch already fails
        // future writes loudly — surface the original domain error, not the store error
      }
      throw err;
    }
  }

  const ctx: RuntimeCtx = {
    deps: o.deps,

    callModel(client: ModelClient, req: ModelRequest): Promise<ModelResponse> {
      return effect(
        "model",
        req,
        (effectId, pos, argsDigest) =>
          o.session.writeReserved(effectId, { type: "ModelCallRequested", effectId, posKey: pos, argsDigest, req, node: o.scope }),
        () => client.complete(req),
        "ModelCallReturned",
      );
    },

    callTool(tool: ToolLike, args: unknown): Promise<unknown> {
      return effect(
        `tool:${tool.name}`,
        args,
        (effectId, pos, argsDigest) =>
          o.session.writeReserved(effectId, { type: "ToolCalled", effectId, posKey: pos, argsDigest, tool: tool.name, args, node: o.scope }),
        () => {
          const toolCtx = {
            deps: pickDeps(o.deps, tool["~depKeys"]),
            interrupt: <T>(payload: unknown): Promise<T> => ctx.interrupt<T>(payload),
          };
          return (tool.run as (i: unknown, c: unknown) => Promise<unknown>)(args, toolCtx);
        },
        "ToolReturned",
      );
    },

    async interrupt<T>(payload: unknown): Promise<T> {
      const pos = nextPos("interrupt");
      const resumed = o.memo.resume(pos); // resumeKey IS the position key — stable across re-entry
      if (resumed.found) return resumed.value as T;
      const effectId = o.session.reserve();
      await o.session.writeReserved(effectId, {
        type: "InterruptRaised", effectId, posKey: pos, payload, resumeKey: pos, node: o.scope,
      });
      throw new Suspend(effectId, pos, payload);
    },

    async sleep(ms: number): Promise<void> {
      const pos = nextPos("sleep");
      const hit = o.memo.effect(pos);
      if (hit?.result) return; // replay: instant
      const effectId = o.session.reserve();
      await o.session.writeReserved(effectId, { type: "SleepScheduled", effectId, posKey: pos, ms, node: o.scope });
      await new Promise<void>((r) => setTimeout(r, ms));
      await o.session.write({ type: "TimerFired", effectId, node: o.scope });
    },

    now(): number {
      const pos = nextPos("now");
      const hit = o.memo.effect(pos);
      if (hit?.result) return hit.result.value as number;
      const effectId = o.session.reserve();
      const value = Date.now();
      // sync signature can't await — the session latch surfaces the failure on the next awaited write
      o.session.writeReserved(effectId, { type: "NowRead", effectId, posKey: pos, value, node: o.scope }).catch(() => {});
      return value;
    },

    random(): number {
      const pos = nextPos("random");
      const hit = o.memo.effect(pos);
      if (hit?.result) return hit.result.value as number;
      const effectId = o.session.reserve();
      const value = Math.random();
      // sync signature can't await — the session latch surfaces the failure on the next awaited write
      o.session.writeReserved(effectId, { type: "RandomRead", effectId, posKey: pos, value, node: o.scope }).catch(() => {});
      return value;
    },
  };
  return ctx;
}
