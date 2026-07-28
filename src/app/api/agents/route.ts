import { NextResponse } from "next/server";
import { createAgent, listAgents, listRuns } from "@/lib/agentsStore";
import { agentHasActiveRun } from "@/lib/agentsRuntime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/agents — all agents + their latest run, for the card grid.
export async function GET() {
  const agents = await listAgents();
  const withRuns = await Promise.all(agents.map(async (a) => ({
    ...a,
    lastRun: (await listRuns(a.id, 1))[0] ?? null,
    active: agentHasActiveRun(a.id),
  })));
  return NextResponse.json({ agents: withRuns });
}

// POST /api/agents — create. { name, instructions, description?, permissionMode?, intelligence? }
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as {
    name?: string; instructions?: string; description?: string;
    permissionMode?: "bypass" | "gated" | "ask";
    intelligence?: "fast" | "standard" | "deep";
  } | null;
  if (!body?.name?.trim() || !body?.instructions?.trim()) {
    return NextResponse.json({ error: "name and instructions are required" }, { status: 400 });
  }
  const def = await createAgent({
    name: body.name,
    description: body.description,
    instructions: body.instructions,
    permissionMode: body.permissionMode,
    intelligence: body.intelligence,
  });
  return NextResponse.json({ agent: def });
}
