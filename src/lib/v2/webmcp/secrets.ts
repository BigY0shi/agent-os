import path from "node:path";
import os from "node:os";
import fs from "node:fs";

/**
 * Package secret VALUES live in ~/.agentic-os/webmcp/<slug>.secrets.json —
 * NEVER in the DB, NEVER in API responses (the packages table stores only
 * name → '{{secret:NAME}}' refs; the UI shows "configured ✓"). Resolved
 * server-side at execute time (http handler); resolved values are fed to
 * redactArgs so they can never leak into call logs either.
 *
 * AGENTIC_OS_WEBMCP_DIR overrides the directory for smoke tests (same rule as
 * AGENTIC_OS_DB / AGENTIC_OS_SETTINGS: tests never touch the live home dir).
 */

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export function webmcpDir(): string {
  const override = process.env.AGENTIC_OS_WEBMCP_DIR;
  if (override && override.trim()) return override.trim();
  return path.join(os.homedir(), ".agentic-os", "webmcp");
}

function secretsFile(slug: string): string {
  return path.join(webmcpDir(), `${slug}.secrets.json`);
}

export function readPackageSecrets(slug: string): Record<string, string> {
  try {
    const raw = fs.readFileSync(secretsFile(slug), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") out[k] = v;
      }
      return out;
    }
  } catch {
    /* absent / unreadable = no secrets configured */
  }
  return {};
}

/** Write one secret value. Returns the full set of configured NAMES (never values). */
export function setPackageSecret(slug: string, name: string, value: string): string[] {
  if (!NAME_RE.test(name)) {
    throw new Error(`invalid secret name '${name}' (expected [A-Za-z_][A-Za-z0-9_]*)`);
  }
  const current = readPackageSecrets(slug);
  current[name] = value;
  fs.mkdirSync(webmcpDir(), { recursive: true });
  fs.writeFileSync(secretsFile(slug), JSON.stringify(current, null, 2), "utf8");
  return Object.keys(current).sort();
}

/** Configured secret NAMES only — the "configured ✓" surface. */
export function listPackageSecretNames(slug: string): string[] {
  return Object.keys(readPackageSecrets(slug)).sort();
}
