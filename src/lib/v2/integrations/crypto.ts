import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";

/**
 * SPEC-D G2.1 — secrets at rest. AES-256-GCM sealed blobs for the config_enc
 * columns; key file ~/.agentic-os/agentos.key (32 random bytes, created on
 * first use with mode 0o600 — ADVISORY on Windows: NTFS ACLs ignore POSIX
 * modes, acceptable for a single-user box per SPEC-D §8.2). Sealed values are
 * versioned "v1:<iv>:<tag>:<ct>" base64url so a future key/format rotation is
 * detectable. Decrypted config NEVER reaches logs or API responses.
 *
 * AGENTIC_OS_KEY env override (smoke tests only — same pattern as
 * AGENTIC_OS_DB/AGENTIC_OS_SETTINGS) redirects the key file so smokes never
 * touch (or create) the live key.
 */

const VERSION = "v1";

export function keyPath(): string {
  const override = process.env.AGENTIC_OS_KEY;
  if (override && override.trim()) return override.trim();
  return path.join(os.homedir(), ".agentic-os", "agentos.key");
}

let cachedKey: Buffer | null = null;
let cachedKeyFile: string | null = null;

function getKey(): Buffer {
  const file = keyPath();
  if (cachedKey && cachedKeyFile === file) return cachedKey;
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // mode is advisory on Windows (see header comment) — kept for POSIX hosts.
    fs.writeFileSync(file, randomBytes(32), { mode: 0o600 });
  }
  const key = fs.readFileSync(file);
  if (key.length !== 32) {
    throw new Error(
      `integrations key file ${file} is ${key.length} bytes, expected 32 — refusing to encrypt with a malformed key`,
    );
  }
  cachedKey = key;
  cachedKeyFile = file;
  return key;
}

/** Encrypt a UTF-8 string → opaque "v1:iv:tag:ct" blob. */
export function sealSecret(plain: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ct.toString("base64url"),
  ].join(":");
}

/** Decrypt a sealed blob. Throws loudly on tamper/format/key mismatch. */
export function openSecret(sealed: string): string {
  const parts = sealed.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("openSecret: not a sealed v1 blob");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const key = getKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** Seal a config object (JSON) for a config_enc column. */
export function sealJson(obj: Record<string, unknown>): string {
  return sealSecret(JSON.stringify(obj));
}

/** Open a config_enc column back into an object. null/empty → {}. */
export function openJson(sealed: string | null | undefined): Record<string, string> {
  if (!sealed) return {};
  const parsed = JSON.parse(openSecret(sealed)) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (v !== undefined && v !== null) out[k] = String(v);
  }
  return out;
}

/** Test-only: forget the cached key (lets AGENTIC_OS_KEY point elsewhere). */
export function __resetKeyCacheForTests(): void {
  cachedKey = null;
  cachedKeyFile = null;
}
