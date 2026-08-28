"use client";

// ── HomeGrid (SPEC-D §6.5, H2.1) ────────────────────────────────────────────
// The widget grid: reads settings.home.cells (DEFAULT_HOME_CELLS fallback via
// resolveHomeCells), 3-col CSS grid (1-col below md), size S=1 / M=2 / L=3
// columns, renders a WidgetShell per cell in `order`. Mouse-first, NO drag/
// resize/add/remove yet — edit mode is H2.2 (chunk 2), which also mounts this
// into Overview (H1.1). One crashing widget shows an inline error panel only
// (WidgetShell's per-cell boundary).

import { useSettings } from "@/components/ConfigMenu";
import { getWidget } from "@/lib/v2/widgets/registry";
import { resolveHomeCells, type WidgetSize } from "@/lib/v2/widgets/types";
import WidgetShell from "./WidgetShell";
import { WIDGET_COMPONENTS } from "./widgetComponents";

// Literal Tailwind classes on purpose (JIT scans source text): span applies
// only ≥md — below md the grid is 1-col and every cell is full width.
const SPAN_CLASS: Record<WidgetSize, string> = {
  S: "md:col-span-1",
  M: "md:col-span-2",
  L: "md:col-span-3",
};

export default function HomeGrid() {
  const { settings } = useSettings();
  // While settings load (null) the defaults render — same layout in the
  // common unset case, so there is no flash for a stock install.
  const cells = resolveHomeCells((settings?.home as { cells?: unknown } | undefined)?.cells);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {cells.map((cell) => {
        const def = getWidget(cell.widgetSlug);
        if (!def) {
          // A layout row pointing at a slug the registry no longer carries —
          // inline notice, never a crash (and never silently dropped).
          return (
            <div
              key={cell.id}
              className="rounded-xl px-3 py-2.5 font-mono text-[11px] md:col-span-1"
              style={{ border: "1px dashed var(--panel-border, #2a2436)", color: "var(--fg-dimmer, #6b6478)" }}
            >
              unknown widget '{cell.widgetSlug}'
            </div>
          );
        }
        const Widget = WIDGET_COMPONENTS[cell.widgetSlug];
        return (
          <div key={cell.id} className={`min-w-0 ${SPAN_CLASS[cell.size]}`}>
            <WidgetShell cell={cell} def={def}>
              {Widget ? (
                <Widget config={cell.config ?? {}} cellId={cell.id} />
              ) : (
                <div className="font-mono text-[11px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                  '{cell.widgetSlug}' has no component registered
                </div>
              )}
            </WidgetShell>
          </div>
        );
      })}
    </div>
  );
}
