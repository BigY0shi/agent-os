// The ONE tolerant JSON parser for model output (SPEC-F K3.2: "reuse the
// marketing.ts helper by exporting it to src/lib/v2/json.ts").
//
// Lifted verbatim from src/lib/marketing.ts, which now imports it back — there
// is exactly one implementation of this in the tree, on purpose. Pure: no node
// imports, so client components may import it too.

/**
 * Pull the first complete JSON object out of a model response.
 *
 * Tolerates: leading prose, ```json fences, trailing commentary. Returns null
 * (never throws) when nothing parseable is present — callers decide whether a
 * miss is soft (mark the row failed) or loud (throw).
 */
export function extractJsonObj<T>(raw: string): T | null {
  let s = (raw || "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a === -1 || b === -1 || b < a) return null;
  try {
    return JSON.parse(s.slice(a, b + 1)) as T;
  } catch {
    return null;
  }
}

/** The array-shaped sibling: first complete JSON array in a model response. */
export function extractJsonArr<T>(raw: string): T[] | null {
  let s = (raw || "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const a = s.indexOf("[");
  const b = s.lastIndexOf("]");
  if (a === -1 || b === -1 || b < a) return null;
  try {
    const v = JSON.parse(s.slice(a, b + 1));
    return Array.isArray(v) ? (v as T[]) : null;
  } catch {
    return null;
  }
}
