import type { RuntimeEvent } from "@loopyjs/core";
import type { ViewModel, TimelineRow, StepDetail } from "./types.ts";
import { parseScope } from "./graph.ts";

const emptyDetail = (node: string): StepDetail => ({ node, model: null, tools: [], patchedChannels: [], interrupt: null });

export function fold(events: readonly RuntimeEvent[], uptoSeq?: number): ViewModel {
  const vm: ViewModel = { threadId: null, entry: null, status: "idle", timeline: [], details: {}, lastSeq: -1 };
  const rows = new Map<string, TimelineRow>();
  const details = vm.details;
  // Pair ToolReturned to its ToolCalled by effectId (not array position): concurrent
  // tool calls return in COMPLETION order, not call order, so "last pushed" misattributes.
  const toolByEffect = new Map<number, StepDetail["tools"][number]>();
  let inFlight: string | null = null;

  for (const e of events) {
    if (uptoSeq !== undefined && e.seq > uptoSeq) break;
    vm.lastSeq = e.seq;
    vm.threadId = e.threadId;
    switch (e.type) {
      case "RunStarted": vm.entry = e.entry; vm.status = "running"; break;
      case "RunEnded": vm.status = "done"; inFlight = null; break;
      case "RunErrored": {
        vm.status = "errored";
        if (inFlight && rows.has(inFlight)) rows.get(inFlight)!.status = "errored";
        break;
      }
      case "StepStarted": {
        const { name, epoch, depth } = parseScope(e.node);
        rows.set(e.node, { seq: e.seq, node: e.node, name, epoch, depth, kind: "step", status: "running" });
        details[e.node] = emptyDetail(e.node);
        inFlight = e.node;
        break;
      }
      case "StepEnded": {
        const r = rows.get(e.node);
        if (r && r.status === "running") r.status = "done";
        inFlight = null;
        break;
      }
      case "ModelCallRequested": (details[e.node] ??= emptyDetail(e.node)).model = { request: e.req, response: null, ok: false }; break;
      case "ModelCallReturned": {
        const d = (details[e.node] ??= emptyDetail(e.node));
        if (d.model) { d.model.response = e.ok ? e.value : e.error; d.model.ok = e.ok; }
        break;
      }
      case "ToolCalled": {
        const entry = { tool: e.tool, args: e.args, value: null as unknown, ok: false };
        (details[e.node] ??= emptyDetail(e.node)).tools.push(entry);
        toolByEffect.set(e.effectId, entry);
        break;
      }
      case "ToolReturned": {
        const t = toolByEffect.get(e.effectId);
        if (t) { t.value = e.ok ? e.value : e.error; t.ok = e.ok; }
        break;
      }
      case "StatePatched": {
        const d = (details[e.node] ??= emptyDetail(e.node));
        for (const k of Object.keys(e.update)) if (!d.patchedChannels.includes(k)) d.patchedChannels.push(k);
        break;
      }
      case "InterruptRaised": {
        vm.status = "suspended";
        const d = (details[e.node] ??= emptyDetail(e.node));
        d.interrupt = { payload: e.payload };
        if (rows.has(e.node)) rows.get(e.node)!.status = "suspended";
        break;
      }
      default: break;
    }
  }

  vm.timeline = [...rows.values()].sort((a, b) => a.seq - b.seq);
  return vm;
}
