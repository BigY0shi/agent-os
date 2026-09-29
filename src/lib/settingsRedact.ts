// Settings as the browser may see them. Key material never reaches the browser through
// /api/settings or the Control Room's /api/control/settings (AGENTS.md "Credentials leave
// through exactly one door"): a secret-looking string field comes back MASKED when set
// ("" when not), and a PATCH carrying a masked value leaves the stored value untouched,
// so a round-trip save can never overwrite a key with its mask.
//
// Mask (owner, 2026-09-28: "it would be nice if it showed me like the first 5 letters"):
// the first 5 characters + "********" for secrets of 16+ characters, so a vendor prefix
// (tvly-, amcp_, apify) identifies which key is saved; a shorter secret is "********"
// alone. The one secret the owner must be able to copy in full, the MCP endpoint's,
// has its own cookie-only door: POST /api/v2/memory/mcp-secret/reveal.
//
// Pure module (no node imports): the settings forms import isMaskedSecret too.

export const SECRET_PLACEHOLDER = "********";
const PREVIEW_CHARS = 5;
const PREVIEW_MIN_LENGTH = 16;

/** Field NAMES that hold key material. `hotkey.key` is a key name (F13), not a secret. */
// Matched case-insensitively on the leaf name, so apifyToken, sunoCookie, mcp.secret
// and tavilyKey are all caught; a bare "key" (a hotkey name) is not.
const SECRET_WORD = /(secret|apikey|api_key|api-key|token|password|passwd|cookie|credential|bearer|privatekey|private_key)$/;
const CAMEL_KEY = /[a-z0-9]Key$/;
const NOT_SECRET = new Set(["jarvis.hotkey.key"]);

export function isSecretPath(dotted: string): boolean {
  if (NOT_SECRET.has(dotted)) return false;
  const leaf = dotted.split(".").pop() ?? "";
  return SECRET_WORD.test(leaf.toLowerCase()) || CAMEL_KEY.test(leaf);
}

/** The masked form of a secret value ("" stays ""). */
export function maskSecret(value: string): string {
  if (!value) return "";
  return value.length >= PREVIEW_MIN_LENGTH ? value.slice(0, PREVIEW_CHARS) + SECRET_PLACEHOLDER : SECRET_PLACEHOLDER;
}

/** True for a value that is a mask, not a key someone typed. */
export function isMaskedSecret(value: unknown): value is string {
  return typeof value === "string" && value.endsWith(SECRET_PLACEHOLDER) && value.length <= PREVIEW_CHARS + SECRET_PLACEHOLDER.length;
}

export function redactSettings<T>(value: T, prefix = ""): T {
  if (Array.isArray(value)) return value.map((v) => redactSettings(v, prefix)) as unknown as T;
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string" && isSecretPath(p)) out[k] = maskSecret(v);
    else out[k] = redactSettings(v, p);
  }
  return out as T;
}

/** Remove every masked value from a patch, so "unchanged secret" means unchanged. */
export function stripPlaceholders<T>(patch: T, prefix = ""): T {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (isSecretPath(p) && isMaskedSecret(v)) continue;
    out[k] = v && typeof v === "object" && !Array.isArray(v) ? stripPlaceholders(v, p) : v;
  }
  return out as T;
}
