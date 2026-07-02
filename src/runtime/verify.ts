import { foldScoped } from "./channels";
import { ReplayDivergence } from "./effects";
import { digest, stableStringify, threadId as mkThreadId } from "./events";
import type { Driver } from "./scheduler";
import type { Checkpointer } from "./store";

/** 완주 로그 자가 점검: 재fold 결과가 기록과 byte-identical한지 + effect 쌍 무결성. */
export async function verifyReplay(
  store: Checkpointer,
  threadIdValue: string,
  driver: Driver,
): Promise<{ output: unknown }> {
  const events = await store.readLog(mkThreadId(threadIdValue));
  if (events.length === 0) throw new Error(`verifyReplay("${threadIdValue}"): no events`);
  const last = events[events.length - 1]!;
  if (last.type !== "RunEnded") throw new Error(`verifyReplay("${threadIdValue}"): thread not completed (no RunEnded)`);

  // ① effect 쌍 무결성 — dangling *Called (Resumed로 커버되지 않는 것)
  const open = new Map<number, string>();
  const resumedKeys = new Set<string>();
  for (const e of events) {
    if (e.type === "ToolCalled" || e.type === "ModelCallRequested" || e.type === "SleepScheduled") open.set(e.effectId, e.posKey);
    else if (e.type === "ToolReturned" || e.type === "ModelCallReturned" || e.type === "TimerFired") open.delete(e.effectId);
    else if (e.type === "Resumed") resumedKeys.add(e.resumeKey);
    else if (e.type === "InterruptRaised" && resumedKeys.has(e.resumeKey)) {
      // resumed interrupt는 정상 — no-op (InterruptRaised는 open에 안 넣음)
    }
  }
  if (open.size > 0) {
    const [firstOpen] = open.values();
    throw new Error(`verifyReplay("${threadIdValue}"): dangling effect at ${firstOpen} — crash mid-effect or impure author code`);
  }

  // ② 재fold → output 투영 == 기록된 RunEnded.output
  const state = foldScoped(driver.channels, events, "");
  const output = driver.output(state);
  if (stableStringify(output) !== stableStringify(last.output)) {
    throw new ReplayDivergence("<run-output>", digest(last.output), digest(output));
  }
  return { output };
}
