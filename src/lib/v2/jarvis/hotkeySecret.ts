// SPEC-C C2 (C1.1): the AHK helper's shared secret. Lives at
// ~/.agentic-os/jarvis-hotkey.secret (64 hex chars); generated on the first
// GET /api/jarvis/hotkey/setup and read by the helper script locally — it is
// returned only through the cookie-authed setup route, never through the
// proxy-exempt POST path.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";

export function hotkeySecretPath(): string {
  // Test override (smokes must never touch the live secret — same pattern as
  // AGENTIC_OS_DB / AGENTIC_OS_SETTINGS).
  const override = process.env.AGENTIC_OS_HOTKEY_SECRET;
  if (override && override.trim()) return override.trim();
  return path.join(os.homedir(), ".agentic-os", "jarvis-hotkey.secret");
}

export function readHotkeySecret(): string | null {
  try {
    const p = hotkeySecretPath();
    if (!existsSync(p)) return null;
    const s = readFileSync(p, "utf8").trim();
    return s || null;
  } catch {
    return null;
  }
}

/** Generate-if-absent; returns the secret. Idempotent (second call = same secret). */
export function ensureHotkeySecret(): string {
  const existing = readHotkeySecret();
  if (existing) return existing;
  const secret = randomBytes(32).toString("hex");
  const p = hotkeySecretPath();
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, secret + "\n", "utf8");
  return secret;
}

/** Timing-safe compare of a presented header value vs the stored secret. */
export function verifyHotkeySecret(presented: string | null | undefined): boolean {
  const stored = readHotkeySecret();
  if (!stored || !presented) return false;
  // Hash both sides so length differences never leak through timingSafeEqual's
  // equal-length requirement.
  const a = createHash("sha256").update(stored).digest();
  const b = createHash("sha256").update(presented).digest();
  return timingSafeEqual(a, b);
}
