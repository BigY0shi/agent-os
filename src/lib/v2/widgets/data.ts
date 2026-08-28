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
import { callTool } from "@/lib/v2/integrations/runtime";
import { getStatusSnapshot } from "@/lib/v2/agents/statusFeed";
import { listTasks } from "@/lib/v2/tasks/store";
import type { Task } from "@/lib/v2/tasks/types";
import { GET as fleetRuntimeGET } from "@/app/api/fleet/runtime/route";
import { GET as dealsListGET } from "@/app/api/deals/list/route";
import { getWidget } from "./registry";
import {
  SEVERITY_RANK,
  type CalendarPayload,
  type TasksUpcomingPayload,
  type WidgetData,
} from "./types";

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
// Band status comes from SPEC-E's statusFeed.getStatusSnapshot() — THE single
// derivation (CONVENTIONS §6); this widget no longer re-derives (the old
// "never ran → offline" special case is superseded by the §6 mapping). The
// /api/fleet/runtime wrap remains only for the display extras (lastRunAt,
// run counts, spend) KPIGrid already trusts.

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
  const [rt, snapshot] = await Promise.all([readFleetRuntime(), getStatusSnapshot()]);
  const bandById = new Map(snapshot.map((s) => [s.agentId, s.status]));
  const agents: AgentStatusEntry[] = rt.agents.slice(0, maxAgents).map((a) => ({
    id: a.id,
    name: a.name,
    status: bandById.get(a.id) ?? "offline",
    lastRunAt: a.lastRunAt,
    lastRunStatus: a.lastRunStatus,
    runs: a.runs,
    costUsd: a.costUsd,
  }));
  return { available: true, agents, total: rt.agents.length, generatedAt: rt.generatedAt };
}

// ─── tasks-upcoming (H3.2 — REAL data, the v2 tasks store landed in Phase 2) ─
// Scopes (§6.6 config): 'new' = latest Todo/Ready by creation; 'upcoming' =
// due (run_at) or calendar-pinned (scheduled_date) tasks sorted soonest-first
// (overdue included at the top — honest, not hidden); 'in-progress' =
// Working/Waiting/Review.

function taskWire(t: Task): TasksUpcomingPayload["tasks"][number] {
  return {
    id: t.id,
    displayId: t.displayId,
    title: t.title,
    status: t.status,
    runAt: t.runAt,
    scheduledDate: t.scheduledDate,
    agentId: t.agentId,
    createdAt: t.createdAt,
  };
}

/** Effective due instant for 'upcoming' sorting: run_at wins, else the
 *  calendar pin's date (lexical ISO compare works for both). */
function dueKey(t: Task): string | null {
  if (t.runAt) return t.runAt;
  if (t.scheduledDate) return `${t.scheduledDate}T00:00:00.000Z`;
  return null;
}

function tasksUpcomingData(config: Config): WidgetData<TasksUpcomingPayload> {
  const maxItems = Math.min(num(config.maxItems, 10), 100);
  const rawScope = str(config.scope);
  const scope: TasksUpcomingPayload["scope"] =
    rawScope === "new" || rawScope === "in-progress" ? rawScope : "upcoming";

  let tasks: Task[];
  if (scope === "new") {
    tasks = listTasks({ status: ["Todo", "Ready"], limit: maxItems });
  } else if (scope === "in-progress") {
    tasks = listTasks({ status: ["Working", "Waiting", "Review"], limit: maxItems });
  } else {
    tasks = listTasks({ status: ["Todo", "Waiting", "Ready", "Working", "Review"], limit: 1000 })
      .filter((t) => dueKey(t) !== null)
      .sort((a, b) => (dueKey(a)! < dueKey(b)! ? -1 : dueKey(a)! > dueKey(b)! ? 1 : 0))
      .slice(0, maxItems);
  }
  return { available: true, scope, tasks: tasks.map(taskWire) };
}

