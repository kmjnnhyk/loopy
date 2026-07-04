import { Database } from "bun:sqlite";
import type { Event, ThreadId } from "./events";
import type { Checkpointer, Snapshot } from "./store";

export function sqliteStore(path: string): Checkpointer {
  const db = new Database(path, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run(
    "CREATE TABLE IF NOT EXISTS loopy_events (thread_id TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (thread_id, seq))",
  );
  db.run("CREATE TABLE IF NOT EXISTS loopy_snapshots (thread_id TEXT PRIMARY KEY, data TEXT NOT NULL)");
  const insert = db.prepare("INSERT OR IGNORE INTO loopy_events (thread_id, seq, data) VALUES (?1, ?2, ?3)");
  const selectFrom = db.prepare("SELECT data FROM loopy_events WHERE thread_id = ?1 AND seq >= ?2 ORDER BY seq ASC");
  const upsertSnap = db.prepare("INSERT OR REPLACE INTO loopy_snapshots (thread_id, data) VALUES (?1, ?2)");
  const selectSnap = db.prepare("SELECT data FROM loopy_snapshots WHERE thread_id = ?1");
  const countEvents = db.prepare("SELECT COUNT(*) AS n FROM loopy_events WHERE thread_id = ?1");

  const rows = (t: ThreadId, from: number): Event[] =>
    (selectFrom.all(t, from) as { data: string }[]).map((r) => JSON.parse(r.data) as Event);

  return {
    async appendEvents(t: ThreadId, es: readonly Event[]): Promise<void> {
      const tx = db.transaction((batch: readonly Event[]) => {
        for (const e of batch) insert.run(t, e.seq, JSON.stringify(e));
      });
      tx(es);
    },
    async save(t: ThreadId, s: Snapshot): Promise<void> {
      upsertSnap.run(t, JSON.stringify(s));
    },
    async load(t: ThreadId) {
      const n = (countEvents.get(t) as { n: number }).n;
      const snapRow = selectSnap.get(t) as { data: string } | null;
      if (n === 0 && !snapRow) return null;
      return { snapshot: snapRow ? (JSON.parse(snapRow.data) as Snapshot) : null, events: rows(t, 0) };
    },
    async readLog(t: ThreadId, fromSeq = 0): Promise<readonly Event[]> {
      return rows(t, fromSeq);
    },
  };
}
