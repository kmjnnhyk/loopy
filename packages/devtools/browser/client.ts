import type { RuntimeEvent } from "@loopyjs/core";

export interface DevClient {
  events(): readonly RuntimeEvent[];
  onChange(fn: () => void): void;
  run(name: string, input: unknown): Promise<{ threadId: string }>;
  entries(): Promise<{ name: string; kind: string }[]>;
}

export function connect(): DevClient {
  const events: RuntimeEvent[] = [];
  const listeners = new Set<() => void>();
  const notify = () => { for (const l of listeners) l(); };
  const append = (e: RuntimeEvent) => {
    if (events.length && e.seq <= events[events.length - 1]!.seq) return; // dedupe by monotone seq
    events.push(e);
    notify();
  };

  let ws: WebSocket | null = null;
  const open = () => {
    ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onmessage = (m) => append(JSON.parse(String(m.data)) as RuntimeEvent);
    ws.onclose = () => setTimeout(open, 500); // reconnect (Task 8/spec §5: then REST gap catch-up)
  };
  open();

  return {
    events: () => events,
    onChange: (fn) => { listeners.add(fn); },
    async run(name, input) {
      return (await fetch("/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, input }) })).json();
    },
    async entries() {
      return (await fetch("/api/entries")).json();
    },
  };
}
