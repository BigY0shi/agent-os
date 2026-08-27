import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createHash } from "node:crypto";

// LAN access gate. Next 16 renamed `middleware` → `proxy` (Node.js runtime by default,
// so process.env + node:crypto are available). This runs before every route and blocks
// anyone without a valid session cookie — because the dashboard can drive the user's
// authed CLI agents, read the vault, and run commands, so a LAN-exposed instance MUST
// be gated. Password lives in AGENTOS_PASSWORD (.env.local); the cookie holds its hash.

const COOKIE = "agentos_session";

function token(pw: string): string {
  return createHash("sha256").update("agentos.v1:" + pw).digest("hex");
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always let the login screen, the auth API, and framework/static assets through.
  // Agent webhooks are also exempt: external systems can't hold a session cookie,
  // and the route enforces its own per-agent secret (x-agent-secret header).
  if (
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/agents/hook/") ||
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
  if (cookie && cookie === token(password)) {
    return NextResponse.next();
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
