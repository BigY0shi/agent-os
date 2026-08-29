import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { handleCallback } from "@/lib/v2/integrations/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v2/integrations/oauth/callback — provider redirect target (§5.3).
 * Pops the state row (one-shot, 15-min TTL), exchanges the code, runs the
 * connector's setup, upserts the account, then bounces the browser back to the
 * app (?connected=<slug> | ?error=<msg>). Sits BEHIND the cookie gate — the
 * user's own browser carries the session cookie, so no proxy exemption
 * (SPEC-D §5.3).
 */
export async function GET(req: NextRequest) {
  ensureV2();
  const params: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  const outcome = await handleCallback(params);
  return NextResponse.redirect(new URL(outcome.redirect, req.nextUrl.origin), {
    headers: { "cache-control": "no-store" },
  });
}
