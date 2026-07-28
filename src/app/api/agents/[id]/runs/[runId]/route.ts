import { NextResponse } from "next/server";
import { safeId } from "@/lib/agentsStore";
import { getRun, killRun } from "@/lib/agentsRuntime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/agents/<id>/runs/<runId>?after=<seq> — poll transcript events.
export async function GET(req: Request, ctx: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await ctx.params;
  const agentId = safeId(id), rid = safeId(runId);
  if (!agentId || !rid) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const after = Number(new URL(req.url).searchParams.get("after") ?? -1);
  const run = await getRun(agentId, rid, Number.isFinite(after) ? after : -1);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(run);
}

// DELETE /api/agents/<id>/runs/<runId> — kill switch.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; runId: string }> }) {
  const { runId } = await ctx.params;
  const rid = safeId(runId);
  if (!rid) return NextResponse.json({ error: "bad id" }, { status: 400 });
  return NextResponse.json({ ok: killRun(rid) });
}
