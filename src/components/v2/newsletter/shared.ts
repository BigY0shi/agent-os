// Client-safe constants for the /newsletter module (SPEC-F §6).
// NO node imports and NO server-module imports — every component here is a
// client component. Shared ATOMS (SlideOver, EmptyState, StatusChip, fmtAgo,
// inputStyle, panelStyle) are imported from ../integrations/shared and
// ../memory/shared; nothing is re-implemented in this directory.

import type { Cadence, SubscriptionStatus } from "@/lib/v2/newsletter/types";

/** SPEC-F §6 accent for this module. */
export const NEWSLETTER_ACCENT = "#4d9de0";

/**
 * Subscription status colours. Deliberately NOT the five CONVENTIONS §6
 * StatusBand hexes: a subscription is not an agent band, and reusing that
 * palette would make it read like one (same call chunk 2 made for notes).
 */
export const SUBSCRIPTION_STATUS_COLORS: Record<SubscriptionStatus, string> = {
  active: "#4d9de0",
  paused: "#c0a36e",
  dead: "#8c8698",
};

export const CADENCE_LABELS: Record<Cadence, string> = {
  daily: "daily",
  weekly: "weekly",
  monthly: "monthly",
  unknown: "unknown",
};

/** The reader's own tab/date deep links — one place so nothing drifts. */
export function newsletterHref(params: { tab?: string; date?: string } = {}): string {
  const sp = new URLSearchParams();
  if (params.tab) sp.set("tab", params.tab);
  if (params.date) sp.set("date", params.date);
  const q = sp.toString();
  return q ? `/newsletter?${q}` : "/newsletter";
}
