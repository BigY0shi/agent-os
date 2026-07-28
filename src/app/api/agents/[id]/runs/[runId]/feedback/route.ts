import { NextResponse } from "next/server";
import { safeId, saveFeedback } from "@/lib/agentsStore";
import { startCurator } from "@/lib/agentsRuntime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/agents/<id>/runs/<runId>/feedback — { verdict: "up"|"down", comment? }
// Stores the feedback and fires a curator pass that weighs it.
export async function POST(req: Request, ctx: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await ctx.params;
  const agentId = safeId(id), rid = safeId(runId);
  if (!agentId || !rid) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const body = await req.json().catch(() => null) as { verdict?: string; comment?: string } | null;
  if (!body || !["up", "down"].includes(body.verdict ?? "")) {
    return NextResponse.json({ error: "verdict up|down required" }, { status: 400 });
  }
  const fb = { verdict: body.verdict as "up" | "down", comment: body.comment?.trim() || undefined };
  await saveFeedback(agentId, rid, fb);
  const res = await startCurator(agentId, rid, fb);
  return NextResponse.json({ ok: true, curator: res });
}
