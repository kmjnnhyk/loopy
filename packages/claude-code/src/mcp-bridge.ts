// startToolBridge() — in-process HTTP MCP server exposing loopy tools to a
// delegated `claude -p` run. Tools EXECUTE HERE (real live deps); Claude Code
// only calls them over localhost. SDK is an OPTIONAL peer — loaded lazily so
// model-A-only users never need it.
//
// Schema note: loopy's io() is runtime-schemaless (validate = identity), so tools
// are advertised description-only with an open input schema — the exact same
// information agentDriver's manifest() gives a raw model. Put arg shapes in the
// tool description.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import type { AnyStep } from "@loopyjs/core";
import { pickDeps, stableStringify } from "@loopyjs/core/internal";

export interface ToolBridge {
  readonly url: string;
  close(): Promise<void>;
}

interface McpSdk {
  Server: new (info: { name: string; version: string }, opts: { capabilities: { tools: object } }) => {
    setRequestHandler(schema: unknown, handler: (req: never) => unknown): void;
    connect(transport: unknown): Promise<void>;
  };
  Transport: new (opts: { sessionIdGenerator: () => string }) => {
    handleRequest(req: unknown, res: unknown, body?: unknown): Promise<void>;
  };
  ListToolsRequestSchema: unknown;
  CallToolRequestSchema: unknown;
}

async function loadSdk(): Promise<McpSdk> {
  try {
    const [server, http, types] = await Promise.all([
      import("@modelcontextprotocol/sdk/server/index.js"),
      import("@modelcontextprotocol/sdk/server/streamableHttp.js"),
      import("@modelcontextprotocol/sdk/types.js"),
    ]);
    return {
      Server: server.Server as unknown as McpSdk["Server"],
      Transport: http.StreamableHTTPServerTransport as McpSdk["Transport"],
      ListToolsRequestSchema: types.ListToolsRequestSchema,
      CallToolRequestSchema: types.CallToolRequestSchema,
    };
  } catch (err) {
    const code = (err as { code?: string }).code;
    const message = err instanceof Error ? err.message : String(err);
    if (code === "ERR_MODULE_NOT_FOUND" || /Cannot find (module|package)/i.test(message)) {
      throw new Error(
        'delegatedAgent requires the optional peer "@modelcontextprotocol/sdk" — install it with `bun add @modelcontextprotocol/sdk`. (Only delegated agents need it; the claudeCode() model client works without it.)',
      );
    }
    throw err;
  }
}

export async function startToolBridge(
  tools: readonly AnyStep[],
  deps: Record<string, unknown>,
): Promise<ToolBridge> {
  const sdk = await loadSdk();
  const byName = new Map(tools.map((t) => [t.name, t]));

  const server = new sdk.Server({ name: "loopy", version: "0.1.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(sdk.ListToolsRequestSchema, () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: (t as { description?: string }).description ?? t.name,
      inputSchema: { type: "object", additionalProperties: true },
    })),
  }));

  server.setRequestHandler(sdk.CallToolRequestSchema, async (req: never) => {
    const { name, arguments: args } = (req as { params: { name: string; arguments?: unknown } }).params;
    const t = byName.get(name);
    if (!t) return { content: [{ type: "text", text: `ERROR: unknown tool "${name}"` }], isError: true };
    try {
      const toolCtx = {
        deps: pickDeps(deps, t["~depKeys"]),
        interrupt: (): never => {
          throw new Error("interrupt/HITL is not supported inside a delegated agent (v1)");
        },
      };
      const value = await (t.run as (i: unknown, c: unknown) => Promise<unknown>)(args ?? {}, toolCtx);
      return { content: [{ type: "text", text: stableStringify(value) }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: `ERROR ${name}: ${msg}` }], isError: true };
    }
  });

  const transport = new sdk.Transport({ sessionIdGenerator: () => randomUUID() });
  await server.connect(transport);

  const httpServer = createServer((req, res) => {
    if (!req.url || !req.url.startsWith("/mcp")) {
      res.writeHead(404).end();
      return;
    }
    if (req.method === "POST") {
      let body = "";
      req.on("data", (d: Buffer) => (body += d.toString()));
      req.on("end", () => {
        let parsed: unknown;
        try {
          parsed = body.length > 0 ? JSON.parse(body) : undefined;
        } catch {
          res.writeHead(400).end();
          return;
        }
        void transport.handleRequest(req, res, parsed);
      });
    } else {
      void transport.handleRequest(req, res); // GET(SSE)/DELETE — transport가 처리
    }
  });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const port = (httpServer.address() as { port: number }).port;

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: (): Promise<void> =>
      new Promise((resolve, reject) => {
        // Bun's http server marks itself not-listening as soon as
        // closeAllConnections() runs, so close() must be armed FIRST (it flips
        // the server into "closing" state) — calling closeAllConnections()
        // before close() throws ERR_SERVER_NOT_RUNNING under Bun.
        httpServer.close((err) => (err ? reject(err) : resolve()));
        httpServer.closeAllConnections();
      }),
  };
}
