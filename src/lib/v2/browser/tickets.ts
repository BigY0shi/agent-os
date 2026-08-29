import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * E2.1 — HMAC tickets for the CDP WS bridge (port of the AOC auth.ts
 * verifyTicket pair, §4 verbatim-adapt).
 *
 * Why tickets: the ws.Server on settings.browser.wsPort is a SECOND listener —
 * proxy.ts's password gate does NOT cover it (§8 risk 1b). Every connection
 * therefore presents a short-lived HMAC ticket minted by a password-gated API
 * route (/api/v2/browser/ticket), so holding the ws port open buys an attacker
 * nothing without a dashboard session.
 *
 * Ticket format (upstream shape kept):
 *   base64url(JSON({sid, exp})) + "." + base64url(HMAC-SHA256(key, payload))
 *
 * Key = sha256(AGENTOS_PASSWORD + bootSalt). The boot salt is 32 random bytes
 * persisted once at ~/.agentic-os/ws-secret (CONVENTIONS §9.2: "keyed primarily
 * from a random persisted secret, not AGENTOS_PASSWORD [alone]"); mixing the
 * password in means a leaked salt file alone cannot mint tickets either.
 * FAIL-CLOSED: no AGENTOS_PASSWORD ⇒ no key ⇒ mint errors and verify refuses
 * (matches proxy.ts's locked-dashboard behavior).
 */

const TICKET_TTL_MS = 300_000; // 5 min
const SKEW_MS = 5_000; // +5s clock-drift tolerance on expiry

/** Test override mirrors AGENTIC_OS_DB / AGENTIC_OS_SETTINGS /
 *  AGENTIC_OS_BROWSER_PROFILES — smokes must never touch the real salt file. */
function wsSecretPath(): string {
  const override = process.env.AGENTIC_OS_WS_SECRET;
  if (override && override.trim()) return override.trim();
  return path.join(os.homedir(), ".agentic-os", "ws-secret");
}

/** 32 random bytes (hex), created ONCE and reused forever after. */
export function readOrCreateBootSalt(): string {
  const p = wsSecretPath();
  try {
    const existing = fs.readFileSync(p, "utf8").trim();
    if (existing) return existing;
  } catch {
    /* missing — create below */
  }
  const salt = randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, salt, "utf8");
  return salt;
}

/** null = fail-closed (AGENTOS_PASSWORD unset). Recomputed per call — cheap
 *  sha256, and it keeps password/salt changes live without cache staleness. */
function ticketKey(): Buffer | null {
  const pw = process.env.AGENTOS_PASSWORD || "";
  if (!pw) return null;
  return createHash("sha256").update(pw + readOrCreateBootSalt()).digest();
}

export function mintTicket(
  session: string,
  ttlMs = TICKET_TTL_MS,
): { ticket: string; expiresAt: number } | { error: string } {
  if (!session) return { error: "session is required" };
  const key = ticketKey();
  if (!key) {
    return {
      error:
        "AGENTOS_PASSWORD is not set — the WS bridge is fail-closed without it (set it in .env.local and restart).",
    };
  }
  const exp = Date.now() + ttlMs;
  const payloadB64 = Buffer.from(JSON.stringify({ sid: session, exp }), "utf8").toString(
    "base64url",
  );
  const sigB64 = createHmac("sha256", key).update(payloadB64).digest("base64url");
  return { ticket: `${payloadB64}.${sigB64}`, expiresAt: exp };
}

/**
 * Constant-time verify, bound to ONE session; +5s skew on expiry. Every failure
 * mode returns false (never throws) — the bridge maps false → close 4400.
 */
export function verifyTicket(rawTicket: string | undefined, sessionId: string): boolean {
  if (!rawTicket || !sessionId) return false;
  const key = ticketKey();
  if (!key) return false; // fail-closed

  const dot = rawTicket.indexOf(".");
  if (dot <= 0 || dot === rawTicket.length - 1) return false;
  const payloadB64 = rawTicket.slice(0, dot);
  const sigB64 = rawTicket.slice(dot + 1);

  const expected = createHmac("sha256", key).update(payloadB64).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(sigB64, "base64url");
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  if (!timingSafeEqual(provided, expected)) return false;

  let payload: { sid?: unknown; exp?: unknown };
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as typeof payload;
  } catch {
    return false;
  }
  if (typeof payload.sid !== "string" || typeof payload.exp !== "number") return false;
  if (payload.sid !== sessionId) return false;
  if (payload.exp + SKEW_MS < Date.now()) return false;

  return true;
}
