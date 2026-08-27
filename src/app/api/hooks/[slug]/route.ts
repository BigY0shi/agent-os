import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { getConnector } from "@/lib/v2/integrations/registry";
import { checkWebhookSecret, dispatchWebhook } from "@/lib/v2/integrations/webhooks";

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
 *  3. secret gate: x-hook-secret must equal the definition's webhookSecret
 *     (unconfigured = fail closed) → 401;
 *  4. fire-and-forget dispatch (IDENTIFY → accounts → PROCESS), respond 200
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

  // (3) Secret gate.
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  if (!checkWebhookSecret(slug, headers)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, ...noStore });
  }

  // (4) Fire-and-forget; always-200.
  let body: unknown = null;
  try {
    body = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    body = null;
  }
  void dispatchWebhook(slug, { headers, body, rawBody }).catch((err) => {
    console.error(`[api/hooks] ${slug} dispatch failed:`, err);
  });
  return NextResponse.json({ ok: true }, noStore);
}
