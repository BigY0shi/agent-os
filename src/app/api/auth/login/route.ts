import { cookies } from "next/headers";
import { createHash, timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE = "agentos_session";

function token(pw: string): string {
  return createHash("sha256").update("agentos.v1:" + pw).digest("hex");
}

// POST { password } → sets the session cookie if it matches AGENTOS_PASSWORD.
export async function POST(req: Request) {
  let body: { password?: string };
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: "bad request" }, { status: 400 }); }

  const provided = String(body?.password ?? "");
  const expected = process.env.AGENTOS_PASSWORD || "";
  if (!expected) {
    return Response.json({ ok: false, error: "Dashboard password isn't configured. Set AGENTOS_PASSWORD in .env.local and restart." }, { status: 503 });
  }

  // constant-time compare on the hashes (equal length, no early-exit timing leak)
  const a = Buffer.from(token(provided));
  const b = Buffer.from(token(expected));
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return Response.json({ ok: false, error: "Wrong password." }, { status: 401 });
  }

  const c = await cookies();
  c.set(COOKIE, token(expected), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: false, // LAN is plain http; Secure would drop the cookie
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return Response.json({ ok: true });
}
