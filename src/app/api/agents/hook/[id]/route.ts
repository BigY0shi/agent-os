import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { loadAgent, safeId } from "@/lib/agentsStore";
import { startRun } from "@/lib/agentsRuntime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/agents/hook/<id> — external webhook trigger. This path is exempt
// from the LAN password gate (see src/proxy.ts): the per-agent secret in the
// x-agent-secret header IS the auth. The request body is handed to the run as
// the trigger payload.

function secretsMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = safeId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const agent = await loadAgent(id);
  if (!agent) return NextResponse.json({ error: "not found" }, { status: 404 });

  const hook = agent.triggers.find((t) => t.type === "webhook");
  if (!hook || hook.type !== "webhook") return NextResponse.json({ error: "agent has no webhook trigger" }, { status: 404 });

  const given = req.headers.get("x-agent-secret") ?? "";
  if (!hook.secret || !given || !secretsMatch(given, hook.secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const raw = await req.text().catch(() => "");
  const payload = raw.slice(0, 4000);
  const res = await startRun(agent, "webhook", payload ? `Webhook payload:\n${payload}` : undefined);
  if ("error" in res) return NextResponse.json(res, { status: 409 });
  return NextResponse.json(res);
}
