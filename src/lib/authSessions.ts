import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * HARDENING-2026-08-27 item 13 — session tokens for the LAN gate.
 *
 * BEFORE: the agentos_session cookie was sha256("agentos.v1:" + password) — a
 * DETERMINISTIC password hash. Theft meant indefinite replay (no expiry, no
 * rotation) and handed the thief an offline dictionary oracle against the
 * password itself.
 *
 * NOW: login mints a random signed token `v2.<id>.<exp>.<sig>` where
 *   id  = 16 random bytes (base64url) — no relation to the password,
 *   exp = unix seconds, 30-day lifetime,
 *   sig = HMAC-SHA256(boot secret, `<id>.<exp>`) (base64url).
 * The proxy validates statelessly and slides the expiry (re-mints when less
 * than half the lifetime remains). Nothing derived from the password ever
 * rides in the cookie.
 *
 * LANE CHOICE (per the backlog's own escape hatch): the stateless HMAC token,
 * NOT a DB-backed sessions table — src/proxy.ts is bundled separately by Next
 * 16 and pulling the native better-sqlite3 driver (db.ts) into the proxy
 * bundle is unproven there, plus it would put a synchronous DB hit on every
 * request. The boot secret lives in ~/.agentic-os/session-secret.json
 * (override: AGENTIC_OS_SESSION_SECRET_FILE for smokes) — node:fs works fine
 * in the Node-runtime proxy, and the file is read once per process.
 *
 * GRACE: the old deterministic hash cookie stays accepted for 7 days from the
 * secret file's creation (`legacyAcceptUntil` inside the file) so existing
 * signed-in sessions survive the deploy; a legacy cookie is upgraded to a
 * signed token on first sight. After the window, legacy cookies 401 and the
 * user signs in again.
 */

export const SESSION_COOKIE = "agentos_session";
export const SESSION_TTL_S = 30 * 24 * 60 * 60; // 30 days
const LEGACY_GRACE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface SecretFile {
  secret: string; // 32-byte hex
  legacyAcceptUntil: string; // ISO
}

function secretFilePath(): string {
  const override = process.env.AGENTIC_OS_SESSION_SECRET_FILE;
  if (override && override.trim()) return override.trim();
  return path.join(os.homedir(), ".agentic-os", "session-secret.json");
}

let cached: SecretFile | null = null;
let cachedPath: string | null = null;

/** Read (or create) the boot secret. Returns null only when the fs fails. */
export function ensureSessionSecret(): SecretFile | null {
  const file = secretFilePath();
  if (cached && cachedPath === file) return cached;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<SecretFile>;
    if (typeof raw.secret === "string" && raw.secret.length >= 32) {
      cached = {
        secret: raw.secret,
        legacyAcceptUntil:
          typeof raw.legacyAcceptUntil === "string" ? raw.legacyAcceptUntil : new Date(0).toISOString(),
      };
      cachedPath = file;
      return cached;
    }
  } catch {
    /* absent/corrupt → create below */
  }
  try {
    const fresh: SecretFile = {
      secret: randomBytes(32).toString("hex"),
      legacyAcceptUntil: new Date(Date.now() + LEGACY_GRACE_MS).toISOString(),
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(fresh, null, 2), "utf8");
    cached = fresh;
    cachedPath = file;
    return fresh;
  } catch (err) {
    console.error("[auth] could not create session secret file — legacy cookie lane only:", err);
    return null;
  }
}

/** Test helper: drop the in-process cache. */
export function __resetSessionSecretCacheForTests(): void {
  cached = null;
  cachedPath = null;
}

function sign(secret: string, idAndExp: string): string {
  return createHmac("sha256", secret).update(idAndExp).digest("base64url");
}

/** Mint a fresh signed session token (30-day expiry). */
export function mintSessionToken(secret: string): string {
  const id = randomBytes(16).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_S;
  return `v2.${id}.${exp}.${sign(secret, `${id}.${exp}`)}`;
}

export interface SessionTokenCheck {
  valid: boolean;
  /** Set when valid and less than half the lifetime remains — re-mint. */
  shouldRefresh: boolean;
}

/** Stateless validation: shape, signature (timing-safe), expiry. */
export function verifySessionToken(token: string, secret: string): SessionTokenCheck {
  const no = { valid: false, shouldRefresh: false };
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v2") return no;
  const [, id, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!id || !sig || !Number.isFinite(exp)) return no;
  const expected = sign(secret, `${id}.${exp}`);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return no;
  const nowS = Math.floor(Date.now() / 1000);
  if (exp <= nowS) return no;
  return { valid: true, shouldRefresh: exp - nowS < SESSION_TTL_S / 2 };
}

/** The OLD deterministic cookie value (kept for the 7-day grace lane only). */
export function legacyToken(password: string): string {
  return createHash("sha256").update("agentos.v1:" + password).digest("hex");
}

/** Timing-safe legacy-cookie check, honored only inside the grace window. */
export function legacyCookieAccepted(cookie: string, password: string, file: SecretFile | null): boolean {
  if (!password) return false;
  const deadline = file ? Date.parse(file.legacyAcceptUntil) : Number.POSITIVE_INFINITY;
  // No secret file (fs failure) → legacy lane stays open, loudly logged in
  // ensureSessionSecret — availability over lockout on a broken fs.
  if (Number.isFinite(deadline) && Date.now() > deadline) return false;
  const a = createHash("sha256").update(cookie).digest();
  const b = createHash("sha256").update(legacyToken(password)).digest();
  return timingSafeEqual(a, b);
}
