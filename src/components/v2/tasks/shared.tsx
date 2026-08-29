"use client";

// ── Tasks V2 shared atoms (SPEC-B §6) — mirrors memory/shared.tsx ────────────
// Client-safe: NO server imports. Task/status types come from the client-safe
// tasks/types.ts (zero node imports, eventTypes convention).

import type { TaskStatus } from "@/lib/v2/tasks/types";

export const TASKS_ACCENT = "#f97316";

/** Per-status dot/chip color (kanban-adjacent hues, board columns reuse them). */
export const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  Todo: "#94a3b8",
  Ready: "#22d3ee",
  Working: "#fbbf24",
  Waiting: "#f59e0b",
  Review: "#c084fc",
  Done: "#86efac",
};

/** SPEC-B §6 status → 4-column board mapping. */
export type BoardColumnKey = "todo" | "inprogress" | "waiting" | "done";

export const BOARD_COLUMNS: {
  key: BoardColumnKey;
  label: string;
  accent: string;
  statuses: TaskStatus[];
  /** Status a user drop sets (In Progress sets Ready — the worker flips Working). */
  dropStatus: TaskStatus;
}[] = [
  { key: "todo", label: "Todo", accent: "#94a3b8", statuses: ["Todo"], dropStatus: "Todo" },
  { key: "inprogress", label: "In Progress", accent: "#22d3ee", statuses: ["Ready", "Working"], dropStatus: "Ready" },
  { key: "waiting", label: "Waiting", accent: "#fbbf24", statuses: ["Waiting", "Review"], dropStatus: "Waiting" },
  { key: "done", label: "Done", accent: "#86efac", statuses: ["Done"], dropStatus: "Done" },
];

export function columnOf(status: TaskStatus): BoardColumnKey {
  const col = BOARD_COLUMNS.find((c) => c.statuses.includes(status));
  return col?.key ?? "todo";
}

/** Client mirror of the API's Task shape (lib/v2/tasks/types.ts Task). */
export interface TaskRowClient {
  id: string;
  displayId: string;
  title: string;
  descriptionMd: string | null;
  status: TaskStatus;
  parentId: string | null;
  childCount: number;
  specMd: string | null;
  planMd: string | null;
  planStatus: "none" | "drafted" | "approved" | "rejected";
  schedule: string | null;
  runAt: string | null;
  lastRunAt: string | null;
  occurrenceCount: number;
  maxOccurrences: number | null;
  isActive: boolean;
  endDate: string | null;
  scheduledDate: string | null;
  source: string;
  agentId: string | null;
  result: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** "Needs you": parked for a human — Waiting (blocked / plan drafted) or Review. */
export function needsYou(t: TaskRowClient): boolean {
  return t.status === "Waiting" || t.status === "Review" || t.planStatus === "drafted";
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return String(iso);
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** "in 5m" / "in 3h" / date — for next-run chips. */
export function fmtUntil(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return String(iso);
  const s = (t - Date.now()) / 1000;
  if (s <= 0) return "due";
  if (s < 60) return "in <1m";
  if (s < 3600) return `in ${Math.round(s / 60)}m`;
  if (s < 86400) return `in ${Math.round(s / 3600)}h`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function StatusDot({ status }: { status: TaskStatus }) {
  const c = TASK_STATUS_COLORS[status] ?? "#9aa";
  return (
    <span
      className="inline-block w-2 h-2 rounded-full shrink-0"
      title={status}
      style={{ background: c, boxShadow: `0 0 6px ${c}66` }}
    />
  );
}

export function DisplayIdChip({ displayId, onClick }: { displayId: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-mono text-[10px] px-1.5 py-[1px] rounded shrink-0"
      style={{
        color: TASKS_ACCENT,
        background: `${TASKS_ACCENT}14`,
        border: `1px solid ${TASKS_ACCENT}44`,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      {displayId}
    </button>
  );
}

export function PlanChip({ planStatus }: { planStatus: TaskRowClient["planStatus"] }) {
  if (planStatus === "none") return null;
  const meta: Record<string, { label: string; color: string }> = {
    drafted: { label: "plan: review me", color: "#fbbf24" },
    approved: { label: "plan approved", color: "#34d399" },
    rejected: { label: "plan rejected", color: "#f87171" },
  };
  const m = meta[planStatus];
  if (!m) return null;
  return (
    <span
      className="inline-flex items-center px-1.5 py-[1px] rounded text-[9.5px] font-semibold uppercase tracking-[0.08em] shrink-0"
      style={{ color: m.color, background: `${m.color}14`, border: `1px solid ${m.color}44` }}
    >
      {m.label}
    </span>
  );
}
