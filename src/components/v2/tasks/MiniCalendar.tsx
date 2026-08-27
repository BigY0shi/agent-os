"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Eyebrow } from "@/components/v2/memory/shared";
import { BOARD_COLUMNS, columnOf, TASKS_ACCENT, type TaskRowClient } from "./shared";

// ── MiniCalendar (SPEC-B §6 row 1 right) ─────────────────────────────────────
// Compact month grid; a day gets a dot per board column that has a task due
// that day (scheduled_date pin OR next run). Clicking a day filters the list.

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const DOW = ["S", "M", "T", "W", "T", "F", "S"];

export default function MiniCalendar({
  tasks,
  selected,
  onSelect,
}: {
  tasks: TaskRowClient[];
  selected: string | null;
  onSelect: (date: string | null) => void;
}) {
  const [anchor, setAnchor] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });

  const todayKey = ymd(new Date());

  /** date 'YYYY-MM-DD' → set of column accents with something due that day. */
  const dots = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const t of tasks) {
      const col = BOARD_COLUMNS.find((c) => c.key === columnOf(t.status));
      const accent = col?.accent ?? TASKS_ACCENT;
      const dates = new Set<string>();
      if (t.scheduledDate) dates.add(t.scheduledDate);
      if (t.runAt) dates.add(t.runAt.slice(0, 10));
      for (const d of dates) {
        if (!map.has(d)) map.set(d, new Set());
        map.get(d)!.add(accent);
      }
    }
    return map;
  }, [tasks]);

  const cells = useMemo(() => {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const start = first.getDay(); // 0 = Sunday
    const daysInMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
    const out: (string | null)[] = [];
    for (let i = 0; i < start; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(ymd(new Date(anchor.getFullYear(), anchor.getMonth(), d)));
    return out;
  }, [anchor]);

  const monthLabel = anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div
      className="rounded-xl p-3 flex flex-col"
      style={{ border: "1px solid var(--panel-border, #2a2436)", background: "var(--panel, rgba(255,255,255,0.02))" }}
    >
      <div className="flex items-center justify-between mb-2">
        <Eyebrow>{monthLabel}</Eyebrow>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setAnchor((a) => new Date(a.getFullYear(), a.getMonth() - 1, 1))}
            className="grid place-items-center w-6 h-6 rounded transition hover:bg-[rgba(255,255,255,0.05)]"
            style={{ color: "var(--fg-dim, #9aa)" }}
            aria-label="Previous month"
          >
            <ChevronLeft size={13} />
          </button>
          <button
            onClick={() => setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + 1, 1))}
            className="grid place-items-center w-6 h-6 rounded transition hover:bg-[rgba(255,255,255,0.05)]"
            style={{ color: "var(--fg-dim, #9aa)" }}
            aria-label="Next month"
          >
            <ChevronRight size={13} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-[2px] text-center mb-1">
        {DOW.map((d, i) => (
          <div key={`${d}${i}`} className="font-mono text-[9px] uppercase" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-[2px]">
        {cells.map((date, i) =>
          date === null ? (
            <div key={`pad-${i}`} />
          ) : (
            <button
              key={date}
              onClick={() => onSelect(selected === date ? null : date)}
              className="relative rounded-md py-1 text-[11px] transition"
              style={{
                color:
                  selected === date
                    ? TASKS_ACCENT
                    : date === todayKey
                      ? "var(--fg, #e8e2f0)"
                      : "var(--fg-dim, #9aa)",
                background: selected === date ? `${TASKS_ACCENT}18` : "transparent",
                border: `1px solid ${
                  selected === date ? `${TASKS_ACCENT}66` : date === todayKey ? "var(--panel-border, #2a2436)" : "transparent"
                }`,
              }}
            >
              {parseInt(date.slice(8), 10)}
              <span className="absolute inset-x-0 bottom-[1px] flex justify-center gap-[2px]">
                {[...(dots.get(date) ?? [])].slice(0, 3).map((c) => (
                  <span key={c} className="w-1 h-1 rounded-full" style={{ background: c }} />
                ))}
              </span>
            </button>
          ),
        )}
      </div>
    </div>
  );
}
