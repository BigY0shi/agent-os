// S15: settings as the Control Room may see them. Key material never reaches the
// browser through this door (AGENTS.md "Credentials leave through exactly one door"):
// a secret-looking string field comes back as a fixed placeholder when set, "" when
// not, and a PATCH carrying the placeholder leaves the stored value untouched, so a
// round-trip save can never overwrite a key with "********".
//
// Note: the older GET /api/settings still returns everything (the Memory gear reads
// mcp.secret from it to show the MCP secret); that is flagged for the owner, not
// changed here.

export const SECRET_PLACEHOLDER = "********";

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

export function redactSettings<T>(value: T, prefix = ""): T {
  if (Array.isArray(value)) return value.map((v) => redactSettings(v, prefix)) as unknown as T;
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string" && isSecretPath(p)) out[k] = v ? SECRET_PLACEHOLDER : "";
    else out[k] = redactSettings(v, p);
  }
  return out as T;
}

/** Remove every placeholder from a patch, so "unchanged secret" means unchanged. */
export function stripPlaceholders<T>(patch: T, prefix = ""): T {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v === SECRET_PLACEHOLDER && isSecretPath(p)) continue;
    out[k] = v && typeof v === "object" && !Array.isArray(v) ? stripPlaceholders(v, p) : v;
  }
  return out as T;
}
