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
    // The persist-credentials checkbox. Absent === false: an agent nobody was
    // asked about does not get a durable credential folder.
    persistCredentials?: boolean;
  } | null;
  if (!body?.name?.trim() || !body?.instructions?.trim()) {
    return NextResponse.json({ error: "name and instructions are required" }, { status: 400 });
  }
  const def = await createAgent({
    name: body.name,
    description: body.description,
    instructions: body.instructions,
    persistCredentials: body.persistCredentials === true,
    origin: "forge",
    permissionMode: body.permissionMode,
    intelligence: body.intelligence,
  });
  // A degraded creation is NOT a silent success. The agent exists and its files
  // are on disk, so this is not a 4xx — but the response says plainly that it
  // cannot browse yet and that the state is repairable, rather than leaving the
  // caller to discover it later as a launch error.
  if (def.provisioning) {
    return NextResponse.json({
      agent: def,
      warning:
        `Agent "${def.name}" was created, but its browser credential profile could not be ` +
        `provisioned: ${def.provisioning.error} It cannot use browser tools until repaired ` +
        `(POST /api/v2/identity { action: "repair", agentId: "${def.id}" }).`,
      provisioning: def.provisioning,
    });
  }
  return NextResponse.json({ agent: def });
}
