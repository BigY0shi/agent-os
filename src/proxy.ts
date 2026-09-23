import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  SESSION_COOKIE as COOKIE,
  SESSION_TTL_S,
  ensureSessionSecret,
  legacyCookieAccepted,
  mintSessionToken,
  verifySessionToken,
} from "@/lib/authSessions";

// LAN access gate. Next 16 renamed `middleware` → `proxy` (Node.js runtime by default,
// so process.env + node:crypto/node:fs are available). This runs before every route and
// blocks anyone without a valid session cookie — because the dashboard can drive the
// user's authed CLI agents, read the vault, and run commands, so a LAN-exposed instance
// MUST be gated. Password lives in AGENTOS_PASSWORD (.env.local).
//
// HARDENING-2026-08-27 item 13: the cookie is now a RANDOM signed session token
// (30-day expiry, sliding refresh) minted at login — no longer a deterministic
// password hash (theft = indefinite replay + offline dictionary oracle). The old
// hash cookie stays accepted for 7 days from deploy (grace, upgraded on sight)
// so existing sessions survive. See src/lib/authSessions.ts for the lane choice
// (stateless HMAC vs DB-backed) rationale.

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always let the login screen, the auth API, and framework/static assets through.
  // Agent webhooks are also exempt: external systems can't hold a session cookie,
  // and the route enforces its own per-agent secret (x-agent-secret header).
  // /api/hooks/ (SPEC-D §5.9 integration webhooks) follows the same pattern:
  // the route enforces its own per-definition secret (x-hook-secret header /
  // connector HMAC) and answers 200-empty for unknown slugs.
  if (
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/agents/hook/") ||
    pathname.startsWith("/api/hooks/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt"
  ) {
    return NextResponse.next();
  }

  // /api/mcp: NOT blanket-exempt (CONVENTIONS §9.1). Requests carrying the MCP
  // secret header pass through for the ROUTE to validate strictly (401 on
  // mismatch); cookie-holders fall through to the normal session check below.
  if (pathname.startsWith("/api/mcp") && request.headers.has("x-agentos-mcp-secret")) {
    return NextResponse.next();
  }

  // Jarvis OS-global hotkey (SPEC-C C2): the AutoHotkey helper can't hold a
  // session cookie. POSTs carrying the hotkey secret header pass through for
  // the ROUTE to validate strictly (timing-safe compare, 401 on mismatch) —
  // same pattern as /api/mcp above. GET, /stream and /setup stay cookie-gated.
  if (
    pathname === "/api/jarvis/hotkey" &&
    request.method === "POST" &&
    request.headers.has("x-agentos-hotkey-secret")
  ) {
    return NextResponse.next();
  }

  // Even Realities G2 custom agent (/api/glasses): the Even app sends a Bearer
  // token, never a cookie. Requests carrying an Authorization header pass
  // through for the ROUTE to validate (sha256 + timing-safe compare, 401 on
  // mismatch, 403 while the lane is switched off). /api/v2/jarvis/glasses (the
  // settings side) is a different prefix and stays cookie-gated.
  if (
    (pathname === "/api/glasses" || pathname.startsWith("/api/glasses/")) &&
    request.headers.has("authorization")
  ) {
    return NextResponse.next();
  }

  const password = process.env.AGENTOS_PASSWORD || "";
  const isApi = pathname.startsWith("/api/");

  // Fail CLOSED if no password is configured — the gate is meant to be on.
  if (!password) {
    if (isApi) return NextResponse.json({ error: "Dashboard locked: set AGENTOS_PASSWORD in .env.local and restart." }, { status: 503 });
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("err", "unset");
    return NextResponse.redirect(url);
  }

  const cookie = request.cookies.get(COOKIE)?.value;
  if (cookie) {
    const secretFile = ensureSessionSecret();
    const setCookie = (res: NextResponse, value: string) => {
      res.cookies.set(COOKIE, value, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: false, // LAN is plain http; Secure would drop the cookie
        maxAge: SESSION_TTL_S,
      });
      return res;
    };
    if (secretFile) {
      const check = verifySessionToken(cookie, secretFile.secret);
      if (check.valid) {
        const res = NextResponse.next();
        // Sliding refresh: re-mint when less than half the lifetime remains.
        return check.shouldRefresh ? setCookie(res, mintSessionToken(secretFile.secret)) : res;
      }
    }
    // Grace lane: the pre-hardening deterministic hash cookie, accepted for 7
    // days from the secret file's creation — upgraded to a signed token here.
    if (legacyCookieAccepted(cookie, password, secretFile)) {
      const res = NextResponse.next();
      return secretFile ? setCookie(res, mintSessionToken(secretFile.secret)) : res;
    }
  }

  // Not authenticated.
  if (isApi) return NextResponse.json({ error: "Unauthorized — sign in to Agent OS." }, { status: 401 });
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  if (pathname !== "/") url.searchParams.set("from", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except framework internals + static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
