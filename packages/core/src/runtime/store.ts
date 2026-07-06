import type { Event, ThreadId } from "./events.ts";

export interface Snapshot {
  readonly status: "running" | "suspended" | "done" | "error";
  readonly cursor: number;
  readonly pending?: { readonly effectId: number; readonly resumeKey: string; readonly payload: unknown };
}

export interface Checkpointer {
  appendEvents(t: ThreadId, e: readonly Event[]): Promise<void>;
  save(t: ThreadId, s: Snapshot): Promise<void>;
  load(t: ThreadId): Promise<{ snapshot: Snapshot | null; events: readonly Event[] } | null>;
  readLog(t: ThreadId, fromSeq?: number): Promise<readonly Event[]>;
}

export function memoryStore(): Checkpointer {
  const threads = new Map<string, { events: Event[]; snapshot: Snapshot | null }>();
  const bucket = (t: ThreadId) => {
    let b = threads.get(t);
    if (!b) {
      b = { events: [], snapshot: null };
      threads.set(t, b);
    }
    return b;
  };
  return {
    async appendEvents(t: ThreadId, es: readonly Event[]): Promise<void> {
      const b = bucket(t);
      const seen = new Set(b.events.map((e) => e.seq));
      for (const e of es)
        if (!seen.has(e.seq)) {
          seen.add(e.seq);
          b.events.push(e);
        }
      b.events.sort((a, z) => a.seq - z.seq);
    },
    async save(t: ThreadId, s: Snapshot): Promise<void> {
      bucket(t).snapshot = s;
    },
    async load(t: ThreadId) {
      const b = threads.get(t);
      if (!b) return null;
      return { snapshot: b.snapshot, events: [...b.events] };
    },
    async readLog(t: ThreadId, fromSeq = 0): Promise<readonly Event[]> {
      return (threads.get(t)?.events ?? []).filter((e) => e.seq >= fromSeq);
    },
  };
}
