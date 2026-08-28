"use client";

// ── WidgetShell (SPEC-D §6.5, H2.1) ─────────────────────────────────────────
// Panel chrome for one home-grid cell: title bar + body wrapped in a PER-CELL
// error boundary — a crashing widget renders an inline error panel, never the
// page. Edit-mode controls (gear · drag handle · size cycle · remove) are
// chunk-2 territory (H2.2); no DnD here.

import React, { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import type { HomeCell, WidgetDef } from "@/lib/v2/widgets/types";

class WidgetErrorBoundary extends Component<
  { title: string; children: ReactNode },
  { error: string | null }
> {
  state: { error: string | null } = { error: null };

  static getDerivedStateFromError(err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  componentDidCatch(err: unknown) {
    console.error("[v2/home] widget crashed:", this.props.title, err);
  }

  render() {
    if (this.state.error !== null) {
      return (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-[12px]"
          style={{ border: "1px solid #f8717155", background: "#f871710d", color: "var(--fg-dim, #9aa)" }}
        >
          <AlertTriangle size={14} style={{ color: "#f87171", marginTop: 1 }} />
          <div>
            <div style={{ color: "#f87171" }}>“{this.props.title}” crashed</div>
            <div className="font-mono text-[10px] break-all">{this.state.error}</div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function WidgetShell({
  cell,
  def,
  children,
}: {
  cell: HomeCell;
  def: WidgetDef;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={def.title}
      data-cell-id={cell.id}
      className="flex h-full flex-col rounded-xl p-3.5"
      style={{
        border: "1px solid var(--panel-border, #2a2436)",
        background: "var(--panel, rgba(255,255,255,0.02))",
      }}
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div
          className="font-mono text-[10px] uppercase tracking-wider"
          style={{ color: "var(--fg-dim, #9aa)" }}
        >
          {def.title}
        </div>
        {/* edit-mode controls (gear · drag · size · remove) land in H2.2 */}
      </div>
      <div className="min-h-0 flex-1">
        <WidgetErrorBoundary title={def.title}>{children}</WidgetErrorBoundary>
      </div>
    </section>
  );
}
