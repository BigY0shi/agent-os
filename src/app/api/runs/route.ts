import { NextResponse } from "next/server";
import { listModuleRuns, type ModuleRun } from "@/lib/moduleRuns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/**
 * GET /api/runs — every live and recent run the owner can see, across modules.
 *
 * Module runs come from the registry in lib/moduleRuns.ts. Live V2 agent runs
 * are merged in from agentsRuntime so the tray has ONE list; they are mapped to
 * the same shape with module "agents" and a deep link to the agent page. The
 * merge is best-effort: if the agents runtime cannot load, module runs still
 * answer and the response says the agents leg was skipped.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeDismissed = url.searchParams.get("all") === "1";
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 60) || 60));

  const runs: ModuleRun[] = listModuleRuns({ includeDismissed, limit });
  let agentsLeg: "merged" | "skipped" = "skipped";
  try {
    const rt = await import("@/lib/agentsRuntime");
    if (typeof rt.listLiveAgentRuns === "function") {
      for (const m of rt.listLiveAgentRuns()) {
        runs.unshift({
          id: m.id,
          module: "agents",
          label: `${m.agentId}: ${m.trigger}`,
          href: `/agents/${encodeURIComponent(m.agentId)}?tab=runs`,
          status: "running",
          startedAt: m.startedAt,
          events: [],
        });
      }
      agentsLeg = "merged";
    }
  } catch {
    agentsLeg = "skipped";
  }
  return NextResponse.json({ ok: true, runs, agentsLeg, at: Date.now() }, noStore);
}
