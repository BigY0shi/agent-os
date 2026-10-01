import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { WebmcpError } from "@/lib/v2/webmcp/store";
import { proofreadDraft } from "@/lib/v2/webmcp/wizard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

function errResponse(err: unknown) {
  const status = err instanceof WebmcpError ? err.status : 500;
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status, ...noStore });
}

/**
 * POST /api/v2/webmcp/wizard/[id]/proofread { text? } → { draft }
 * Escape hatch: the agent only proofreads. Schema problems come back without a
 * model call; "looks good" only when the schema passes AND the agent found nothing.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  ensureV2();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    const text = typeof body?.text === "string" ? body.text : undefined;
    return NextResponse.json({ draft: await proofreadDraft((await ctx.params).id, text) }, noStore);
  } catch (err) {
    return errResponse(err);
  }
}
