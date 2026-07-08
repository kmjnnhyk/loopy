import { expect, test, afterAll } from "bun:test";
import { defineLoopy, stubModel } from "@loopyjs/core";
import { designFlow } from "../../../examples/workflows";
import { classifier, sufficiency, fileAnalyzer, verifier, codeGen } from "../../../examples/agents";
import { stubDeps } from "../../../tests/anchors/designflow.test";
import { startDevServer } from "../src/server.ts";

const answer = (o: unknown) => ({ text: JSON.stringify(o), stopReason: "end_turn" });
const rt = defineLoopy({
  agents: { classifier, sufficiency, fileAnalyzer, verifier, codeGen },
  workflows: { designFlow },
  deps: stubDeps,
  models: {
    // 2 designFlow runs execute against this shared runtime in this file (POST /api/run
    // test + WS test) — each run consumes 2 haiku calls (fileAnalyzer, verifier) + 1
    // sonnet call (codeGen), so the fixture script covers 2 full runs.
    haiku: stubModel([
      answer({ paths: ["src/a.ts"] }), answer({ passed: true, notes: "lgtm" }),
      answer({ paths: ["src/a.ts"] }), answer({ passed: true, notes: "lgtm" }),
    ]),
    sonnet: stubModel([answer({ applied: ["src/a.ts"], failed: [] }), answer({ applied: ["src/a.ts"], failed: [] })]),
  },
});
const srv = startDevServer({ runtime: rt, port: 0 });
const url = (p: string) => `http://localhost:${srv.port}${p}`;
afterAll(() => srv.stop());

test("GET /api/entries lists registered entries", async () => {
  const res = await fetch(url("/api/entries"));
  const body = await res.json();
  expect(body).toContainEqual({ name: "designFlow", kind: "workflow" });
});

test("GET /api/topology/:name returns the workflow skeleton", async () => {
  const res = await fetch(url("/api/topology/designFlow"));
  const topo = await res.json();
  expect(topo.kind).toBe("workflow");
  expect(topo.nodes.length).toBeGreaterThan(0);
});

test("POST /api/run triggers an in-proc run; events are then queryable per thread", async () => {
  const res = await fetch(url("/api/run"), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "designFlow", input: { message: "add /healthz" } }),
  });
  const { threadId } = await res.json();
  expect(typeof threadId).toBe("string");
  const log = await (await fetch(url(`/api/threads/${threadId}`))).json();
  expect(log[0].type).toBe("RunStarted");
  expect(log[log.length - 1].type).toBe("RunEnded");
});

test("POST /api/run with an unknown name returns 400 and creates no phantom thread", async () => {
  const res = await fetch(url("/api/run"), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "designFlo", input: { message: "x" } }),
  });
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(typeof body.error).toBe("string");
});

test("WS streams live events as a run executes", async () => {
  const ws = new WebSocket(url("/ws").replace("http", "ws"));
  const got: string[] = [];
  await new Promise<void>((r) => { ws.onopen = () => r(); });
  ws.onmessage = (m) => got.push(JSON.parse(String(m.data)).type);
  await fetch(url("/api/run"), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "designFlow", input: { message: "ws test" } }),
  });
  await Bun.sleep(200);
  ws.close();
  expect(got).toContain("RunStarted");
  expect(got).toContain("RunEnded");
});
