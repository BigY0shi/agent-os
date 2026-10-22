import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { WebmcpError } from "@/lib/v2/webmcp/store";
import { applyDraft } from "@/lib/v2/webmcp/wizard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

function errResponse(err: unknown) {
  const status = err instanceof WebmcpError ? err.status : 500;
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status, ...noStore });
}

/**
 * POST /api/v2/webmcp/wizard/[id]/apply { slug? } → { draft, slug }
 * Turns the validated spec (emitted, or the proofread own-mode JSON) into a draft
 * package + tool set in the builder. 409 slug taken / nothing emitted yet.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  ensureV2();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    const slug = typeof body?.slug === "string" && body.slug.trim() ? body.slug : undefined;
    return NextResponse.json(applyDraft((await ctx.params).id, { slug }), noStore);
  } catch (err) {
    return errResponse(err);
  }
}
