// ── Rabbit R1 shared atoms ───────────────────────────────────────────────────
// CLIENT-SAFE: no server imports. Generic atoms (StatusChip, EmptyState,
// fmtAgo, panelStyle, inputStyle) come from components/v2/integrations/shared.

/** Sidebar accent for /rabbit (Rabbit orange). */
export const RABBIT_ACCENT = "#ff7a1a";

export const SESSION_COLORS: Record<string, string> = {
  live: "#f472b6",
  active: RABBIT_ACCENT,
  archived: "#6b7280",
};
