import { allDisks, healthReport, topProcesses } from "@/lib/hostHealth";
import { readHistory } from "@/lib/hostSampler";
import { listModuleRuns } from "@/lib/moduleRuns";
import { listMissions, missionStats, recoverAfterRestart } from "@/lib/v2/missions/runtime";
import { getStatusSnapshot } from "@/lib/v2/agents/statusFeed";
import { ensureV2 } from "@/lib/v2/boot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v2/home/pulse            -> the Mission Control cockpit (S18), measured now
// GET /api/v2/home/pulse?processes=1 -> plus what is holding the machine (Health view)
// GET /api/v2/home/pulse?history=1   -> plus the last minutes of samples with shape words, and every drive (S27)
//   host/checks: lib/hostHealth (a 400 ms CPU sample, loopback-only service probes)
//   runs:        the module-run registry, which keeps every running run plus the LAST 50
//                finished; `window` says so, so the ring is never read as an all-time total
//   missions:    S17 mission records; agents: the live agent status snapshot
//   load:        what each CLI is doing right now (running mission seats) and each module
// A number with no source is left out, never estimated.
const noStore = { headers: { "Cache-Control": "no-store" } };

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const wantProcesses = q.get("processes") === "1";
  const wantHistory = q.get("history") === "1";
  const errors: Record<string, string> = {};
  const safe = async <T,>(key: string, fn: () => Promise<T> | T): Promise<T | null> => {
    try { return await fn(); } catch (e) { errors[key] = String((e as Error)?.message ?? e).slice(0, 300); return null; }
  };

  const health = await safe("health", () => healthReport());

  const runsAll = (await safe("runs", () => listModuleRuns({ includeDismissed: true }))) ?? [];
  const finished = runsAll.filter((r) => r.status !== "running").sort((a, b) => (a.endedAt ?? a.startedAt) - (b.endedAt ?? b.startedAt));
  const ok = finished.filter((r) => r.status === "done").length;
  const failed = finished.filter((r) => r.status === "error" || r.status === "lost").length;
  const durations = finished.filter((r) => r.endedAt).map((r) => r.endedAt! - r.startedAt);
  const runningByModule = new Map<string, number>();
  for (const r of runsAll) if (r.status === "running") runningByModule.set(r.module, (runningByModule.get(r.module) ?? 0) + 1);

  const missions = (await safe("missions", () => { recoverAfterRestart(); return listMissions(); })) ?? [];
  const mStats = missionStats(missions);
  const seatLoad = new Map<string, number>();
  for (const m of missions) for (const s of m.plan?.steps ?? []) {
    if (s.status !== "running") continue;
    const agent = m.seats.find((x) => x.id === s.seatId)?.agent ?? "unknown";
    seatLoad.set(agent, (seatLoad.get(agent) ?? 0) + 1);
  }

  const agents = await safe("agents", async () => { ensureV2(); return getStatusSnapshot(); });
  const processes = wantProcesses ? await safe("processes", () => topProcesses(12)) : undefined;
  const history = wantHistory ? await safe("history", () => readHistory()) : undefined;
  const drives = wantHistory ? await safe("drives", () => allDisks()) : undefined;

  return Response.json({
    sampledAt: new Date().toISOString(),
    host: health?.host ?? null,
    services: health?.services ?? [],
    checks: health ? { items: health.checks, clear: health.clear, total: health.total, status: health.status } : null,
    runs: {
      window: "every running run plus the last 50 finished",
      total: runsAll.length,
      running: runsAll.length - finished.length,
      finished: finished.length,
      succeeded: ok,
      failed,
      successRate: ok + failed ? Math.round((ok / (ok + failed)) * 100) : null,
      avgMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
      /** Oldest -> newest, last 24 finished runs: 1 = done, 0 = error/lost, -1 = stopped. */
      spark: finished.slice(-24).map((r) => (r.status === "done" ? 1 : r.status === "stopped" ? -1 : 0)),
      byModule: [...runningByModule.entries()].map(([module, running]) => ({ module, running })),
    },
    missions: {
      queued: mStats.counts.briefing,
      running: mStats.counts["in-progress"],
      review: mStats.counts.review,
      parked: mStats.counts.stopped + mStats.counts.failed,
      delivered: mStats.counts.delivered,
      waitingOnYou: mStats.waitingOnYou,
      agentsAtWork: mStats.agentsAtWork,
    },
    agents: (agents ?? []).map((a) => ({ id: a.agentId, name: a.name, status: a.status, detail: a.detail ?? null, since: a.since })),
    seatLoad: [...seatLoad.entries()].map(([agent, running]) => ({ agent, running })),
    ...(wantProcesses ? { processes } : {}),
    ...(wantHistory ? { history, drives } : {}),
    errors,
  }, noStore);
}