// ─── newsletter-edition + anynotes-recent (H3.2 placeholder contracts) ───────
// The §6.6 payload contracts live in types.ts (NewsletterEditionPayload /
// AnynotesRecentPayload) for SPEC-F workstreams K and I — those workstreams
// REPLACE these stubs (CONVENTIONS §8: fill the route, never register a second
// widget). Until then the honest envelope, so the picker greys them with the
// reason.

function newsletterEditionData(): WidgetData {
  return { available: false, reason: "workstream not built — the Newsletter module (SPEC-F K) fills this route" };
}

function anynotesRecentData(): WidgetData {
  return { available: false, reason: "workstream not built — the AnyNotes module (SPEC-F I) fills this route" };
}

// ─── calendar (H3.3 — first connector-powered widget, proves the G4 path) ────
// Calls the gcal connector's gcal_list_events tool through runtime.callTool
// (verbatim tool name, redacted call logging, the __setGoogleMockForTests seam
// keeps it offline-testable). Config: accountId (account-select over connected
// gcal accounts) + days 1/7. Window boundaries use the server's local midnight
// (this is Yoshi's single-user box — server tz == user tz; revisit with
// settings.tasks.timezone if that ever splits).

/** Parse the fixed gcal_list_events text format back into rows:
 *  "- <summary> (<start>)\n  ID: <id>\n  Location: <loc>" blocks. */
export function parseGcalEventList(text: string): CalendarPayload["events"] {
  if (!text.startsWith("Found ")) return [];
  const events: CalendarPayload["events"] = [];
  for (const block of text.slice(text.indexOf("\n\n") + 2).split("\n\n")) {
    const lines = block.split("\n");
    const head = lines[0] ?? "";
    if (!head.startsWith("- ")) continue;
    // summary may itself contain " (" — the START stamp is the LAST paren group.
    const open = head.lastIndexOf(" (");
    if (open < 2 || !head.endsWith(")")) continue;
    const summary = head.slice(2, open);
    const start = head.slice(open + 2, -1);
    const idLine = lines.find((l) => l.trim().startsWith("ID: "));
    const locLine = lines.find((l) => l.trim().startsWith("Location: "));
    const id = idLine ? idLine.trim().slice(4) : null;
    const location = locLine ? locLine.trim().slice(10) : null;
    events.push({
      id,
      summary,
      start,
      location: location === "N/A" ? null : location,
    });
  }
  return events;
}

async function calendarData(config: Config): Promise<WidgetData<CalendarPayload>> {
  const accountId = str(config.accountId);
  if (!accountId) {
    return { available: false, reason: "connect Google Calendar on /integrations, then pick the account in this widget's settings" };
  }
  const account = getAccount(accountId);
  if (!account || !account.isActive) {
    return { available: false, reason: `Google Calendar account '${accountId}' is not connected (or was disconnected)` };
  }
  if (account.definitionSlug !== "gcal") {
    return { available: false, reason: `account '${accountId}' is a '${account.definitionSlug}' account, not Google Calendar` };
  }

  const days = num(config.days, 1) === 7 ? 7 : 1;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + days * 86_400_000);

  const result = await callTool(
    accountId,
    "gcal_list_events",
    {
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      orderBy: "startTime",
      singleEvents: true,
      maxResults: 50,
    },
    { source: "widget:calendar" },
  );
  if (result.isError) {
    // Soft connector-API failure (runtime decision 6) — honest, not fabricated.
    return { available: false, reason: result.text };
  }
  return { available: true, accountId, days, events: parseGcalEventList(result.text) };
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
      case "tasks-upcoming":
        return tasksUpcomingData(config);
      case "newsletter-edition":
        return newsletterEditionData();
      case "anynotes-recent":
        return anynotesRecentData();
      case "calendar":
        return await calendarData(config);
      default:
        // Registry entry without a data fn (legacy-* wrappers are dataKind
        // 'none' — their components never call this) — honest, not fabricated.
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
