import { listAgents, listRuns } from "@/lib/agentsStore";
import { modelFor } from "@/lib/agentsRuntime";
import { getStatusSnapshot } from "@/lib/v2/agents/statusFeed";
import { ensureV2 } from "@/lib/v2/boot";
import { buildCrewSnapshot } from "@/lib/v2/crew/crew";
import { PREPARED_ROLES } from "@/lib/v2/crew/roles";
import type { BandStatus, RunMeta } from "@/lib/agentsTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v2/crew -> { counts, agents, heat, recent, basis, roles, tiers }   (S21 Crew)
// Counts come from each agent's recorded runs; `tiers` names the model each intelligence
// tier actually runs on today (settings.agentsModels, else the verified defaults).
// Deploying uses the existing POST /api/agents.
export async function GET() {
  try {
    const agents = await listAgents();
    const runs = new Map<string, RunMeta[]>();
    await Promise.all(agents.map(async (a) => { runs.set(a.id, await listRuns(a.id, 500)); }));
    let statusRows: { agentId: string; status: BandStatus; detail?: string }[] = [];
    let statusError: string | null = null;
    try { ensureV2(); statusRows = await getStatusSnapshot(); } catch (e) { statusError = String((e as Error)?.message ?? e); }
    const snap = buildCrewSnapshot({ agents, runs, status: new Map(statusRows.map((s) => [s.agentId, { status: s.status, detail: s.detail }])) });
    return Response.json({
      ...snap,
      statusError,
      roles: PREPARED_ROLES,
      tiers: { fast: modelFor("fast"), standard: modelFor("standard"), deep: modelFor("deep") },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message ?? e) }, { status: 500 });
  }
}
