import { NextResponse } from "next/server";
import { exileAgent, listRuns, loadAgent, readSystemPrompt, safeId, saveAgent, writeSystemPrompt } from "@/lib/agentsStore";
import { agentHasActiveRun } from "@/lib/agentsRuntime";
import type { AgentDef } from "@/lib/agentsTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/agents/<id> — full detail for the drawer.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = safeId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const agent = await loadAgent(id);
  if (!agent) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    agent,
    system: await readSystemPrompt(id),
    runs: await listRuns(id),
    active: agentHasActiveRun(id),
  });
}

// PATCH /api/agents/<id> — partial def update; `instructions` re-writes system.md.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = safeId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const agent = await loadAgent(id);
  if (!agent) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => null) as (Partial<AgentDef> & { instructions?: string }) | null;
  if (!body) return NextResponse.json({ error: "bad body" }, { status: 400 });

  if (typeof body.instructions === "string" && body.instructions.trim()) {
    await writeSystemPrompt(id, body.instructions);
  }
  const patch: Partial<AgentDef> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 80);
  if (typeof body.description === "string") patch.description = body.description.trim().slice(0, 200);
  if (body.permissionMode && ["bypass", "gated", "ask"].includes(body.permissionMode)) patch.permissionMode = body.permissionMode;
  if (body.intelligence && ["fast", "standard", "deep"].includes(body.intelligence)) patch.intelligence = body.intelligence;
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (Array.isArray(body.triggers)) patch.triggers = body.triggers;

  const next = { ...agent, ...patch };
  await saveAgent(next);
  return NextResponse.json({ agent: next });
}

// DELETE /api/agents/<id> — exile (house rule: never destroy).
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = safeId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
  if (agentHasActiveRun(id)) return NextResponse.json({ error: "kill the active run first" }, { status: 409 });
  const ok = await exileAgent(id);
  return NextResponse.json({ ok });
}
