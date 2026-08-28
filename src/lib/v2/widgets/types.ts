// ── SPEC-D §3.4 — widget framework types (H2.1) ──────────────────────────────
// CLIENT-SAFE: no server imports, no fs/db. Shared by the registry (metadata),
// the HomeGrid/WidgetShell components, the /api/v2/widgets routes and the
// settings `home.cells` subtree. HomeCell is the OverviewCell port (§4:
// x/y/w/h → order/size span-grid, decision 9).

export type WidgetSize = "S" | "M" | "L";

/** Port of AOC WidgetMeta.configSchema (§3.4). Rendered by WidgetConfigForm (H2.2).
 *  'account-select' (H3.3) is a select whose options are the CONNECTED accounts
 *  of `connector` — the form fetches GET /api/v2/integrations at render time
 *  (a static schema can't know accounts; chunk-1 handoff ruling). */
export interface WidgetConfigField {
  key: string;
  label: string;
  type: "input" | "select" | "toggle" | "account-select";
  placeholder?: string;
  required?: boolean;
  options?: { label: string; value: string }[];
  default?: string | boolean;
  /** account-select only: integration definition slug (e.g. 'gcal'). */
  connector?: string;
}

export interface WidgetDef {
  slug: string;
  title: string;
  description: string;
  /** lucide icon name — resolved to a component client-side (registry stays render-free). */
  icon: string;
  minSize: WidgetSize;
  defaultSize: WidgetSize;
  configSchema?: WidgetConfigField[];
  /** 'endpoint' = component polls /api/v2/widgets/<slug>/data; 'none' = self-contained. */
  dataKind: "endpoint" | "none";
  sourceModule: string;
  /**
   * H1.1 legacy-* wrappers: the wrapped panel brings its OWN chrome, so the
   * WidgetShell renders no border/title bar outside edit mode — the default
   * layout stays pixel-identical to the pre-rework Overview.
   */
  chromeless?: boolean;
}

/** One cell of the home grid. Persisted in settings.home.cells. */
export interface HomeCell {
  id: string;
  widgetSlug: string;
  size: WidgetSize;
  order: number;
  config?: Record<string, unknown>;
}

/**
 * Honest data-route envelope (§5.8 + the fake-telemetry P0 rule): a widget
 * whose source is missing/unconfigured returns `{available:false, reason}` —
 * NEVER fabricated data.
 */
export type WidgetData<T extends Record<string, unknown> = Record<string, unknown>> =
  | ({ available: true } & T)
  | { available: false; reason: string };

// ── §6.6 payload contracts (H3.2) ────────────────────────────────────────────
// Exported TS types for the workstreams that FILL the placeholder data routes
// (CONVENTIONS §8: slugs exist ONCE — SPEC-B/I/K implement these shapes in
// data.ts rather than registering second widgets). Until then the data route
// answers { available: false, reason } and the picker shows them honestly.

/** `tasks-upcoming` — REAL since Phase 2 (v2 tasks store); SPEC-B may extend. */
export interface TasksUpcomingPayload extends Record<string, unknown> {
  scope: "new" | "upcoming" | "in-progress";
  tasks: Array<{
    id: string;
    displayId: string;
    title: string;
    status: string;
    /** UTC ISO next wake (run_at) — null when only calendar-pinned. */
    runAt: string | null;
    /** 'YYYY-MM-DD' calendar pin — null when only time-scheduled. */
    scheduledDate: string | null;
    agentId: string | null;
    createdAt: string;
  }>;
}

/** `newsletter-edition` — contract for SPEC-F workstream K (§6.6 verbatim). */
export interface NewsletterEditionPayload extends Record<string, unknown> {
  edition: {
    date: string;
    sections: Array<{
      topic: string;
      stories: Array<{ title: string; url: string; sources: string[] }>;
    }>;
  };
}

/** `anynotes-recent` — contract for SPEC-F workstream I (§6.6 verbatim). */
export interface AnynotesRecentPayload extends Record<string, unknown> {
  notes: Array<{
    id: string;
    type: string;
    title: string;
    url: string;
    capturedAt: string;
    replyCount: number;
  }>;
}

