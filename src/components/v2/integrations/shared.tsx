"use client";

import type { ReactNode } from "react";
// lucide dropped brand icons — GitBranch/MessageSquare stand in for GitHub/Slack.
import {
  Mail,
  CalendarDays,
  FileText,
  GitBranch,
  MessageSquare,
  Radio,
  FlaskConical,
  Plug,
} from "lucide-react";

// ── Integrations shared atoms (SPEC-D G1 §6.1) ──────────────────────────────
// Muted-neobrutalist idiom (CSS vars --fg/--panel/--panel-border), mint-plug
// accent #7dd3a8 (spec-suggested, unused elsewhere). Client-safe — NO server
// imports. Shapes mirror the §5.1–5.6 route responses.

export const INTEGRATIONS_ACCENT = "#7dd3a8";

export interface TriggerInfo {
  key: string;
  label: string;
}

export interface AuthFieldInfo {
  name: string;
  label?: string;
  placeholder?: string;
  description?: string;
}

export interface AccountInfo {
  id: string;
  accountId: string;
  displayName: string | null;
  isActive: boolean;
  autoActivityRead: boolean;
  triggersEnabled: boolean;
  lastSync?: { at: string; ok: boolean; activitiesCount: number; error?: string };
}

export interface ConnectorInfo {
  slug: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  auth: "oauth2" | "api_key" | "local";
  hasApiKey: boolean;
  authFields: AuthFieldInfo[];
  uiHint: string;
  hasSchedule: boolean;
  triggers: TriggerInfo[];
  configured: boolean;
  accounts: AccountInfo[];
}

export interface ToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

export interface ActivityInfo {
  id: string;
  text: string;
  sourceUrl: string | null;
  eventType: string | null;
  rejectionReason: string | null;
  ingestStatus: "pending" | "ingested" | "rejected" | "failed";
  createdAt: string;
}

export interface CallLogInfo {
  id: string;
  toolName: string;
  source: string | null;
  args: Record<string, unknown>;
  ok: boolean;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
}

export interface SyncRunInfo {
  id: string;
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  ok: boolean | null;
  activitiesCount: number;
  error: string | null;
}

export interface RuleInfo {
  id: string;
  name: string | null;
  text: string;
  preFilter: { include?: string[]; exclude?: string[] } | null;
  isActive: boolean;
  createdAt: string;
}

/** Connector icon: registry `icon` strings → lucide components. */
export function connectorIcon(icon: string, size = 16): ReactNode {
  switch (icon) {
    case "gmail":
      return <Mail size={size} />;
    case "google-calendar":
      return <CalendarDays size={size} />;
    case "notion":
      return <FileText size={size} />;
    case "github":
      return <GitBranch size={size} />;
    case "slack":
      return <MessageSquare size={size} />;
    case "buzz":
      return <Radio size={size} />;
    case "flask":
      return <FlaskConical size={size} />;
    default:
      return <Plug size={size} />;
  }
}

export const INGEST_STATUS_COLORS: Record<string, string> = {
  pending: "#fbbf24",
  ingested: "#34d399",
  rejected: "#9ca3af",
  failed: "#f87171",
};

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

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function StatusChip({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-[2px] rounded-full text-[10px] font-semibold uppercase tracking-[0.08em]"
      style={{ color, background: `${color}14`, border: `1px solid ${color}44` }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
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
