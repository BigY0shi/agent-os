import { NextResponse } from "next/server";
import { exileAgent, listRuns, loadAgent, readSystemPrompt, safeId, saveAgent, writeSystemPrompt } from "@/lib/agentsStore";
import { agentHasActiveRun } from "@/lib/agentsRuntime";
import type { AgentDef, AgentLifecycle, AgentPersona, AgentProvider } from "@/lib/agentsTypes";
import { AGENT_LIFECYCLES, effectiveLifecycle, hasSuccessfulRun } from "@/lib/v2/agents/lifecycle";

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

  // ── SPEC-E F1.1 V2 fields (all optional; validated, never trusted raw) ─────
  if (body.lifecycle !== undefined) {
    if (!(AGENT_LIFECYCLES as readonly string[]).includes(String(body.lifecycle))) {
      return NextResponse.json({ error: `unknown lifecycle "${body.lifecycle}"` }, { status: 400 });
    }
    const to = body.lifecycle as AgentLifecycle;
    // F1.2 deploy guard: promoting INTO deployed requires ≥1 successful run.
    if (to === "deployed" && effectiveLifecycle(agent) !== "deployed") {
      if (!(await hasSuccessfulRun(id))) {
        return NextResponse.json(
          { error: "deploy requires at least one successful (done) run — run the agent in Test first" },
          { status: 409 },
        );
      }
    }
    patch.lifecycle = to;
  }
  if (body.harnessId !== undefined) {
    if (body.harnessId !== null && typeof body.harnessId !== "string") {
      return NextResponse.json({ error: "harnessId must be a string or null" }, { status: 400 });
    }
    patch.harnessId = body.harnessId ? body.harnessId.trim().slice(0, 60) : undefined;
  }
  if (body.persona !== undefined) {
    if (body.persona === null) patch.persona = undefined;
    else {
      const p = body.persona as AgentPersona;
      if (typeof p !== "object" || typeof p.name !== "string" || typeof p.voiceRules !== "string" || !Array.isArray(p.bannedPhrases ?? [])) {
        return NextResponse.json({ error: "persona needs { name, voiceRules, bannedPhrases[] }" }, { status: 400 });
      }
      patch.persona = {
        name: p.name.trim().slice(0, 80),
        voiceRules: p.voiceRules.slice(0, 4000),
        audience: typeof p.audience === "string" ? p.audience.slice(0, 400) : undefined,
        bannedPhrases: (p.bannedPhrases ?? []).filter((s): s is string => typeof s === "string").slice(0, 100),
        ctaStyle: typeof p.ctaStyle === "string" ? p.ctaStyle.slice(0, 400) : undefined,
      };
    }
  }
  const strArray = (v: unknown): string[] | null =>
    Array.isArray(v) && v.every((s) => typeof s === "string") ? (v as string[]).slice(0, 100) : null;
  if (body.toolIds !== undefined) {
    const a = strArray(body.toolIds);
    if (!a) return NextResponse.json({ error: "toolIds must be a string array" }, { status: 400 });
    patch.toolIds = a;
  }
  if (body.connectorIds !== undefined) {
    const a = strArray(body.connectorIds);
    if (!a) return NextResponse.json({ error: "connectorIds must be a string array" }, { status: 400 });
    patch.connectorIds = a;
  }
  if (body.browserSessions !== undefined) {
    const a = strArray(body.browserSessions);
    if (!a) return NextResponse.json({ error: "browserSessions must be a string array" }, { status: 400 });
    patch.browserSessions = a;
  }
  if (body.provider !== undefined) {
    if (body.provider === null) patch.provider = undefined;
    else {
      const pv = body.provider as AgentProvider;
      const valid =
        pv?.kind === "sdk" ||
        (pv?.kind === "cli" && typeof (pv as { agent?: unknown }).agent === "string" && (pv as { agent: string }).agent.trim()) ||
        (pv?.kind === "ollama" && typeof (pv as { model?: unknown }).model === "string" && (pv as { model: string }).model.trim());
      if (!valid) {
        return NextResponse.json(
          { error: 'provider must be {kind:"sdk"} | {kind:"cli",agent} | {kind:"ollama",model}' },
          { status: 400 },
        );
      }
      patch.provider = pv;
    }
  }

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
