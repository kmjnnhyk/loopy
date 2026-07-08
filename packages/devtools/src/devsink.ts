import type { RuntimeEvent } from "@loopyjs/core";

export interface DevSink {
  ingest(e: RuntimeEvent): void;
  log(): readonly RuntimeEvent[];
  threadLog(threadId: string, fromSeq?: number): RuntimeEvent[];
  onBroadcast(fn: (e: RuntimeEvent) => void): () => void;
}

export function createDevSink(): DevSink {
  const events: RuntimeEvent[] = [];
  const subs = new Set<(e: RuntimeEvent) => void>();
  return {
    ingest(e) {
      events.push(e);
      for (const fn of subs) fn(e);
    },
    log() {
      return events;
    },
    threadLog(threadId, fromSeq = 0) {
      return events.filter((e) => e.threadId === threadId && e.seq >= fromSeq);
    },
    onBroadcast(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
  };
}
