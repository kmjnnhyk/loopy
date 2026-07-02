import { END } from "../index";
import { applyPatch, foldScoped, type ChannelRecord, type StateSnapshot } from "./channels";
import { EventSession, Memo, isSuspend, makeCtx, type RuntimeCtx } from "./effects";
import { runId as mkRunId, serializeError, threadId as mkThreadId, type Event, type ThreadId } from "./events";
import type { ModelClient } from "./model";
import type { Checkpointer } from "./store";

export class RunSuspended extends Error {
  constructor(
    readonly threadId: string,
    readonly payload: unknown,
    readonly resumeKey: string,
  ) {
    super(`run suspended (threadId=${threadId}) — resume with rt.resume(threadId, value)`);
    this.name = "RunSuspended";
  }
}

export interface KernelCtx {
  readonly session: EventSession;
  readonly memo: Memo;
  readonly loadedEvents: readonly Event[];
  readonly deps: Record<string, unknown>;
  readonly models: Record<string, ModelClient>;
}

export interface RunnableNode {
  reads(state: StateSnapshot): unknown;
  run(input: unknown, ctx: RuntimeCtx, kernel: KernelCtx, scope: string): Promise<unknown>;
}

export interface Driver {
  readonly channels: ChannelRecord;
  seed(input: unknown): Record<string, unknown>;
  next(state: StateSnapshot, lastNode: string | null): string | typeof END;
  onSelected(node: string, state: StateSnapshot): Record<string, unknown> | null;
  node(name: string): RunnableNode;
  updatesFor(name: string, output: unknown, state: StateSnapshot): Record<string, unknown>;
  output(state: StateSnapshot): unknown;
  guard(completedTicks: number, state: StateSnapshot): void;
}

/** parse this scope's direct-child events out of the loaded log */
function scanScope(events: readonly Event[], scope: string) {
  const prefix = scope === "" ? "" : `${scope}/`;
  const epochs = new Map<string, number>();
  let lastNode: string | null = null;
  let inFlight: { name: string; visit: string } | null = null;
  let completedTicks = 0;
  let hasAny = false;
  for (const e of events) {
    if (e.node !== scope && !e.node.startsWith(prefix)) continue;
    if (e.node === scope) {
      // scope 자체 이벤트 — 오직 StatePatched만 "이미 seed됨"의 증거. RunStarted(root)나
      // StepStarted(중첩 scope 진입 직전, 부모가 기록)는 scope 주소가 우연히 같을 뿐 seed 여부와
      // 무관 — 이걸 hasAny에 포함시키면 매 fresh entry마다 seed가 스킵된다(관찰된 버그).
      if (e.type === "StatePatched") hasAny = true;
      continue;
    }
    hasAny = true;
    const rest = e.node.slice(prefix.length);
    const child = rest.split("/")[0]!; // "name#epoch"
    const name = child.split("#")[0]!;
    const epoch = Number(child.split("#")[1] ?? "0");
    if (epoch > (epochs.get(name) ?? 0)) epochs.set(name, epoch);
    if (rest === child) {
      if (e.type === "StepStarted") inFlight = { name, visit: child };
      else if (e.type === "StepEnded") {
        lastNode = name;
        inFlight = null;
        completedTicks++;
      }
    }
  }
  return { epochs, lastNode, inFlight, completedTicks, hasAny, prefix };
}

export async function runGraph(driver: Driver, scope: string, k: KernelCtx, input: unknown): Promise<unknown> {
  const scan = scanScope(k.loadedEvents, scope);
  let state = foldScoped(driver.channels, k.loadedEvents, scope);
  let { lastNode, inFlight, completedTicks } = scan;

  const patch = async (update: Record<string, unknown>): Promise<void> => {
    await k.session.write({ type: "StatePatched", update, node: scope });
    state = applyPatch(driver.channels, state, update);
  };

  if (!scan.hasAny) await patch(driver.seed(input)); // fresh scope only

  for (;;) {
    let name: string;
    let visit: string;
    let reentry = false;
    if (inFlight) {
      ({ name, visit } = inFlight); // resume/crash re-entry: same visit path → memo replays effects
      inFlight = null;
      reentry = true;
    } else {
      driver.guard(completedTicks, state);
      const sel = driver.next(state, lastNode);
      if (sel === END) break;
      name = sel;
      const consume = driver.onSelected(name, state);
      if (consume) await patch(consume);
      const epoch = (scan.epochs.get(name) ?? 0) + 1;
      scan.epochs.set(name, epoch);
      visit = `${name}#${epoch}`;
    }
    const nodePath = scan.prefix === "" ? visit : `${scan.prefix}${visit}`;
    if (!reentry) await k.session.write({ type: "StepStarted", node: nodePath });

    const node = driver.node(name);
    const ctx = makeCtx({ scope: nodePath, session: k.session, memo: k.memo, deps: k.deps });
    const output = await node.run(node.reads(state), ctx, k, nodePath); // Suspend는 그대로 위로

    const updates = driver.updatesFor(name, output, state);
    if (Object.keys(updates).length > 0) await patch(updates);
    await k.session.write({ type: "StepEnded", node: nodePath });
    lastNode = name;
    completedTicks++;
  }
  return driver.output(state);
}

