import type { IO, InferOut } from "../index";

export class ParseError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
    this.name = "ParseError";
  }
}

function stripFences(s: string): string {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (m ? m[1]! : s).trim();
}

/** balanced-bracket scan from `start`: returns the block, or null if unbalanced. String-safe. */
function scanBalanced(s: string, start: number): string | null {
  const open = s[start]!;
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

/** First balanced {...} or [...] block; stray brackets in prose are skipped (backtrack). */
function extractJson(s: string, raw: string): string {
  let from = 0;
  for (;;) {
    const rel = s.slice(from).search(/[{[]/);
    if (rel === -1) break;
    const start = from + rel;
    const block = scanBalanced(s, start);
    if (block !== null) return block;
    from = start + 1;
  }
  throw new ParseError("no balanced JSON object/array found in model output", raw);
}

/** Drop `,` before `}`/`]` — only outside string values (string-safe char walk). */
function repairTrailingCommas(s: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      out += c;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      continue;
    }
    if (c === ",") {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j]!)) j++;
      if (j < s.length && (s[j] === "}" || s[j] === "]")) continue; // drop comma, keep whitespace
    }
    out += c;
  }
  return out;
}

export function parseStructured<S extends IO<any, any>>(schema: S, raw: string): InferOut<S> {
  const candidate = extractJson(stripFences(raw), raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    try {
      parsed = JSON.parse(repairTrailingCommas(candidate));
    } catch (e2) {
      throw new ParseError(`invalid JSON after repair: ${String(e2)}`, raw);
    }
  }
  const result = schema["~standard"].validate(parsed);
  if ("issues" in result) {
    throw new ParseError(`schema validation failed: ${result.issues.map((i) => i.message).join("; ")}`, raw);
  }
  return result.value as InferOut<S>;
}
