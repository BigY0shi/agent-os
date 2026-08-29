// Shared client-safe bits for the /browser surface (SPEC-E §6). Zero node
// imports — this file is imported by client components only.

export const BROWSER_ACCENT = "#38bdf8"; // sky (§6 accent table)

/** Wire shape of GET /api/v2/browser/sessions rows (route as-built, chunk 1). */
export interface SessionWire {
  name: string;
  profile: string;
  allowedDomains?: string[];
  live: boolean;
  cdpReady: boolean;
  headed: boolean;
  currentUrl?: string;
}

/** Wire shape of GET /api/v2/browser/audit rows (route as-built, chunk 1). */
export interface AuditRowWire {
  id: number;
  ts: string;
  session_name: string;
  tool: string;
  caller: string;
  args_preview: string | null;
  ok: number;
  error: string | null;
}

export const panelStyle: React.CSSProperties = {
  background: "var(--panel, rgba(255,255,255,0.02))",
  border: "1px solid var(--panel-border, #2a2436)",
};

export const inputStyle: React.CSSProperties = {
  background: "var(--panel, rgba(255,255,255,0.02))",
  border: "1px solid var(--panel-border, #2a2436)",
  color: "var(--fg, #e8e2f0)",
};

export function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
