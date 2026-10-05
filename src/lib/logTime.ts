// The time a log line carries itself ("2026-09-29T00:12:03Z", "2026-09-29 00:12:03,120"),
// or null when it carries none. Callers show null as unknown and never invent one.
const STAMP = /(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2}(?:[.,]\d{1,6})?)(Z|[+-]\d{2}:?\d{2})?/;

export function lineTime(line: string): number | null {
  const m = STAMP.exec(line);
  if (!m) return null;
  const t = Date.parse(`${m[1]}T${m[2].replace(",", ".")}${m[3] ?? ""}`);
  return Number.isFinite(t) ? t : null;
}
