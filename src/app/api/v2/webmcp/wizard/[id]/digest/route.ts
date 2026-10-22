import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { WebmcpError } from "@/lib/v2/webmcp/store";
import { digestDraft } from "@/lib/v2/webmcp/wizard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

function errResponse(err: unknown) {
  const status = err instanceof WebmcpError ? err.status : 500;
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status, ...noStore });
}

/**
 * POST /api/v2/webmcp/wizard/[id]/digest → { draft }
 * S7 step 2: the gear's agent reads the description (+ any answers) and returns
 * clarifying questions and a proposed tool list. No code, no JSON spec yet.
 * 502 when the agent (and the owner-chosen fallback) fail — the reply labels who answered.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  ensureV2();
  try {
    return NextResponse.json({ draft: await digestDraft((await ctx.params).id) }, noStore);
  } catch (err) {
    return errResponse(err);
  }
}
