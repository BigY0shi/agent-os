import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { WebmcpError } from "@/lib/v2/webmcp/store";
import { emitDraft } from "@/lib/v2/webmcp/wizard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

function errResponse(err: unknown) {
  const status = err instanceof WebmcpError ? err.status : 500;
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status, ...noStore });
}

/**
 * POST /api/v2/webmcp/wizard/[id]/emit → { draft }
 * S7 step 4: ONLY on an approved draft (409 otherwise) the agent emits the JSON spec;
 * validateWizardSpec() gates it (422 with the problems; the draft stays approved so
 * the user can retry or edit the list).
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  ensureV2();
  try {
    return NextResponse.json({ draft: await emitDraft((await ctx.params).id) }, noStore);
  } catch (err) {
    return errResponse(err);
  }
}
