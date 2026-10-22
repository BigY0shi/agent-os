import { listModuleRuns } from "@/lib/moduleRuns";
import { readSettings } from "@/lib/settings";
import { MODULES, SKILL_WIRED } from "@/lib/moduleRegistry";
import { listWorkflows, workflowActivation } from "@/lib/workflows";
import { getStatusSnapshot } from "@/lib/v2/agents/statusFeed";
import { ensureV2 } from "@/lib/v2/boot";
import { sessionCounts } from "@/lib/v2/jarvis/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/control/insights -> measured counts only.
//   runs: from the module-run registry, which keeps every running run plus the LAST
//         50 finished ones (lib/moduleRuns.ts MAX_FINISHED); `window` says so, so the
//         numbers are never read as all-time totals.
//   agents: the live status snapshot; jarvis: conversation counts; skills/workflows:
//         what is switched on where.
const DAY = 86_400_000;

export async function GET() {
  const now = Date.now();
  const runs = listModuleRuns({ includeDismissed: true });
  const byModule = new Map<string, { module: string; total: number; last24h: number; last7d: number; done: number; error: number; stopped: number; lost: number; running: number; durations: number[]; lastAt: number }>();
  for (const r of runs) {
    const m = byModule.get(r.module) ?? { module: r.module, total: 0, last24h: 0, last7d: 0, done: 0, error: 0, stopped: 0, lost: 0, running: 0, durations: [], lastAt: 0 };
    m.total++;
    if (now - r.startedAt < DAY) m.last24h++;
    if (now - r.startedAt < 7 * DAY) m.last7d++;
    m[r.status]++;
    if (r.endedAt && r.status !== "running") m.durations.push(r.endedAt - r.startedAt);
    m.lastAt = Math.max(m.lastAt, r.endedAt ?? r.startedAt);
    byModule.set(r.module, m);
  }
  const moduleRows = [...byModule.values()]
    .map(({ durations, ...m }) => ({ ...m, avgMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null }))
    .sort((a, b) => b.lastAt - a.lastAt);
  const finished = runs.filter((r) => r.status !== "running");

  let agents: Awaited<ReturnType<typeof getStatusSnapshot>> = [];
  let agentsError: string | null = null;
  try { agents = await getStatusSnapshot(); } catch (e) { agentsError = String((e as Error)?.message ?? e); }

  let jarvis: ReturnType<typeof sessionCounts> | null = null;
  try { ensureV2(); jarvis = sessionCounts(); } catch { jarvis = null; }

  const skills = readSettings().skills ?? {};
  const act = workflowActivation();
  return Response.json({
    window: { runsKept: runs.length, note: "the run registry keeps every running run and the last 50 finished ones" },
    runs: {
      running: runs.filter((r) => r.status === "running").length,
      finished: finished.length,
      done: finished.filter((r) => r.status === "done").length,
      failed: finished.filter((r) => r.status === "error" || r.status === "lost").length,
      stopped: finished.filter((r) => r.status === "stopped").length,
      byModule: moduleRows,
    },
    agents: { entries: agents, error: agentsError },
    jarvis,
    skills: {
      global: skills.global ?? [],
      modules: Object.entries(skills.modules ?? {}).map(([module, names]) => ({ module, count: names.length, readsSkills: SKILL_WIRED.includes(module) })),
      wiredModules: SKILL_WIRED.length,
      totalModules: MODULES.length,
    },
    workflows: { total: listWorkflows().length, global: act.global.length, modules: Object.entries(act.modules).map(([module, ids]) => ({ module, count: ids.length })) },
    sampledAt: new Date(now).toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
