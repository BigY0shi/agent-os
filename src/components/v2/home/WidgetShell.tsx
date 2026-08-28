"use client";

// ── WidgetShell (SPEC-D §6.5, H2.1 + H2.2) ──────────────────────────────────
// Panel chrome for one home-grid cell: title bar + body wrapped in a PER-CELL
// error boundary — a crashing widget renders an inline error panel, never the
// page. H2.2 edit-mode controls live in the title bar (drag grip · gear ·
// size cycle · remove — remove drops the cell from the LAYOUT, never deletes
// data). Chromeless defs (the legacy-* wrappers, which bring their own panel
// chrome) render bare outside edit mode so the default layout stays
// pixel-identical to the pre-rework Overview; edit mode always shows the bar
// so every cell stays draggable/configurable.

import React, { Component, type ReactNode } from "react";
import { AlertTriangle, GripVertical, Proportions, Settings as Gear, X } from "lucide-react";
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

function EditButton({
  title,
  onClick,
  accent,
  children,
}: {
  title: string;
  onClick?: () => void;
  accent?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid h-6 min-w-6 shrink-0 place-items-center rounded-md px-1 font-mono text-[10px]"
      style={{
        border: `1px solid ${accent ? `${accent}55` : "var(--panel-border, #2a2436)"}`,
        color: accent ?? "var(--fg-dim, #9aa)",
      }}
      title={title}
      aria-label={title}
    >
      {children}
    </button>
  );
}

export default function WidgetShell({
  cell,
  def,
  children,
  edit = false,
  onConfigure,
  onSizeCycle,
  onRemove,
}: {
  cell: HomeCell;
  def: WidgetDef;
  children: ReactNode;
  /** H2.2 edit mode — shows the control bar (drag grip · gear · size · remove). */
  edit?: boolean;
  onConfigure?: () => void;
  onSizeCycle?: () => void;
  onRemove?: () => void;
}) {
  // Legacy wrappers keep their own chrome outside edit mode (§6.6 zero visual
  // change); edit mode always frames the cell so its controls have a home.
  if (def.chromeless && !edit) {
    return (
      <div data-cell-id={cell.id} className="h-full">
        <WidgetErrorBoundary title={def.title}>{children}</WidgetErrorBoundary>
      </div>
    );
  }

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
        <div className="flex min-w-0 items-center gap-1.5">
          {edit ? (
            <GripVertical
              size={13}
              className="shrink-0 cursor-grab"
              style={{ color: "var(--fg-dimmer, #6b6478)" }}
              aria-hidden
            />
          ) : null}
          <div
            className="truncate font-mono text-[10px] uppercase tracking-wider"
            style={{ color: "var(--fg-dim, #9aa)" }}
          >
            {def.title}
          </div>
        </div>
        {edit ? (
          <div className="flex shrink-0 items-center gap-1">
            {def.configSchema?.length ? (
              <EditButton title={`Configure '${def.title}'`} onClick={onConfigure}>
                <Gear size={12} />
              </EditButton>
            ) : null}
            <EditButton title={`Cycle size (now ${cell.size})`} onClick={onSizeCycle}>
              <span className="inline-flex items-center gap-1">
                <Proportions size={12} /> {cell.size}
              </span>
            </EditButton>
            <EditButton
              title={`Remove '${def.title}' from the layout (data is never deleted)`}
              onClick={onRemove}
              accent="#f87171"
            >
              <X size={12} />
            </EditButton>
          </div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1">
        <WidgetErrorBoundary title={def.title}>{children}</WidgetErrorBoundary>
      </div>
    </section>
  );
}
