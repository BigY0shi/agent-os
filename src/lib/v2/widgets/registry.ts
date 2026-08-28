// ── SPEC-D §3.4 — widget registry (H2.1) ─────────────────────────────────────
// THE single widget catalog (CONVENTIONS §8: slugs exist ONCE — later
// workstreams fill placeholder data routes rather than registering seconds).
// Metadata only: server data fns live in data.ts, client components in
// src/components/v2/home/widgetComponents.tsx. This module stays import-safe
// from both sides (its only import is the client-safe types file).

import type { WidgetDef, WidgetSize } from "./types";

/** H1.1 legacy-* wrapper defs share everything but slug/title/size (§6.6). */
function legacyDef(input: {
  slug: string;
  title: string;
  description: string;
  defaultSize: WidgetSize;
}): WidgetDef {
  return {
    ...input,
    icon: "LayoutPanelTop",
    minSize: "S",
    // dataKind 'none': the wrapped panels fetch as they already do — the data
    // route is never called (zero logic change, §6.6 legacy-* row).
    dataKind: "none",
    sourceModule: "dashboard",
    chromeless: true,
  };
}

export const WIDGETS: WidgetDef[] = [
  {
    slug: "attention",
    title: "Needs my attention",
    description:
      "Open attention items grouped by severity — sync failures, pending approvals, failed runs. Shared with the AttentionHero.",
    icon: "BellRing",
    minSize: "M",
    defaultSize: "L",
    configSchema: [
      {
        key: "maxItems",
        label: "Max items",
        type: "select",
        options: [
          { label: "5", value: "5" },
          { label: "10", value: "10" },
          { label: "20", value: "20" },
        ],
        default: "10",
      },
      {
        key: "minSeverity",
        label: "Minimum severity",
        type: "select",
        options: [
          { label: "info", value: "info" },
          { label: "warn", value: "warn" },
          { label: "urgent", value: "urgent" },
        ],
        default: "info",
      },
    ],
    dataKind: "endpoint",
    sourceModule: "attention",
  },
  {
    slug: "activity-feed",
    title: "Integration activity",
    description: "Latest activities across connected integration accounts, newest first.",
    icon: "Rss",
    minSize: "M",
    defaultSize: "L",
    configSchema: [
      {
        key: "accountId",
        label: "Account (blank = all)",
        type: "input",
        placeholder: "account id — leave blank for all accounts",
      },
      {
        key: "maxItems",
        label: "Max items",
        type: "select",
        options: [
          { label: "10", value: "10" },
          { label: "25", value: "25" },
          { label: "50", value: "50" },
        ],
        default: "10",
      },
    ],
    dataKind: "endpoint",
    sourceModule: "integrations",
  },
  {
    slug: "pipeline-stats",
    title: "Pipeline / Deal Desk",
    description:
      "Wraps the existing fleet-runtime KPIs or the Deal Desk board counts (view toggle).",
    icon: "Gauge",
    minSize: "S",
    defaultSize: "M",
    configSchema: [
      {
        key: "view",
        label: "View",
        type: "select",
        options: [
          { label: "Fleet KPIs", value: "kpi" },
          { label: "Deal Desk", value: "deals" },
        ],
        default: "kpi",
      },
    ],
    dataKind: "endpoint",
    sourceModule: "dashboard",
  },
  {
    slug: "agent-status",
    title: "Agent status",
    description:
      "Live agent fleet with the shared status bands (running / idle / waiting / error / offline).",
    icon: "Bot",
    minSize: "S",
    defaultSize: "S",
    configSchema: [
      {
        key: "maxAgents",
        label: "Max agents",
        type: "select",
        options: [
          { label: "4", value: "4" },
          { label: "8", value: "8" },
          { label: "16", value: "16" },
        ],
        default: "8",
      },
    ],
    dataKind: "endpoint",
    sourceModule: "agents",
  },
  // ── H3.2 — tasks (REAL data: the v2 tasks store exists since Phase 2) ──────
  {
    slug: "tasks-upcoming",
    title: "Tasks",
    description:
      "Tasks from the v2 store — newest, due/scheduled next, or in progress (scope toggle).",
    icon: "ListTodo",
    minSize: "S",
    defaultSize: "M",
    configSchema: [
      {
        key: "scope",
        label: "Scope",
        type: "select",
        options: [
          { label: "New", value: "new" },
          { label: "Upcoming", value: "upcoming" },
          { label: "In progress", value: "in-progress" },
        ],
        default: "upcoming",
      },
      {
        key: "maxItems",
        label: "Max items",
        type: "select",
        options: [
          { label: "5", value: "5" },
          { label: "10", value: "10" },
          { label: "20", value: "20" },
        ],
        default: "10",
      },
    ],
    dataKind: "endpoint",
    sourceModule: "tasks",
  },
  // ── H3.3 — first connector-powered widget (proves the G4 path) ─────────────
  {
    slug: "calendar",
    title: "Calendar",
    description:
      "Today's (or the week's) events from a connected Google Calendar account, via the gcal connector tools.",
    icon: "CalendarDays",
    minSize: "S",
    defaultSize: "M",
    configSchema: [
      {
        key: "accountId",
        label: "Google Calendar account",
        type: "account-select",
        connector: "gcal",
        required: true,
        placeholder: "connect Google Calendar on /integrations",
      },
      {
        key: "days",
        label: "Window",
        type: "select",
        options: [
          { label: "Today", value: "1" },
          { label: "Next 7 days", value: "7" },
        ],
        default: "1",
      },
    ],
    dataKind: "endpoint",
    sourceModule: "integrations",
  },
  // ── H3.2 — placeholder contracts (SPEC-F workstreams K + I fill data.ts) ───
  {
    slug: "newsletter-edition",
    title: "Newsletter",
    description:
      "Latest newsletter edition (workstream K). Not built yet — the data route answers honestly until it lands.",
    icon: "Newspaper",
    minSize: "M",
    defaultSize: "M",
    dataKind: "endpoint",
    sourceModule: "newsletter",
  },
  {
    slug: "anynotes-recent",
    title: "AnyNotes",
    description:
      "Recently captured AnyNotes with their reply counts, plus how many @jarvis replies are still generating.",
    icon: "StickyNote",
    minSize: "S",
    defaultSize: "M",
    configSchema: [
      {
        key: "maxItems",
        label: "Max items",
        type: "select",
        options: [
          { label: "5", value: "5" },
          { label: "10", value: "10" },
          { label: "20", value: "20" },
        ],
        default: "10",
      },
    ],
    dataKind: "endpoint",
    sourceModule: "anynotes",
  },
  // ── H1.1 — legacy-* wrappers (§6.6): each component IMPORTS the existing
  // Overview panel unchanged (dataKind 'none' — the panels fetch as they
  // already do; chromeless keeps their own chrome, so the default layout is
  // pixel-identical to the pre-rework page). ──────────────────────────────────
  legacyDef({ slug: "legacy-mission", title: "Mission stripe", description: "MissionStripe — the mission banner from the classic Overview.", defaultSize: "L" }),
  legacyDef({ slug: "legacy-jarvis", title: "Jarvis", description: "JarvisModule — the warm voice assistant centerpiece from the classic Overview.", defaultSize: "M" }),
  legacyDef({ slug: "legacy-telemetry", title: "Telemetry", description: "TelemetryPanel — live system telemetry from the classic Overview.", defaultSize: "S" }),
  legacyDef({ slug: "legacy-kpi", title: "KPI grid", description: "KPIGrid — fleet KPIs from the classic Overview.", defaultSize: "L" }),
  legacyDef({ slug: "legacy-todo", title: "Todos", description: "TodoPanel — the todo list from the classic Overview.", defaultSize: "L" }),
  legacyDef({ slug: "legacy-deals", title: "Deal Desk", description: "DealDeskSummary — deal desk summary from the classic Overview.", defaultSize: "S" }),
  legacyDef({ slug: "legacy-systemmap", title: "System map", description: "SystemMap — the system map from the classic Overview.", defaultSize: "S" }),
  legacyDef({ slug: "legacy-timeline", title: "Timeline", description: "MiniTimeline — the mini timeline from the classic Overview.", defaultSize: "S" }),
];

export function getWidget(slug: string): WidgetDef | null {
  return WIDGETS.find((w) => w.slug === slug) ?? null;
}
