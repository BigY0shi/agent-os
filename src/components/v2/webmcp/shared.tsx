"use client";

import type { ReactNode } from "react";
import type { WebmcpSpec } from "@/lib/v2/webmcp/types";

// ── WebMCP shared atoms (SPEC-C D3) ──────────────────────────────────────────
// Muted-neobrutalist idiom (CSS vars --fg/--panel/--panel-border), tool-brass
// accent #b7852f (Sidebar NAV). Client-safe — NO server imports.

export const WEBMCP_ACCENT = "#b7852f";

export const PKG_STATUS_COLORS: Record<string, string> = {
  draft: "#fbbf24",
  published: "#34d399",
  archived: "#9ca3af",
};

export const HANDLER_KIND_COLORS: Record<string, string> = {
  internal: "#60a5fa",
  http: "#34d399",
  js: "#c084fc",
};

// Client mirrors of the store/route response shapes.
export interface PkgSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  status: "draft" | "published" | "archived";
  currentVersion: number;
  toolCount?: number;
  spec?: WebmcpSpec | null;
  updatedAt: string;
}

export interface ToolRow {
  id: string;
  packageId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handlerKind: "internal" | "http" | "js";
  handlerConfig: Record<string, unknown>;
  requiresApproval: boolean;
  position: number;
  updatedAt: string;
}

export interface VersionRow {
  id: string;
  version: number;
  publishedAt: string;
}

export interface LogRow {
  id: string;
  packageSlug: string;
  toolName: string;
  source: string;
  argsJson: string;
  ok: boolean;
  error: string | null;
  durationMs: number;
  createdAt: string;
}

export interface PkgDetail {
  package: PkgSummary;
  tools: ToolRow[];
  versions: VersionRow[];
  secretNames: string[];
  recentLogs: LogRow[];
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
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

export function StatusPill({ status }: { status: string }) {
  const c = PKG_STATUS_COLORS[status] ?? "#9aa";
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

export function KindBadge({ kind }: { kind: string }) {
  const c = HANDLER_KIND_COLORS[kind] ?? "#9aa";
  return (
    <span
      className="inline-flex items-center px-1.5 py-[1px] rounded text-[9.5px] font-semibold uppercase tracking-[0.08em] shrink-0"
      style={{ color: c, background: `${c}14`, border: `1px solid ${c}44` }}
    >
      {kind}
    </span>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
      {children}
    </span>
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

export const inputStyle: React.CSSProperties = {
  background: "var(--panel, rgba(255,255,255,0.02))",
  border: "1px solid var(--panel-border, #2a2436)",
  color: "var(--fg, #e8e2f0)",
};

export const panelStyle: React.CSSProperties = {
  border: "1px solid var(--panel-border, #2a2436)",
  background: "var(--panel, rgba(255,255,255,0.02))",
};

export const monoStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
};
