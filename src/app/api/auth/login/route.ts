import { cookies } from "next/headers";
import { timingSafeEqual, createHash } from "node:crypto";
import {
  SESSION_COOKIE as COOKIE,
  SESSION_TTL_S,
  ensureSessionSecret,
  legacyToken,
  mintSessionToken,
} from "@/lib/authSessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { password } → sets the session cookie if it matches AGENTOS_PASSWORD.
// HARDENING-2026-08-27 item 13: the cookie is a RANDOM signed session token
// (30-day expiry, sliding refresh in src/proxy.ts) — never a password hash.
export async function POST(req: Request) {
  let body: { password?: string };
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: "bad request" }, { status: 400 }); }

  const provided = String(body?.password ?? "");
  const expected = process.env.AGENTOS_PASSWORD || "";
  if (!expected) {
    return Response.json({ ok: false, error: "Dashboard password isn't configured. Set AGENTOS_PASSWORD in .env.local and restart." }, { status: 503 });
  }

  // constant-time compare on the hashes (equal length, no early-exit timing leak)
  const a = Buffer.from(createHash("sha256").update("login:" + provided).digest());
  const b = Buffer.from(createHash("sha256").update("login:" + expected).digest());
  if (!timingSafeEqual(a, b)) {
    return Response.json({ ok: false, error: "Wrong password." }, { status: 401 });
  }

  const secretFile = ensureSessionSecret();
  // Degraded lane (secret file unwritable — logged loudly inside
  // ensureSessionSecret): fall back to the legacy hash so login still works.
  const value = secretFile ? mintSessionToken(secretFile.secret) : legacyToken(expected);

  const c = await cookies();
  c.set(COOKIE, value, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: false, // LAN is plain http; Secure would drop the cookie
    maxAge: SESSION_TTL_S, // 30 days (proxy slides it)
  });
  return Response.json({ ok: true });
}
