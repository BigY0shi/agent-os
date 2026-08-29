import { NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { listAgents, listRuns } from "@/lib/agentsStore";
import { agentHasActiveRun, pendingApprovals } from "@/lib/agentsRuntime";
import { listTasks } from "@/lib/v2/tasks/store";
import type { StatusBandKind } from "@/components/v2/StatusBand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/**
 * GET /api/v2/tasks/agents-strip — the B4 AgentsSection payload.
 *
 * THIN by design: a butler-activity-style derivation over the agents module's
 * current state (agentsStore run metas + agentsRuntime in-flight registry +
 * v2 task assignments). SPEC-E's statusFeed.getStatusSnapshot() replaces these
 * internals later; the response shape is the stable part.
 *
 * Band derivation (CONVENTIONS §6 order):
 *   disabled → offline · running run → running · Waiting/Review task assigned
 *   or pending approval → waiting · last run failed → error · else idle.
 */
export async function GET() {
  ensureV2();
  try {
    const [defs, approvals] = await Promise.all([listAgents(), pendingApprovals().catch(() => [])]);
    const approvalAgentIds = new Set(approvals.map((a) => a.agentId));

    const agents = await Promise.all(
      defs.map(async (def) => {
        const runs = await listRuns(def.id, 5).catch(() => []);
        const lastRun = runs[0] ?? null;
        const running = agentHasActiveRun(def.id);

        const assigned = listTasks({ agentId: def.id, limit: 100 });
        const needsYou = assigned.filter((t) => t.status === "Waiting" || t.status === "Review");
        const current = assigned.find((t) => t.status === "Working") ?? null;
        const upcoming = assigned
          .filter((t) => t.isActive && t.runAt && t.runAt > new Date().toISOString())
          .sort((a, b) => (a.runAt! < b.runAt! ? -1 : 1))
          .slice(0, 3)
          .map((t) => ({ displayId: t.displayId, title: t.title, nextRunAt: t.runAt }));

        let band: StatusBandKind;
        if (!def.enabled) band = "offline";
        else if (running || current) band = "running";
        else if (needsYou.length > 0 || approvalAgentIds.has(def.id)) band = "waiting";
        else if (lastRun?.status === "error") band = "error";
        else band = "idle";

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
