import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { getConnector } from "@/lib/v2/integrations/registry";
import { verifyWebhookRequest, dispatchWebhook } from "@/lib/v2/integrations/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

type Ctx = { params: Promise<{ slug: string }> };

/**
 * POST /api/hooks/[slug] (SPEC-D §5.9) — external webhook receiver. Exempted
 * from the session-cookie gate in src/proxy.ts (external systems can't hold a
 * cookie); the secret gate below is the auth. Flow:
 *  1. read req.text() RAW FIRST — future HMAC verification (Slack v0 signing,
 *     G3.6) must run over the raw bytes, never a re-serialized parse (§8.6);
 *  2. unknown slug → 200 empty (don't leak which hooks exist);
 *  3. verification: a connector's verifyWebhook (Slack v0 signing-secret HMAC
 *     over the RAW body, G3.6) or the generic x-hook-secret gate
 *     (unconfigured = fail closed) → 401. Verification runs BEFORE any
 *     parse-derived data is trusted (§8.6);
 *  4. provider handshakes (Slack url_verification) answered INLINE (§5.9
 *     item 3) — after verification, before dispatch;
 *  5. fire-and-forget dispatch (IDENTIFY → accounts → PROCESS), respond 200
 *     immediately (upstream always-200 contract).
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  ensureV2();
  const { slug } = await ctx.params;

  // (1) RAW body first — before any parsing.
  const rawBody = await req.text();

  // (2) Unknown slug → 200 empty.
  const connector = getConnector(slug);
  if (!connector || !connector.identify || !connector.process) {
    return NextResponse.json({}, noStore);
  }

  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  let body: unknown = null;
  try {
    body = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    body = null;
  }
  const webhook = { headers, body, rawBody };

  // (3) Verification (raw-body HMAC or header secret) — BEFORE trusting the parse.
  if (!verifyWebhookRequest(slug, webhook)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, ...noStore });
  }

  // (4) Provider handshake (e.g. Slack url_verification) → inline echo, no dispatch.
  const challenge = connector.webhookChallenge?.(webhook);
  if (challenge) {
    return NextResponse.json(challenge, noStore);
  }

  // (5) Fire-and-forget; always-200.
  void dispatchWebhook(slug, webhook).catch((err) => {
    console.error(`[api/hooks] ${slug} dispatch failed:`, err);
  });
  return NextResponse.json({ ok: true }, noStore);
}
