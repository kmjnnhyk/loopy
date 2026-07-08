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
        // NOTE: brief used `${name}#dev-N`, but threadId travels unescaped in REST paths
        // (`/api/threads/${threadId}`) — a literal "#" is parsed client-side as a URL
        // fragment and never reaches the server, truncating the path. Hyphen avoids that.
        const threadId = `${name}-dev-${sink.log().length}`;
        // fire-and-forget: events stream over WS; errors are recorded as RunErrored in the log
        void opts.runtime.run(name as never, input as never, { threadId }).catch(() => {});
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
    // Bun.serve() binds synchronously, so `.port` is always resolved by the time it
    // returns — bun-types just types it as `number | undefined` defensively.
    port: server.port!,
    stop() {
      offSubscribe();
      offBroadcast();
      server.stop(true);
    },
  };
}
