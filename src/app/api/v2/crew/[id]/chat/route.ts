import { loadAgent, loadRunMeta, safeId } from "@/lib/agentsStore";
import { startRun } from "@/lib/agentsRuntime";
import { appendOwnerLine, chatFrom, readOwnerLines } from "@/lib/v2/crew/crew";
import type { RunMeta } from "@/lib/agentsTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/v2/crew/:id/chat           -> { agent, turns }   the drawer's conversation
// POST /api/v2/crew/:id/chat { text }  -> starts a real run of that agent with the message
// The owner's words are logged; every reply is read from its run's own record.
const noStore = { headers: { "Cache-Control": "no-store" } };

async function conversation(agentId: string) {
  const lines = readOwnerLines(agentId);
  const metas = new Map<string, RunMeta | null>();
  await Promise.all(lines.filter((l) => l.runId).map(async (l) => { metas.set(l.runId!, await loadRunMeta(agentId, l.runId!)); }));
  return chatFrom(lines, metas);
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = safeId((await ctx.params).id);
  if (!id) return Response.json({ error: "bad id" }, { status: 400, ...noStore });
  const agent = await loadAgent(id);
  if (!agent) return Response.json({ error: "no such agent" }, { status: 404, ...noStore });
  return Response.json({ agent: { id: agent.id, name: agent.name, description: agent.description, enabled: agent.enabled }, turns: await conversation(id) }, noStore);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = safeId((await ctx.params).id);
  if (!id) return Response.json({ error: "bad id" }, { status: 400, ...noStore });
  const agent = await loadAgent(id);
  if (!agent) return Response.json({ error: "no such agent" }, { status: 404, ...noStore });
  const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return Response.json({ error: "say something first" }, { status: 400, ...noStore });
  if (text.length > 8000) return Response.json({ error: "keep it under 8000 characters" }, { status: 400, ...noStore });
  const res = await startRun(agent, "crew-chat", `The owner is talking to you directly from the Crew chat. Reply to them. Their message:\n${text}`);
  if ("error" in res) {
    appendOwnerLine(id, { at: Date.now(), text, runId: null, error: res.error });
    return Response.json({ error: res.error, turns: await conversation(id) }, { status: 409, ...noStore });
  }
  appendOwnerLine(id, { at: Date.now(), text, runId: res.runId });
  return Response.json({ runId: res.runId, turns: await conversation(id) }, noStore);
}
