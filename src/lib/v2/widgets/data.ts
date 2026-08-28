// ── SPEC-D H3.1 — per-widget server data fns ─────────────────────────────────
// Dispatched by /api/v2/widgets/[slug]/data. House rules:
//  * WRAP existing data sources, never rebuild them — pipeline-stats and
//    agent-status call the SAME route handlers KPIGrid/DealDeskSummary already
//    fetch (/api/fleet/runtime, /api/deals/list); activity-feed reads the G2
//    integrations store.
//  * Honest metrics (the fake-telemetry P0): a source that is missing or
//    unconfigured returns { available: false, reason } — never fabricated data.
// SERVER-ONLY (db + fs) — components consume this through the data route.

import { readSettings } from "@/lib/settings";
import { getCollectorHealth } from "@/lib/v2/attention/collectors";
import { listItems } from "@/lib/v2/attention/store";
import {
  getAccount,
  listAccounts,
  listActivities,
  type AccountRow,
} from "@/lib/v2/integrations/store";
import { GET as fleetRuntimeGET } from "@/app/api/fleet/runtime/route";
import { GET as dealsListGET } from "@/app/api/deals/list/route";
import { getWidget } from "./registry";
import { SEVERITY_RANK, type WidgetData } from "./types";

type Config = Record<string, unknown>;

function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

// ─── attention ───────────────────────────────────────────────────────────────
// Same store surface as /api/v2/attention (H4.1); muteKinds respected; config
// adds maxItems + minSeverity (§6.6).

function attentionData(config: Config): WidgetData {
  const maxItems = Math.min(num(config.maxItems, 10), 100);
  const minSeverity = str(config.minSeverity) || "info";
  const minRank = SEVERITY_RANK[minSeverity] ?? 0;
  const muteKinds = readSettings().attention?.muteKinds ?? [];
  const items = listItems({ status: "open", excludeKinds: muteKinds })
    .filter((i) => (SEVERITY_RANK[i.severity] ?? 0) >= minRank)
    .slice(0, maxItems);
  return { available: true, items, collectors: getCollectorHealth() };
}

// ─── activity-feed ───────────────────────────────────────────────────────────

export interface ActivityFeedItem {
  id: string;
  accountId: string;
  connector: string; // definition slug
  account: string; // display name (falls back to the external account id)
  text: string;
  sourceUrl: string | null;
  eventType: string | null;
  createdAt: string;
}

function activityFeedData(config: Config): WidgetData {
  const maxItems = Math.min(num(config.maxItems, 10), 100);
  const wantedAccount = str(config.accountId);

  let accounts: AccountRow[];
  if (wantedAccount && wantedAccount !== "all") {
    const account = getAccount(wantedAccount);
    if (!account || !account.isActive) {
      return {
        available: false,
        reason: `integration account '${wantedAccount}' is not connected (or was deactivated)`,
      };
    }
    accounts = [account];
  } else {
    accounts = listAccounts().filter((a) => a.isActive);
    if (accounts.length === 0) {
      return {
        available: false,
        reason: "no integration accounts connected — connect one on /integrations",
      };
    }
  }

  const items: ActivityFeedItem[] = [];
  for (const account of accounts) {
    for (const a of listActivities(account.id, { limit: maxItems })) {
      items.push({
        id: a.id,
        accountId: account.id,
        connector: account.definitionSlug,
        account: account.displayName || account.accountId,
        text: a.text,
        sourceUrl: a.sourceUrl,
        eventType: a.eventType,
        createdAt: a.createdAt,
      });
    }
  }
  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return { available: true, items: items.slice(0, maxItems) };
}

// ─── pipeline-stats ──────────────────────────────────────────────────────────
// §6.6: wraps the existing KPIGrid (/api/fleet/runtime) and DealDeskSummary
// (/api/deals/list) fetches — the route handlers are imported and called
// directly, so the numbers are BY CONSTRUCTION the same ones the dashboard
// shows today.

interface FleetRuntimePayload {
  generatedAt: number;
  agents: Array<{
    id: string;
    name: string;
    status: "running" | "waiting" | "idle" | "error";
    lastRunAt: number | null;
    lastRunStatus: string | null;
    runs: number;
    costUsd: number;
  }>;
  runs: { total: number; d1: number; d7: number; successRate: number | null };
  timing: { medianMs: number | null; maxMs: number | null; avgTurns: number | null };
  spend: { total: number; d1: number; d7: number };
}

