// Event model — append-only, paired effects. `ts` is metadata (never folded).
export type ThreadId = string & { readonly "~tid"?: never };
export type RunId = string & { readonly "~rid"?: never };
export function threadId(s: string): ThreadId {
  if (!s) throw new Error("threadId: empty");
  return s as ThreadId;
}
export function runId(s: string): RunId {
  if (!s) throw new Error("runId: empty");
  return s as RunId;
}

export interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}
export function serializeError(e: unknown): SerializedError {
  if (e instanceof Error) return { name: e.name, message: e.message, stack: e.stack };
  return { name: "Error", message: String(e) };
}

export interface EventBase {
  readonly seq: number;
  readonly threadId: ThreadId;
  readonly runId: RunId;
  readonly ts: string;
  /** graph scope path: "" root, "build#1", "codeGen#2/think#3", ... */
  readonly node: string;
}

export type Event = EventBase &
  (
    | { readonly type: "RunStarted"; readonly entry: string; readonly input: unknown }
    | { readonly type: "StepStarted" }
    | { readonly type: "StepEnded"; readonly next?: string }
    | { readonly type: "ModelCallRequested"; readonly effectId: number; readonly posKey: string; readonly argsDigest: string; readonly req: unknown }
    | { readonly type: "ModelCallReturned"; readonly effectId: number; readonly ok: boolean; readonly value?: unknown; readonly error?: SerializedError }
    | { readonly type: "ToolCalled"; readonly effectId: number; readonly posKey: string; readonly argsDigest: string; readonly tool: string; readonly args: unknown }
    | { readonly type: "ToolReturned"; readonly effectId: number; readonly ok: boolean; readonly value?: unknown; readonly error?: SerializedError }
    | { readonly type: "StatePatched"; readonly update: Readonly<Record<string, unknown>> }
    | { readonly type: "InterruptRaised"; readonly effectId: number; readonly posKey: string; readonly payload: unknown; readonly resumeKey: string }
    | { readonly type: "Resumed"; readonly resumeKey: string; readonly value: unknown }
    | { readonly type: "SleepScheduled"; readonly effectId: number; readonly posKey: string; readonly ms: number }
    | { readonly type: "TimerFired"; readonly effectId: number }
    | { readonly type: "NowRead"; readonly effectId: number; readonly posKey: string; readonly value: number }
    | { readonly type: "RandomRead"; readonly effectId: number; readonly posKey: string; readonly value: number }
    | { readonly type: "RunErrored"; readonly error: SerializedError }
    | { readonly type: "RunEnded"; readonly output: unknown }
  );

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** what callers hand to EventSession.write — base fields are filled in by the session */
export type EventBody = DistOmit<Event, "seq" | "threadId" | "runId" | "ts">;

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "undefined";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}

/** FNV-1a 64-bit over the stable stringification — content-address for memo keys. */
export function digest(v: unknown): string {
  const s = stableStringify(v);
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

/** memo position key — epoch is baked into the scope path (name#epoch). */
export function posKey(scope: string, ordinal: number, op: string): string {
  return `${scope}|${ordinal}|${op}`;
}
