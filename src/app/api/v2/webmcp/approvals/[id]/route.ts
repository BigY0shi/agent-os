import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { getApproval, resolveApproval, toPublicApproval } from "@/lib/v2/webmcp/approvals";
import { WebmcpError } from "@/lib/v2/webmcp/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

function errResponse(err: unknown) {
  const status = err instanceof WebmcpError ? err.status : 500;
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status, ...noStore });
}

/** GET /api/v2/webmcp/approvals/[id] → { approval } (redacted args only). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  ensureV2();
  const { id } = await ctx.params;
  const approval = getApproval(id);
  if (!approval) return NextResponse.json({ error: "approval not found" }, { status: 404, ...noStore });
  return NextResponse.json({ approval: toPublicApproval(approval) }, noStore);
}

/**
 * POST /api/v2/webmcp/approvals/[id] { action: 'approve' | 'deny' }
 *  - approve EXECUTES the tool now (published lane, source 'human-gate'),
 *    stores the result on the record and returns it;
 *  - deny resolves without execution;
 *  - 410 expired · 409 already resolved · 404 unknown.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  ensureV2();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
  const action = body?.action;
  if (action !== "approve" && action !== "deny") {
    return NextResponse.json({ error: "body needs { action: 'approve' | 'deny' }" }, { status: 400, ...noStore });
  }
  try {
    const { approval, result } = await resolveApproval(id, action);
    return NextResponse.json({ approval: toPublicApproval(approval), result }, noStore);
  } catch (err) {
    return errResponse(err);
  }
}
