import type { Runtime, RuntimeEvent } from "@loopyjs/core";
import { createDevSink } from "./devsink.ts";

export interface DevServerOpts {
  runtime: Runtime<any>;
  port?: number;
  /** absolute path to the built browser bundle (browser/dist). Omit → API-only. */
  staticDir?: string;
}

export function startDevServer(opts: DevServerOpts): { port: number; stop(): void } {
  const dev = opts.runtime["~dev"];
  if (!dev) throw new Error("loopy dev: runtime has no ~dev handle — build it with defineLoopy({...}) (the loopy() builder is unsupported).");

  const sink = createDevSink();
  const clients = new Set<{ send(data: string): void }>();
  const offSubscribe = dev.subscribe((e) => sink.ingest(e));
  const offBroadcast = sink.onBroadcast((e: RuntimeEvent) => {
    const data = JSON.stringify(e);
    for (const c of clients) c.send(data);
  });

  const json = (v: unknown, status = 200): Response =>
    new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

  // synchronous per-server run counter → collision-free dev threadIds without depending
  // on event count (two near-simultaneous POSTs deriving the same sink.log().length would
  // otherwise collide → core's synchronous "thread already exists" throw, swallowed below).
  let runCounter = 0;

  const server = Bun.serve({
    port: opts.port ?? 5173,
    async fetch(req, srv) {
      const u = new URL(req.url);
      if (u.pathname === "/ws") {
        if (srv.upgrade(req)) return undefined as unknown as Response;
        return new Response("expected websocket", { status: 426 });
      }
      if (u.pathname === "/api/entries") return json(dev.entries());
      if (u.pathname.startsWith("/api/topology/")) return json(dev.topology(decodeURIComponent(u.pathname.slice("/api/topology/".length))));
      if (u.pathname.startsWith("/api/threads/")) {
        const tid = decodeURIComponent(u.pathname.slice("/api/threads/".length));
        const from = Number(u.searchParams.get("fromSeq") ?? "0");
        return json(sink.threadLog(tid, from));
      }
      if (u.pathname === "/api/run" && req.method === "POST") {
        const { name, input } = (await req.json()) as { name: string; input: unknown };
        // Validate the entry BEFORE firing: core's exec() calls driverFor(name) which throws
        // synchronously ("unknown entry") before any RunStarted is written — with the
        // fire-and-forget .catch() below that rejection would be swallowed, leaving the UI a
        // phantom 200+threadId whose thread log stays empty forever. Reject up front instead.
        if (!dev.entries().some((e) => e.name === name)) return json({ error: `unknown entry: ${name}` }, 400);
        // NOTE: brief used `${name}#dev-N`, but threadId travels unescaped in REST paths
        // (`/api/threads/${threadId}`) — a literal "#" is parsed client-side as a URL
        // fragment and never reaches the server, truncating the path. Hyphen avoids that.
        const threadId = `${name}-dev-${runCounter++}`;
        // fire-and-forget: events stream over WS; post-RunStarted errors are recorded as
        // RunErrored in the log (observable) — we only log here for dev-server visibility.
        void opts.runtime.run(name as never, input as never, { threadId }).catch((err) => console.error("loopy dev: run failed", err));
        return json({ threadId });
      }
      if (opts.staticDir) {
        const rel = u.pathname === "/" ? "/index.html" : u.pathname;
        const file = Bun.file(opts.staticDir + rel);
        if (await file.exists()) return new Response(file);
        return new Response(Bun.file(opts.staticDir + "/index.html")); // SPA fallback
      }
      return new Response("not found", { status: 404 });
    },
    websocket: {
      open(ws) { clients.add(ws); },
      close(ws) { clients.delete(ws); },
      message() {},
    },
  });

  return {
    // bun-types types `.port` as `number | undefined` because a unix-socket listener has
    // no port; we always bind a TCP port (explicit or 0 for ephemeral), so it's resolved.
    port: server.port!,
    stop() {
      offSubscribe();
      offBroadcast();
      server.stop(true);
    },
  };
}
