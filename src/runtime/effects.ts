import type { Checkpointer } from "./store";
import type { Event, EventBody, RunId, SerializedError, ThreadId } from "./events";

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
        this.onEvent?.(event);
      } catch {
        // onEvent is a non-blocking sink — listener errors must never affect the run
      }
      resolve(event);
    }
  }
}
