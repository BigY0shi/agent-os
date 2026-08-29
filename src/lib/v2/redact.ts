/**
 * ONE shared redactArgs() helper (CONVENTIONS §9.3) — used by the WebMCP call
 * logger, the mcp.execute audit emit, and later the integrations runtime +
 * browser audit. Masks:
 *   1. any value whose KEY matches /pass|token|secret|key|auth/i, and
 *   2. any string value EQUAL to a resolved secret value (pass them in).
 * Deep-clones — never mutates the input.
 */

const SENSITIVE_KEY_RE = /pass|token|secret|key|auth/i;
export const REDACTED = "[redacted]";

export function redactArgs(
  args: unknown,
  secretValues: readonly string[] = [],
): unknown {
  const secrets = new Set(secretValues.filter((s) => s.length > 0));

  const walk = (value: unknown, keyIsSensitive: boolean): unknown => {
    if (typeof value === "string") {
      return keyIsSensitive || secrets.has(value) ? REDACTED : value;
    }
    if (Array.isArray(value)) {
      return value.map((v) => walk(v, keyIsSensitive));
    }
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = walk(v, keyIsSensitive || SENSITIVE_KEY_RE.test(k));
      }
      return out;
    }
    // numbers/booleans/null under a sensitive key are masked too (a numeric
    // "pin"/"key" is still a credential).
    if (keyIsSensitive && value !== undefined && value !== null) return REDACTED;
    return value;
  };

  return walk(args, false);
}

/**
 * Replace every OCCURRENCE of a resolved secret VALUE inside free text with
 * [redacted] (HARDENING-2026-08-27 item 5). Used on http-lane error/output
 * text before it is persisted or returned — a provider that echoes an
 * Authorization header back in its error body would otherwise land the secret
 * in SQLite call logs and model context. Secrets shorter than 4 chars are
 * skipped (masking single characters would shred the text).
 */
export function redactText(text: string, secretValues: readonly string[]): string {
  let out = text;
  for (const s of secretValues) {
    if (typeof s === "string" && s.length >= 4) out = out.split(s).join(REDACTED);
  }
  return out;
}
