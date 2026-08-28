import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ensureV2 } from "@/lib/v2/boot";
import { handleMcpMessage } from "@/lib/v2/mcp/server";
import { readSettings, writeSettings } from "@/lib/settings";
import {
  SESSION_COOKIE,
  ensureSessionSecret,
  legacyCookieAccepted,
  verifySessionToken,
} from "@/lib/authSessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * F4 internal MCP endpoint (stateless Streamable HTTP, JSON responses).
 * Auth (CONVENTIONS §9.1): a valid x-agentos-mcp-secret header OR a valid
 * dashboard session cookie. Either way the capability gates run in strict
 * mode — through MCP, exec/files are deny-by-default until opted in.
 */

const SECRET_HEADER = "x-agentos-mcp-secret";
const COOKIE = SESSION_COOKIE;

function getOrCreateSecret(): string {
  const existing = readSettings().mcp?.secret;
  if (existing) return existing;
  const secret = "amcp_" + randomBytes(24).toString("hex");
  writeSettings({ mcp: { secret } });
  return secret;
}

// Constant-time string compare: hash both sides so neither content nor length
// leaks through timing (a bare === exits early on the first differing char).
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

// Item 13: the session cookie is a signed token now (authSessions.ts); the
// legacy password-hash cookie is honored only inside the 7-day grace window.
function hasValidCookie(req: NextRequest): boolean {
  const password = process.env.AGENTOS_PASSWORD || "";
  if (!password) return false;
  const cookie = req.cookies.get(COOKIE)?.value;
  if (!cookie) return false;
  const secretFile = ensureSessionSecret();
  if (secretFile && verifySessionToken(cookie, secretFile.secret).valid) return true;
  return legacyCookieAccepted(cookie, password, secretFile);
}

function authenticate(req: NextRequest): { ok: boolean; status?: number; error?: string } {
  const provided = req.headers.get(SECRET_HEADER);
  const secret = getOrCreateSecret();
  if (provided) {
    if (safeEqual(provided, secret)) return { ok: true };
    return { ok: false, status: 401, error: "invalid MCP secret" };
  }
  if (hasValidCookie(req)) return { ok: true };
  return {
    ok: false,
    status: 401,
    error: `unauthorized: send the ${SECRET_HEADER} header (Settings → Capabilities shows the secret) or a dashboard session cookie`,
  };
}

export async function POST(req: NextRequest) {
  ensureV2();
  const auth = authenticate(req);
  if (!auth.ok) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32000, message: auth.error } },
      { status: auth.status, headers: { "cache-control": "no-store" } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  // ?source= is observability tagging, never trust. 'human-gate' is reserved:
  // it is the approved-execution bypass source produced only by
  // approvals.resolveApproval (strict refuses destructive calls before the
  // bypass check, so this is defense-in-depth, not the primary guard).
  const rawSource = req.nextUrl.searchParams.get("source") ?? "unknown";
  const source = rawSource === "human-gate" ? "mcp:spoofed-human-gate" : rawSource;
  const remoteAddr =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
  const ctx = { source, strict: true, remoteAddr };

  const messages = Array.isArray(body) ? body : [body];
  const responses = [];
  for (const msg of messages) {
    const res = await handleMcpMessage(msg as Record<string, unknown>, ctx);
    if (res) responses.push(res);
  }

  if (responses.length === 0) {
    return new Response(null, { status: 202, headers: { "cache-control": "no-store" } });
  }
  return NextResponse.json(Array.isArray(body) ? responses : responses[0], {
    headers: { "cache-control": "no-store" },
  });
}

const METHOD_NOT_ALLOWED = NextResponse.json(
  {
    jsonrpc: "2.0",
    id: null,
    error: { code: -32000, message: "stateless server: POST only (no SSE stream, no sessions)" },
  },
  { status: 405, headers: { "cache-control": "no-store", allow: "POST" } },
);

export async function GET() {
  return METHOD_NOT_ALLOWED;
}

export async function DELETE() {
  return METHOD_NOT_ALLOWED;
}