export interface RunOptions {
  driver: Driver;
  store: Checkpointer;
  threadId: string;
  entry: string;
  deps?: Record<string, unknown>;
  models?: Record<string, ModelClient>;
  onEvent?: (e: Event) => void;
  input?: unknown;
  resume?: { value: unknown };
}

/** 크래시 모드 ①: InterruptRaised는 로그에 남았지만 suspended snapshot 저장 전에 크래시한
 *  스레드 — 로그가 유일한 권위이므로 snapshot 없이도 로그에서 pending을 복구한다. */
function derivePendingFromLog(events: readonly Event[]): { effectId: number; resumeKey: string; payload: unknown } | null {
  const resumed = new Set<string>();
  for (const e of events) if (e.type === "Resumed") resumed.add(e.resumeKey);
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === "InterruptRaised" && !resumed.has(e.resumeKey))
      return { effectId: e.effectId, resumeKey: e.resumeKey, payload: e.payload };
  }
  return null;
}

export async function runThread(o: RunOptions): Promise<unknown> {
  const tid: ThreadId = mkThreadId(o.threadId);
  const loaded = await o.store.load(tid);
  let events: readonly Event[] = loaded?.events ?? [];
  const snapshot = loaded?.snapshot ?? null;

  let pending: { readonly effectId: number; readonly resumeKey: string; readonly payload: unknown } | null = null;
  if (o.resume) {
    pending = snapshot?.status === "suspended" && snapshot.pending ? snapshot.pending : derivePendingFromLog(events);
    if (!pending) throw new Error(`resume("${o.threadId}"): thread is not suspended`);
  } else if (events.length > 0) {
    // v1: errored 스레드 재실행 불가 — 로그는 감사용 보존, 복구는 새 threadId.
    throw new Error(`run("${o.threadId}"): thread already exists — resume it or use a fresh threadId`);
  }

  const rid = events[0]?.runId ?? mkRunId(`${o.threadId}#run`);
  const startSeq = events.length > 0 ? events[events.length - 1]!.seq + 1 : 0;
  const session = new EventSession(o.store, tid, rid, startSeq, o.onEvent);

  if (o.resume) {
    const resumed = await session.write({
      type: "Resumed", resumeKey: pending!.resumeKey, value: o.resume.value, node: "",
    });
    events = [...events, resumed];
  } else {
    const started = await session.write({ type: "RunStarted", entry: o.entry, input: o.input, node: "" });
    events = [...events, started];
  }

  const k: KernelCtx = {
    session, memo: Memo.fromEvents(events), loadedEvents: events,
    deps: o.deps ?? {}, models: o.models ?? {},
  };

  let output: unknown;
  try {
    output = await runGraph(o.driver, "", k, o.input);
  } catch (err) {
    if (isSuspend(err)) {
      await o.store.save(tid, {
        status: "suspended", cursor: session.lastWritten(),
        pending: { effectId: err.effectId, resumeKey: err.resumeKey, payload: err.payload },
      }); // 저장 실패 시 그대로 전파 — 지속되지 않은 suspend를 RunSuspended로 거짓 보고하지 않음
      throw new RunSuspended(o.threadId, err.payload, err.resumeKey);
    }
    try {
      await session.write({ type: "RunErrored", error: serializeError(err), node: "" });
      await o.store.save(tid, { status: "error", cursor: session.lastWritten() });
    } catch {
      // store failure while recording the failure — surface the original domain error
    }
    throw err;
  }
  await session.write({ type: "RunEnded", output, node: "" });
  await o.store.save(tid, { status: "done", cursor: session.lastWritten() });
  return output;
}