/** `calendar` — filled by H3.3 over runtime.callTool(gcal_list_events). */
export interface CalendarPayload extends Record<string, unknown> {
  accountId: string;
  days: number;
  events: Array<{
    id: string | null;
    summary: string;
    start: string;
    location: string | null;
  }>;
}

/** Severity rank for minSeverity filtering (client + server share it). */
export const SEVERITY_RANK: Record<string, number> = { info: 0, warn: 1, urgent: 2 };

/**
 * Presentational severity grouping for the AttentionHero + attention widget
 * (H4.2): urgent → warn → info buckets. Client-safe on purpose — the hero is
 * a client component and must not pull the attention store (db). Unknown
 * severities land in info (the store normalizes the same way). Input order
 * (the route is already severity-sorted) is kept inside each bucket.
 */
export function groupBySeverity<T extends { severity: string }>(
  items: readonly T[],
): { urgent: T[]; warn: T[]; info: T[] } {
  const groups = { urgent: [] as T[], warn: [] as T[], info: [] as T[] };
  for (const item of items) {
    const sev = item.severity === "urgent" || item.severity === "warn" ? item.severity : "info";
    groups[sev].push(item);
  }
  return groups;
}

/** Grid column span per size (3-col grid, 1-col below md — §6.5). */
export const SIZE_SPAN: Record<WidgetSize, number> = { S: 1, M: 2, L: 3 };

/**
 * Default layout (§6.5 "default layout const if unset"). NOT copied into
 * DEFAULT_SETTINGS — an unset settings.home.cells falls back here at read
 * time so future default changes reach untouched installs.
 *
 * H1.1: the default REPRODUCES the pre-rework Overview composition (Yoshi's
 * current arrangement — Jarvis centerpiece M beside Telemetry S, then KPI +
 * Todo full-width, then the Deals/SystemMap/Timeline row) via the legacy-*
 * wrapper widgets, so the restructure is visually non-breaking until the
 * layout is customized. AttentionHero sits ABOVE the grid in Overview, so the
 * 'attention' widget is deliberately not part of the default (no duplicate);
 * the chunk-1 widgets stay addable through the picker.
 */
export const DEFAULT_HOME_CELLS: readonly HomeCell[] = [
  { id: "cell-legacy-mission", widgetSlug: "legacy-mission", size: "L", order: 0 },
  { id: "cell-legacy-jarvis", widgetSlug: "legacy-jarvis", size: "M", order: 1 },
  { id: "cell-legacy-telemetry", widgetSlug: "legacy-telemetry", size: "S", order: 2 },
  { id: "cell-legacy-kpi", widgetSlug: "legacy-kpi", size: "L", order: 3 },
  { id: "cell-legacy-todo", widgetSlug: "legacy-todo", size: "L", order: 4 },
  { id: "cell-legacy-deals", widgetSlug: "legacy-deals", size: "S", order: 5 },
  { id: "cell-legacy-systemmap", widgetSlug: "legacy-systemmap", size: "S", order: 6 },
  { id: "cell-legacy-timeline", widgetSlug: "legacy-timeline", size: "S", order: 7 },
];

function isHomeCell(v: unknown): v is HomeCell {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    c.id.length > 0 &&
    typeof c.widgetSlug === "string" &&
    c.widgetSlug.length > 0 &&
    (c.size === "S" || c.size === "M" || c.size === "L") &&
    typeof c.order === "number" &&
    (c.config === undefined || (typeof c.config === "object" && c.config !== null))
  );
}

/**
 * Resolve the persisted layout: a valid non-empty settings.home.cells wins,
 * anything else (unset, empty, malformed rows) falls back to
 * DEFAULT_HOME_CELLS. Always returned order-sorted.
 */
export function resolveHomeCells(cells: unknown): HomeCell[] {
  const valid = Array.isArray(cells) ? cells.filter(isHomeCell) : [];
  const chosen = valid.length > 0 ? valid : [...DEFAULT_HOME_CELLS];
  return [...chosen].sort((a, b) => a.order - b.order);
}
