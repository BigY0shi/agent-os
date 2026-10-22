import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { WebmcpError } from "@/lib/v2/webmcp/store";
import { getDraft, updateDraft, approveDraft, reopenDraft, discardDraft, type DraftPatch } from "@/lib/v2/webmcp/wizard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

function errResponse(err: unknown) {
  const status = err instanceof WebmcpError ? err.status : 500;
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status, ...noStore });
}

/** GET /api/v2/webmcp/wizard/[id] → { draft } | 404. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  ensureV2();
  const draft = getDraft((await ctx.params).id);
  if (!draft) return NextResponse.json({ error: "wizard draft not found" }, { status: 404, ...noStore });
  return NextResponse.json({ draft }, noStore);
}

/**
 * PATCH /api/v2/webmcp/wizard/[id]
 *   { description?, answers?: { [questionId]: string }, proposal?, ownSpecText? }  edits between model calls
 *   { action: "approve", proposal? }   S7 step 3 — approve (optionally edited) list; emits NOTHING
 *   { action: "reopen" }               back to editing the list
 *   { action: "discard" }              archive the draft (never deleted)
 * → { draft } | 400 bad proposal | 404 | 409 wrong step.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  ensureV2();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "body must be a JSON object" }, { status: 400, ...noStore });
  try {
    const action = typeof body.action === "string" ? body.action : "";
    if (action === "approve") return NextResponse.json({ draft: approveDraft(id, body.proposal) }, noStore);
    if (action === "reopen") return NextResponse.json({ draft: reopenDraft(id) }, noStore);
    if (action === "discard") return NextResponse.json({ draft: discardDraft(id) }, noStore);
    if (action) return NextResponse.json({ error: `unknown action '${action}'` }, { status: 400, ...noStore });
    const patch: DraftPatch = {};
    if (typeof body.description === "string") patch.description = body.description;
    if (body.answers && typeof body.answers === "object" && !Array.isArray(body.answers)) {
      patch.answers = Object.fromEntries(
        Object.entries(body.answers as Record<string, unknown>).filter(([, v]) => typeof v === "string"),
      ) as Record<string, string>;
    }
    if (body.proposal !== undefined) patch.proposal = body.proposal;
    if (typeof body.ownSpecText === "string") patch.ownSpecText = body.ownSpecText;
    return NextResponse.json({ draft: updateDraft(id, patch) }, noStore);
  } catch (err) {
    return errResponse(err);
  }
}
