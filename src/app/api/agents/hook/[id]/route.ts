import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { loadAgent, safeId } from "@/lib/agentsStore";
import { startRun } from "@/lib/agentsRuntime";
import { lifecycleAllowsTriggers } from "@/lib/v2/agents/lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/agents/hook/<id> — external webhook trigger. This path is exempt
// from the LAN password gate (see src/proxy.ts): the per-agent secret in the
// x-agent-secret header IS the auth. The request body is handed to the run as
// the trigger payload.

// Hash both sides so neither content nor length leaks through timing — the
// house pattern set by the hardening pass (see api/mcp/route.ts safeEqual).
function secretsMatch(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
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

  // Lifecycle gate (Yoshi, 2026-08-28): webhooks obey the same skip set as the
  // scheduled trigger tick — an agent in ideation/forge/test/retired does not
  // fire. Checked AFTER the secret so an unauthenticated caller cannot probe an
  // agent's lifecycle by reading the status code.
  if (!lifecycleAllowsTriggers(agent)) {
    return NextResponse.json(
      { error: `agent lifecycle "${agent.lifecycle ?? "deployed"}" does not fire triggers — deploy it first` },
      { status: 403 },
    );
  }

  const raw = await req.text().catch(() => "");
  const payload = raw.slice(0, 4000);
  const res = await startRun(agent, "webhook", payload ? `Webhook payload:\n${payload}` : undefined);
  if ("error" in res) return NextResponse.json(res, { status: 409 });
  return NextResponse.json(res);
}
