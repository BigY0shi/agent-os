"use client";

import { useMemo, useState } from "react";
import { CalendarDays, Hand, Repeat, X } from "lucide-react";
import { EmptyState, Eyebrow } from "@/components/v2/memory/shared";
import {
  DisplayIdChip,
  PlanChip,
  StatusDot,
  TASKS_ACCENT,
  needsYou,
  fmtUntil,
  type TaskRowClient,
} from "./shared";

// ── TaskListPanel (SPEC-B §6 row 1 left) ─────────────────────────────────────
// Tabs [One-time | Repeating] + a "needs you" filter chip (Waiting/Review or a
// drafted plan). Rows: Done checkbox · display-id chip · title · date pill
// (native date input → PATCH scheduledDate) · schedule text · status dot.
// The calendar's selected day filters via the `dateFilter` prop.

type Tab = "oneTime" | "repeating";

export default function TaskListPanel({
  tasks,
  dateFilter,
  onClearDateFilter,
  onOpen,
  onPatch,
}: {
  tasks: TaskRowClient[];
  /** 'YYYY-MM-DD' from the MiniCalendar, or null. */
  dateFilter: string | null;
  onClearDateFilter: () => void;
  onOpen: (task: TaskRowClient) => void;
  /** PATCH /api/v2/tasks/[id]; resolves after refetch. */
  onPatch: (id: string, patch: Record<string, unknown>) => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>("oneTime");
  const [needsYouOnly, setNeedsYouOnly] = useState(false);
  const [datePickFor, setDatePickFor] = useState<string | null>(null);

  const roots = useMemo(() => tasks.filter((t) => !t.parentId), [tasks]);
  const needsYouCount = roots.filter((t) => t.status !== "Done" && needsYou(t)).length;

  const rows = useMemo(() => {
    let r = roots.filter((t) => (tab === "repeating" ? !!t.schedule : !t.schedule));
    if (needsYouOnly) r = r.filter((t) => t.status !== "Done" && needsYou(t));
    if (dateFilter) {
      r = r.filter(
        (t) =>
          t.scheduledDate === dateFilter ||
          (t.runAt && t.runAt.slice(0, 10) === dateFilter),
      );
    }
    // Active first, Done sinks; then soonest due.
    return r.sort((a, b) => {
      if ((a.status === "Done") !== (b.status === "Done")) return a.status === "Done" ? 1 : -1;
      const ad = a.runAt ?? a.scheduledDate ?? "9999";
      const bd = b.runAt ?? b.scheduledDate ?? "9999";
      return ad < bd ? -1 : ad > bd ? 1 : 0;
    });
  }, [roots, tab, needsYouOnly, dateFilter]);

  return (
    <div
      className="rounded-xl p-3 flex flex-col min-h-[260px]"
      style={{ border: "1px solid var(--panel-border, #2a2436)", background: "var(--panel, rgba(255,255,255,0.02))" }}
    >
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        {(
          [
            { key: "oneTime" as Tab, label: "One-time" },
            { key: "repeating" as Tab, label: "Repeating" },
          ]
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="px-2.5 h-7 rounded-lg text-[12px] font-medium transition"
            style={{
              color: tab === t.key ? TASKS_ACCENT : "var(--fg-dim, #9aa)",
              background: tab === t.key ? `${TASKS_ACCENT}14` : "transparent",
              border: `1px solid ${tab === t.key ? `${TASKS_ACCENT}55` : "var(--panel-border, #2a2436)"}`,
            }}
          >
            {t.key === "repeating" && <Repeat size={11} className="inline -mt-0.5 mr-1" />}
            {t.label}
          </button>
        ))}
        <button
          onClick={() => setNeedsYouOnly((v) => !v)}
          className="inline-flex items-center gap-1 px-2.5 h-7 rounded-full text-[11px] font-medium transition"
          title="Waiting / Review, or a drafted plan awaiting approval"
          style={{
            color: needsYouOnly ? "#fbbf24" : "var(--fg-dim, #9aa)",
            background: needsYouOnly ? "#fbbf2414" : "transparent",
            border: `1px solid ${needsYouOnly ? "#fbbf24" : "var(--panel-border, #2a2436)"}`,
          }}
        >
          <Hand size={11} /> needs you{needsYouCount > 0 ? ` · ${needsYouCount}` : ""}
        </button>
        {dateFilter && (
          <button
            onClick={onClearDateFilter}
            className="inline-flex items-center gap-1 px-2.5 h-7 rounded-full text-[11px] font-medium"
            style={{ color: TASKS_ACCENT, background: `${TASKS_ACCENT}14`, border: `1px solid ${TASKS_ACCENT}` }}
          >
            <CalendarDays size={11} /> {dateFilter} <X size={11} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto max-h-[320px]">
        {rows.length === 0 ? (
          <EmptyState title="No tasks here" hint={dateFilter ? "Nothing due on the selected day." : "Create one with 'New task'."} />
        ) : (
          rows.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2 px-1.5 py-1.5 rounded-lg transition hover:bg-[rgba(255,255,255,0.03)]"
            >
              <input
                type="checkbox"
                checked={t.status === "Done"}
                onChange={() => void onPatch(t.id, { status: t.status === "Done" ? "Todo" : "Done" })}
                title={t.status === "Done" ? "Reopen (Todo)" : "Mark Done"}
                style={{ accentColor: TASKS_ACCENT }}
                className="shrink-0"
              />
              <DisplayIdChip displayId={t.displayId} onClick={() => onOpen(t)} />
              <button
                onClick={() => onOpen(t)}
                className="flex-1 min-w-0 text-left text-[12.5px] truncate"
                style={{
                  color: t.status === "Done" ? "var(--fg-dimmer, #6b6478)" : "var(--fg, #e8e2f0)",
                  textDecoration: t.status === "Done" ? "line-through" : "none",
                }}
              >
                {t.title || "Untitled task"}
              </button>

              {typeof t.metadata?.scheduleText === "string" && (
                <span className="font-mono text-[10px] shrink-0 hidden sm:inline" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                  {t.metadata.scheduleText as string}
                  {t.maxOccurrences ? ` · ${Math.max(t.maxOccurrences - t.occurrenceCount, 0)} left` : ""}
                </span>
              )}
              {t.runAt && t.status !== "Done" && (
                <span className="font-mono text-[10px] shrink-0" style={{ color: "var(--fg-dim, #9aa)" }} title={t.runAt}>
                  {fmtUntil(t.runAt)}
                </span>
              )}
              <PlanChip planStatus={t.planStatus} />

              {/* date pill → native date picker → PATCH scheduledDate */}
              {datePickFor === t.id ? (
                <input
                  type="date"
                  autoFocus
                  defaultValue={t.scheduledDate ?? ""}
                  onBlur={() => setDatePickFor(null)}
                  onChange={(e) => {
                    const v = e.target.value || null;
                    setDatePickFor(null);
                    void onPatch(t.id, { scheduledDate: v });
                  }}
                  className="text-[11px] rounded px-1 shrink-0"
                  style={{ background: "var(--panel, rgba(255,255,255,0.02))", border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg, #e8e2f0)", colorScheme: "dark" }}
                />
              ) : (
                <button
                  onClick={() => setDatePickFor(t.id)}
                  className="inline-flex items-center gap-1 px-1.5 h-6 rounded text-[10px] font-mono shrink-0 transition"
                  title="Set a calendar date (no auto-fire — just a pin)"
                  style={{
                    color: t.scheduledDate ? TASKS_ACCENT : "var(--fg-dimmer, #6b6478)",
                    border: `1px solid ${t.scheduledDate ? `${TASKS_ACCENT}44` : "var(--panel-border, #2a2436)"}`,
                  }}
                >
                  <CalendarDays size={10} />
                  {t.scheduledDate ?? "date"}
                </button>
              )}
              <StatusDot status={t.status} />
            </div>
          ))
        )}
      </div>
      <div className="mt-2 pt-2 flex items-center justify-between" style={{ borderTop: "1px solid var(--panel-border, #2a2436)" }}>
        <Eyebrow>{rows.length} task{rows.length === 1 ? "" : "s"}</Eyebrow>
      </div>
    </div>
  );
}
