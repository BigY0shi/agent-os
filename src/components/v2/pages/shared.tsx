"use client";

// ── Scratchpad shared atoms (SPEC-B B5) — mirrors tasks/shared.tsx ───────────
// Client-safe: NO server imports.

export const SCRATCHPAD_ACCENT = "#06b6d4";

/** Status colors, mirrored from tasks/shared.tsx (kept string-keyed so the
 *  node view can render whatever the API reports). */
export const TASK_STATUS_COLORS_CLIENT: Record<string, string> = {
  Todo: "#94a3b8",
  Ready: "#22d3ee",
  Working: "#fbbf24",
  Waiting: "#f59e0b",
  Review: "#c084fc",
  Done: "#86efac",
};

/** Client mirror of lib/v2/pages/store.ts Page. */
export interface PageClient {
  id: string;
  date: string | null;
  title: string;
  doc: Record<string, unknown>;
  rev: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** Client mirror of lib/v2/pages/store.ts PageComment. */
export interface PageCommentClient {
  id: string;
  pageId: string;
  anchorNodeId: string | null;
  anchorTextNorm: string | null;
  author: "jarvis" | "user";
  bodyMd: string;
  conversationId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/** 'YYYY-MM-DD' ± n days (noon-UTC anchor avoids DST edges). */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function fmtDayTitle(date: string | null): string {
  if (!date) return "Scratchpad";
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
