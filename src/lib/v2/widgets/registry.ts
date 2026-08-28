// ── SPEC-D §3.4 — widget registry (H2.1) ─────────────────────────────────────
// THE single widget catalog (CONVENTIONS §8: slugs exist ONCE — later
// workstreams fill placeholder data routes rather than registering seconds).
// Metadata only: server data fns live in data.ts, client components in
// src/components/v2/home/widgetComponents.tsx. This module stays import-safe
// from both sides (its only import is the client-safe types file).

import type { WidgetDef } from "./types";

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
];

export function getWidget(slug: string): WidgetDef | null {
  return WIDGETS.find((w) => w.slug === slug) ?? null;
}
