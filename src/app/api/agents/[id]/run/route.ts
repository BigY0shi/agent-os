import { NextResponse } from "next/server";
import { loadAgent, safeId } from "@/lib/agentsStore";
import { startRun } from "@/lib/agentsRuntime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/agents/<id>/run — manual trigger. { note?: string }
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = safeId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const agent = await loadAgent(id);
  if (!agent) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({})) as { note?: string };
  const res = await startRun(agent, "manual", body.note?.trim() ? `User note for this run: ${body.note.trim()}` : undefined);
  if ("error" in res) return NextResponse.json(res, { status: 409 });
  return NextResponse.json(res);
}
