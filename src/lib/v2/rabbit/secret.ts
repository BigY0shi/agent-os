// Rabbit R1 bridge — the bearer token an OpenAI-compatible client (the R1's
// "local endpoint" + "API key" fields) presents. Lives at
// ~/.agentic-os/rabbit.secret; the owner types his own in the /rabbit gear
// (2026-09-13: "let me set my own password as the bearer token"), or generates
// a short one. It is returned ONLY through the cookie-gated /api/rabbit/setup
// route — never through the proxy-exempt /api/rabbit/v1/* paths.
// Same shape as jarvis/hotkeySecret.ts.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";

export const SECRET_MIN = 4;
export const SECRET_MAX = 128;

/** Generated keys: 12 chars, no 0/O/1/l/I look-alikes (~59 bits). Typeable on a handheld. */
const GEN_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const GEN_LENGTH = 12;

export function generateSecret(): string {
  const bytes = randomBytes(GEN_LENGTH);
  let out = "";
  for (let i = 0; i < GEN_LENGTH; i++) out += GEN_ALPHABET[bytes[i] % GEN_ALPHABET.length];
  return out;
}

export function rabbitSecretPath(): string {
  // Test override = a PATH (same convention as AGENTIC_OS_HOTKEY_SECRET): smokes
  // must never touch the live secret.
  const override = process.env.AGENTIC_OS_RABBIT_SECRET;
  if (override && override.trim()) return override.trim();
  return path.join(os.homedir(), ".agentic-os", "rabbit.secret");
}

export function readRabbitSecret(): string | null {
  try {
    const p = rabbitSecretPath();
    if (!existsSync(p)) return null;
    const s = readFileSync(p, "utf8").trim();
    return s || null;
  } catch {
    return null;
  }
}

function writeSecret(secret: string): string {
  const p = rabbitSecretPath();
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, secret + "\n", "utf8");
  return secret;
}

/** Generate-if-absent; idempotent. */
export function ensureRabbitSecret(): string {
  return readRabbitSecret() ?? writeSecret(generateSecret());
}

/** Replace with a freshly generated key (the R1 must be re-pointed). */
export function rotateRabbitSecret(): string {
  return writeSecret(generateSecret());
}

/** Validate an owner-chosen key. Returns the error to show, or null when fine. */
export function secretProblem(raw: unknown): string | null {
  if (typeof raw !== "string") return "Key must be text.";
  const s = raw.trim();
  if (s.length < SECRET_MIN) return `Key must be at least ${SECRET_MIN} characters.`;
  if (s.length > SECRET_MAX) return `Key must be at most ${SECRET_MAX} characters.`;
  if (/\s/.test(s)) return "Key cannot contain spaces or line breaks.";
  if (!/^[\x21-\x7e]+$/.test(s)) return "Key must be plain printable ASCII (the R1 keyboard can't type anything else).";
  return null;
}

/** Set the owner's own key. Caller validates with secretProblem() first. */
export function setRabbitSecret(raw: string): string {
  const problem = secretProblem(raw);
  if (problem) throw new Error(problem);
  return writeSecret(raw.trim());
}

/** Timing-safe compare (both sides hashed so length never leaks). */
export function verifyRabbitSecret(presented: string | null | undefined): boolean {
  const stored = readRabbitSecret();
  if (!stored || !presented) return false;
  const a = createHash("sha256").update(stored).digest();
  const b = createHash("sha256").update(presented).digest();
  return timingSafeEqual(a, b);
}

/**
 * Pull the presented key out of a request the way OpenAI clients send it:
 * `Authorization: Bearer <key>` first, `x-api-key: <key>` as the fallback.
 */
export function presentedKey(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth) {
    const m = auth.match(/^\s*Bearer\s+(.+?)\s*$/i);
    if (m) return m[1];
  }
  const xk = req.headers.get("x-api-key");
  return xk ? xk.trim() : null;
}

/**
 * The gate for /api/rabbit/v1/*. requireKey OFF (the owner's default) → always
 * null, the request proceeds with no credential at all. ON → 503 when no key is
 * stored, 401 on mismatch, null when the presented key matches.
 */
export function rabbitAuthFailure(req: Request, requireKey: boolean): Response | null {
  if (!requireKey) return null;
  if (!readRabbitSecret()) {
    return Response.json(
      { error: { message: "Rabbit bridge not configured — open Agent OS → Rabbit R1 → Configure and set an API key.", type: "server_error" } },
      { status: 503 },
    );
  }
  if (!verifyRabbitSecret(presentedKey(req))) {
    return Response.json(
      { error: { message: "Unauthorized — bad or missing API key (Authorization: Bearer <key>).", type: "invalid_request_error" } },
      { status: 401 },
    );
  }
  return null;
}
