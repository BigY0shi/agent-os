import { NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { listAgents, listRuns } from "@/lib/agentsStore";
import { getStatusSnapshot } from "@/lib/v2/agents/statusFeed";
import { listTasks } from "@/lib/v2/tasks/store";
import type { StatusBandKind } from "@/components/v2/StatusBand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/**
 * GET /api/v2/tasks/agents-strip — the B4 AgentsSection payload.
 *
 * Band status comes from SPEC-E's statusFeed.getStatusSnapshot() — THE single
 * derivation (CONVENTIONS §6); this route no longer re-derives (the task
 * overlay it used to compute locally now lives inside statusFeed). What stays
 * here is the payload dressing: last-run info + the task lists the strip
 * renders.
 */
export async function GET() {
  ensureV2();
  try {
    const [defs, snapshot] = await Promise.all([listAgents(), getStatusSnapshot()]);
    const bandById = new Map(snapshot.map((s) => [s.agentId, s]));

    const agents = await Promise.all(
      defs.map(async (def) => {
        const runs = await listRuns(def.id, 5).catch(() => []);
        const lastRun = runs[0] ?? null;

        const assigned = listTasks({ agentId: def.id, limit: 100 });
        const needsYou = assigned.filter((t) => t.status === "Waiting" || t.status === "Review");
        const current = assigned.find((t) => t.status === "Working") ?? null;
        const upcoming = assigned
          .filter((t) => t.isActive && t.runAt && t.runAt > new Date().toISOString())
          .sort((a, b) => (a.runAt! < b.runAt! ? -1 : 1))
          .slice(0, 3)
          .map((t) => ({ displayId: t.displayId, title: t.title, nextRunAt: t.runAt }));

        const band: StatusBandKind = bandById.get(def.id)?.status ?? "offline";

        return {
          id: def.id,
          name: def.name,
          band,
          enabled: def.enabled,
          lastRunStatus: lastRun?.status ?? null,
          lastRunAt: lastRun?.startedAt ?? null,
          needsYouCount: needsYou.length,
          currentTask: current ? { displayId: current.displayId, title: current.title } : null,
          upcoming,
        };
      }),
    );

    return NextResponse.json({ agents }, noStore);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ agents: [], error: message }, noStore);
  }
}
