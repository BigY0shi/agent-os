"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";

// ── Memory V2 shared atoms (SPEC-A §6) ───────────────────────────────────────
// Muted-neobrutalist: CSS vars (--fg, --panel, --panel-border), memory accent
// #22d3ee (Sidebar NAV), tiny mono labels. Client-safe — NO server imports.

export const MEMORY_ACCENT = "#22d3ee";

// One hue per aspect, reused everywhere a badge/card shows an aspect.
export const ASPECT_COLORS: Record<string, string> = {
  Identity: "#22d3ee",
  Knowledge: "#60a5fa",
  Belief: "#a855f7",
  Preference: "#ec4899",
  Habit: "#fbbf24",
  Goal: "#34d399",
  Task: "#f97316",
  Directive: "#f43f5e",
  Decision: "#a3e635",
  Event: "#fde047",
  Problem: "#f87171",
  Relationship: "#c084fc",
};

export const STATUS_COLORS: Record<string, string> = {
  PENDING: "#fbbf24",    // amber
  PROCESSING: "#60a5fa", // blue
  COMPLETED: "#34d399",  // green
  FAILED: "#f87171",     // red
};

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
  if (Number.isNaN(t)) return iso;
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function AspectBadge({ aspect, struck }: { aspect: string | null | undefined; struck?: boolean }) {
  if (!aspect) return null;
  const c = ASPECT_COLORS[aspect] ?? "#9aa";
  return (
    <span
      className="inline-flex items-center px-1.5 py-[1px] rounded text-[9.5px] font-semibold uppercase tracking-[0.08em] shrink-0"
      style={{
        color: c,
        background: `${c}14`,
        border: `1px solid ${c}44`,
        opacity: struck ? 0.55 : 1,
      }}
    >
      {aspect}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? "#9aa";
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-[2px] rounded-full text-[10px] font-semibold uppercase tracking-[0.08em]"
      style={{ color: c, background: `${c}14`, border: `1px solid ${c}44` }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: c }} />
      {status}
    </span>
  );
}

export interface LabelRow {
  id: string;
  name: string;
  description: string | null;
  color: string;
  episodeCount?: number;
}

export function LabelChip({
  label, active, onClick,
}: { label: LabelRow; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-2 h-6 rounded-full text-[11px] font-medium transition"
      title={label.description ?? undefined}
      style={{
        color: active ? label.color : "var(--fg-dim, #9aa)",
        background: active ? `${label.color}18` : "var(--panel, rgba(255,255,255,0.02))",
        border: `1px solid ${active ? label.color : "var(--panel-border, #2a2436)"}`,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: label.color }} />
      {label.name}
      {typeof label.episodeCount === "number" && (
        <span style={{ color: "var(--fg-dimmer, #6b6478)" }}>{label.episodeCount}</span>
      )}
    </button>
  );
}

export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center gap-2">
      {icon && <div style={{ color: "var(--fg-dimmer, #6b6478)" }}>{icon}</div>}
      <div className="text-[13px] font-medium" style={{ color: "var(--fg-dim, #9aa)" }}>{title}</div>
      {hint && <div className="text-[11px] max-w-[420px] leading-relaxed" style={{ color: "var(--fg-dimmer, #6b6478)" }}>{hint}</div>}
    </div>
  );
}

/** Right-side slide-over shell — same pattern as ConfigMenu's drawer. */
export function SlideOver({
  title, accent = MEMORY_ACCENT, onClose, children, wide,
}: { title: ReactNode; accent?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`relative h-full w-full ${wide ? "max-w-[640px]" : "max-w-[480px]"} overflow-y-auto p-5 shadow-2xl`}
        style={{ background: "var(--bg, #0b0713)", borderLeft: `1px solid ${accent}55` }}
      >
        <div className="flex items-center justify-between mb-4 gap-3">
          <div className="text-[14px] font-semibold min-w-0" style={{ color: "var(--fg, #e8e2f0)" }}>{title}</div>
          <button onClick={onClose} className="shrink-0 text-[var(--fg-dimmer,#6b6478)] hover:text-[var(--fg,#e8e2f0)]" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Tiny mono section label (dashboard eyebrow style). */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
      {children}
    </span>
  );
}

export const inputStyle: React.CSSProperties = {
  background: "var(--panel, rgba(255,255,255,0.02))",
  border: "1px solid var(--panel-border, #2a2436)",
  color: "var(--fg, #e8e2f0)",
};
