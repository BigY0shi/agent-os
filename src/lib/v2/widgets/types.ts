// ── SPEC-D §3.4 — widget framework types (H2.1) ──────────────────────────────
// CLIENT-SAFE: no server imports, no fs/db. Shared by the registry (metadata),
// the HomeGrid/WidgetShell components, the /api/v2/widgets routes and the
// settings `home.cells` subtree. HomeCell is the OverviewCell port (§4:
// x/y/w/h → order/size span-grid, decision 9).

export type WidgetSize = "S" | "M" | "L";

/** Port of AOC WidgetMeta.configSchema (§3.4). Rendered by WidgetConfigForm (H2.2). */
export interface WidgetConfigField {
  key: string;
  label: string;
  type: "input" | "select" | "toggle";
  placeholder?: string;
  required?: boolean;
  options?: { label: string; value: string }[];
  default?: string | boolean;
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
 */
export const DEFAULT_HOME_CELLS: readonly HomeCell[] = [
  { id: "cell-attention", widgetSlug: "attention", size: "L", order: 0 },
  { id: "cell-agent-status", widgetSlug: "agent-status", size: "S", order: 1 },
  { id: "cell-pipeline-stats", widgetSlug: "pipeline-stats", size: "M", order: 2, config: { view: "kpi" } },
  { id: "cell-activity-feed", widgetSlug: "activity-feed", size: "L", order: 3 },
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