async function readFleetRuntime(): Promise<FleetRuntimePayload> {
  const res = await fleetRuntimeGET();
  return (await res.json()) as FleetRuntimePayload;
}

async function pipelineStatsData(config: Config): Promise<WidgetData> {
  const view = str(config.view) === "deals" ? "deals" : "kpi";

  if (view === "kpi") {
    const rt = await readFleetRuntime();
    return {
      available: true,
      view: "kpi",
      kpi: {
        generatedAt: rt.generatedAt,
        agents: {
          total: rt.agents.length,
          running: rt.agents.filter((a) => a.status === "running").length,
        },
        runs: rt.runs,
        timing: rt.timing,
        spend: rt.spend,
      },
    };
  }

  const res = await dealsListGET();
  const j = (await res.json()) as {
    ok?: boolean;
    error?: string;
    deals?: Array<{ status?: string }>;
    columns?: Array<{ key?: string; label?: string; accent?: string }>;
  };
  if (!j?.ok || !Array.isArray(j.deals)) {
    return { available: false, reason: j?.error || "deal desk board unreadable" };
  }
  const byStatus: Record<string, number> = {};
  for (const d of j.deals) {
    const k = typeof d?.status === "string" ? d.status : "unknown";
    byStatus[k] = (byStatus[k] ?? 0) + 1;
  }
  return {
    available: true,
    view: "deals",
    deals: { total: j.deals.length, byStatus, columns: j.columns ?? [] },
  };
}

// ─── agent-status ────────────────────────────────────────────────────────────
// Wraps the /api/fleet/runtime agents array (same derivation KPIGrid trusts);
// rendered client-side with the SHARED StatusBand (CONVENTIONS §6). An agent
// with no runs on disk maps to 'offline' — the fleet feed reports it 'idle'
// but with lastRunAt null, and a band that has never run is not resting.

export interface AgentStatusEntry {
  id: string;
  name: string;
  status: "running" | "waiting" | "idle" | "error" | "offline";
  lastRunAt: number | null;
  lastRunStatus: string | null;
  runs: number;
  costUsd: number;
}

async function agentStatusData(config: Config): Promise<WidgetData> {
  const maxAgents = Math.min(num(config.maxAgents, 8), 50);
  const rt = await readFleetRuntime();
  const agents: AgentStatusEntry[] = rt.agents.slice(0, maxAgents).map((a) => ({
    id: a.id,
    name: a.name,
    status: a.lastRunAt == null ? "offline" : a.status,
    lastRunAt: a.lastRunAt,
    lastRunStatus: a.lastRunStatus,
    runs: a.runs,
    costUsd: a.costUsd,
  }));
  return { available: true, agents, total: rt.agents.length, generatedAt: rt.generatedAt };
}

// ─── dispatcher ──────────────────────────────────────────────────────────────

/**
 * Resolve one widget's data payload. Unknown slug throws (the route 404s);
 * a source failure comes back as the honest { available: false, reason }.
 */
export async function getWidgetData(slug: string, config: Config = {}): Promise<WidgetData> {
  if (!getWidget(slug)) throw new UnknownWidgetError(slug);
  try {
    switch (slug) {
      case "attention":
        return attentionData(config);
      case "activity-feed":
        return activityFeedData(config);
      case "pipeline-stats":
        return await pipelineStatsData(config);
      case "agent-status":
        return await agentStatusData(config);
      default:
        // Registry entry without a data fn (future placeholder slugs land in
        // H3.2 with explicit contracts) — honest, not fabricated.
        return { available: false, reason: `widget '${slug}' has no data source yet` };
    }
  } catch (err) {
    // The source blew up — report it honestly rather than 500ing the grid.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[v2/widgets] data fn for '${slug}' failed:`, err);
    return { available: false, reason: `source read failed: ${message}` };
  }
}

export class UnknownWidgetError extends Error {
  constructor(slug: string) {
    super(`unknown widget '${slug}'`);
    this.name = "UnknownWidgetError";
  }
}
