"use client";

import { ChevronLeft, ChevronRight, LayoutGrid, NotebookPen } from "lucide-react";
import ConfigMenu from "@/components/ConfigMenu";
import ScratchpadSettings from "./ScratchpadSettings";
import { SCRATCHPAD_ACCENT, fmtDayTitle } from "./shared";

// ── PageHeader (SPEC-B B5) — date navigation + Widgets toggle (S32) + gear ──

export default function PageHeader({
  date,
  isToday,
  onPrev,
  onNext,
  onToday,
  widgetsOpen,
  onToggleWidgets,
}: {
  date: string | null;
  isToday: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  /** S32: whether the widgets panel is shown; null while settings load. */
  widgetsOpen: boolean | null;
  onToggleWidgets: () => void;
}) {
  const navBtn = "grid h-8 w-8 place-items-center rounded-lg transition";
  const navStyle: React.CSSProperties = {
    border: "1px solid var(--panel-border, #2a2436)",
    color: "var(--fg-dim, #a89fb8)",
    background: "var(--panel, rgba(255,255,255,0.02))",
  };

  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <div className="flex items-center gap-2.5">
        <div
          className="grid h-9 w-9 place-items-center rounded-xl"
          style={{ background: `${SCRATCHPAD_ACCENT}14`, border: `1px solid ${SCRATCHPAD_ACCENT}44` }}
        >
          <NotebookPen size={17} style={{ color: SCRATCHPAD_ACCENT }} />
        </div>
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight leading-tight" style={{ color: "var(--fg, #e8e2f0)" }}>
            {fmtDayTitle(date)}
          </h1>
          <div className="font-mono text-[10px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
            {isToday ? "today" : date ?? ""} · type [ ] for a task · @jarvis to ask
          </div>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2 flex-wrap">
        <button type="button" onClick={onPrev} className={navBtn} style={navStyle} title="Previous day">
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          onClick={onToday}
          disabled={isToday}
          className="px-2.5 h-8 rounded-lg text-[12px] font-medium transition disabled:opacity-40"
          style={{
            border: `1px solid ${isToday ? "var(--panel-border, #2a2436)" : `${SCRATCHPAD_ACCENT}55`}`,
            color: isToday ? "var(--fg-dim, #a89fb8)" : SCRATCHPAD_ACCENT,
            background: "var(--panel, rgba(255,255,255,0.02))",
          }}
        >
          Today
        </button>
        <button type="button" onClick={onNext} className={navBtn} style={navStyle} title="Next day">
          <ChevronRight size={14} />
        </button>

        {/* S32: the Mission Control widget grid, hosted on Today with its own
            cells list (settings.home.todayCells); open state is a setting too. */}
        <button
          type="button"
          onClick={onToggleWidgets}
          disabled={widgetsOpen === null}
          aria-pressed={widgetsOpen === true}
          title={widgetsOpen ? "Hide the widgets panel" : "Show the widgets panel (same widgets as Mission Control, your own layout here)"}
          className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-[12px] font-medium transition disabled:opacity-40"
          style={{
            border: `1px solid ${widgetsOpen ? `${SCRATCHPAD_ACCENT}55` : "var(--panel-border, #2a2436)"}`,
            color: widgetsOpen ? SCRATCHPAD_ACCENT : "var(--fg-dim, #a89fb8)",
            background: "var(--panel, rgba(255,255,255,0.02))",
          }}
        >
          <LayoutGrid size={13} /> Widgets
        </button>

        <ConfigMenu title="Scratchpad Settings" accent={SCRATCHPAD_ACCENT}>
          <ScratchpadSettings />
        </ConfigMenu>
      </div>
    </div>
  );
}
