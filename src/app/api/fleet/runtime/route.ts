import { NextResponse } from "next/server";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { listAgents, runsDir } from "@/lib/agentsStore";
import type { RunMeta } from "@/lib/agentsTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The live telemetry feed the fleet store has been waiting for.
//
// Everything here is derived from run records already on disk
// (~/.agentic-os/agents/<id>/runs/*.meta.json) — nothing is estimated,
// modelled, or assigned by array index. A field with no source is absent
// or explicitly flagged, never filled with a plausible-looking number.
//
// Token counts are the one known gap: `logTokens` is wired into three chat
// routes but not into the agent runner, so run records carry cost but no
// token split. `tokens.tracked` reports that honestly rather than showing 0
// as though it were measured.

const DAY = 86_400_000;

interface AgentRuntime {
  id: string;
  name: string;
  /**
   * Live status derived from the most recent run, not from configuration.
   * "waiting" is kept distinct from "idle" on purpose: an agent blocked on an
   * approval is not resting, and collapsing the two hides work that needs a
   * human.
   */
  status: "running" | "waiting" | "idle" | "error";
  lastRunAt: number | null;
  lastRunStatus: RunMeta["status"] | null;
  lastTrigger: string | null;
  runs: number;
  costUsd: number;
}

async function loadMetas(agentId: string): Promise<RunMeta[]> {
  const dir = runsDir(agentId);
  const files = await readdir(dir).catch(() => [] as string[]);
  const out: RunMeta[] = [];
  for (const f of files) {
    if (!f.endsWith(".meta.json")) continue;
    try {
      out.push(JSON.parse(await readFile(path.join(dir, f), "utf8")) as RunMeta);
    } catch {
      /* skip a torn or corrupt record rather than failing the whole feed */
    }
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

function median(sorted: number[]): number | null {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export async function GET() {
  const now = Date.now();
  const defs = await listAgents();

  const agents: AgentRuntime[] = [];
  const all: RunMeta[] = [];

  for (const def of defs) {
    const metas = await loadMetas(def.id);
    all.push(...metas);
    const latest = metas[0] ?? null;
    agents.push({
      id: def.id,
      name: def.name,
      status:
        latest?.status === "running"
          ? "running"
          : latest?.status === "waiting"
            ? "waiting"
            : latest?.status === "error"
              ? "error"
              : "idle",
      lastRunAt: latest?.startedAt ?? null,
      lastRunStatus: latest?.status ?? null,
      lastTrigger: latest?.trigger ?? null,
      runs: metas.length,
      costUsd: metas.reduce((n, m) => n + (m.costUsd ?? 0), 0),
    });
  }

  const since = (ms: number) => all.filter((m) => m.startedAt >= now - ms);
  const d1 = since(DAY);
  const d7 = since(7 * DAY);

  const byStatus: Record<string, number> = {};
  const byTrigger: Record<string, number> = {};
  for (const m of all) {
    byStatus[m.status] = (byStatus[m.status] ?? 0) + 1;
    byTrigger[m.trigger] = (byTrigger[m.trigger] ?? 0) + 1;
  }

  // "Succeeded" means the run reached a result. A killed run was stopped on
  // purpose and a waiting/running one hasn't finished, so neither is a success
  // or a failure — they are excluded from the denominator rather than quietly
  // counted as either. (Counting kills as failures is how a healthy fleet ends
  // up reporting a scary number.)
  const done = all.filter((m) => m.status === "done").length;
  const failed = all.filter((m) => m.status === "error").length;
  const judged = done + failed;

  const durations = all
    .filter((m) => typeof m.endedAt === "number" && m.endedAt > m.startedAt)
    .map((m) => (m.endedAt as number) - m.startedAt)
    .sort((a, b) => a - b);

  const turns = all.reduce((n, m) => n + (m.numTurns ?? 0), 0);
  const sum = (xs: RunMeta[]) => xs.reduce((n, m) => n + (m.costUsd ?? 0), 0);

  return NextResponse.json({
    generatedAt: now,
    agents,
    runs: {
      total: all.length,
      d1: d1.length,
      d7: d7.length,
      byStatus,
      byTrigger,
      // null (not 0) when nothing has been judged yet — 0% would read as failure.
      successRate: judged ? done / judged : null,
    },
    timing: {
      // Median leads: run durations are heavily right-skewed (one long run
      // drags the mean well above what a typical run actually costs in time).
      medianMs: median(durations),
      avgMs: durations.length
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : null,
      maxMs: durations.length ? durations[durations.length - 1] : null,
      totalTurns: turns,
      avgTurns: all.length ? turns / all.length : null,
    },
    spend: { total: sum(all), d1: sum(d1), d7: sum(d7) },
    tokens: {
      tracked: false,
      reason: "the agent runner does not call logTokens; run records carry cost only",
    },
  });
}
