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

/** balanced-bracket scan: first {...} or [...] block, string-safe. */
function extractJson(s: string, raw: string): string {
  const start = s.search(/[{[]/);
  if (start === -1) throw new ParseError("no JSON object/array found in model output", raw);
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
  throw new ParseError("unbalanced JSON in model output", raw);
}

function repairTrailingCommas(s: string): string {
  return s.replace(/,\s*([}\]])/g, "$1");
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
