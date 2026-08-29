"use client";

// SPEC-E F5.2/F5.3 — /agents/[id] tabbed detail. Tabs per the chunk-4 scope:
// Overview (status band + lifecycle stepper + persona/harness cards + quick
// actions) · Runs (run list + transcript + browser-sessions sub-list from
// browser_sessions WHERE agent_id + status history) · Approvals (this agent's
// pending cards) · Settings (full editor incl. the V2 fields + danger-zone
// Exile — never hard-delete). Transcript/pickers/trigger editor are the
// AgentsView exports — reused, not duplicated.

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bot, Play, Loader2, ArrowLeft, Pause } from "lucide-react";
import type { AgentDef, ApprovalReq, BandStatus, RunMeta } from "@/lib/agentsTypes";
import { MODE_META } from "@/lib/agentsTypes";
import StatusBand, { STATUS_BAND_LABELS } from "@/components/v2/StatusBand";
import { AGENTS_ACCENT } from "./shared";
import OverviewTab from "./tabs/OverviewTab";
import RunsTab from "./tabs/RunsTab";
import ApprovalsTab from "./tabs/ApprovalsTab";
import SettingsTab from "./tabs/SettingsTab";

const TABS = ["overview", "runs", "approvals", "settings"] as const;
export type DetailTab = (typeof TABS)[number];

export interface SessionRow {
  id: number;
  session_name: string;
  profile_name: string;
  created_by: string;
  created_at: string;
  closed_at: string | null;
}

export interface StatusEventRow {
  id: number;
  ts: string;
  status: string;
  run_id: string | null;
  detail: string | null;
}

export default function AgentDetail({ id }: { id: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const initialTab = (search.get("tab") as DetailTab) || "overview";
  const [tab, setTab] = useState<DetailTab>(TABS.includes(initialTab) ? initialTab : "overview");

  const [agent, setAgent] = useState<AgentDef | null>(null);
  const [system, setSystem] = useState("");
  const [runs, setRuns] = useState<RunMeta[]>([]);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState<{ status: BandStatus; detail?: string } | null>(null);
  const [approvals, setApprovals] = useState<ApprovalReq[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [statusEvents, setStatusEvents] = useState<StatusEventRow[]>([]);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      const j = await fetch(`/api/agents/${id}`, { cache: "no-store" }).then((r) => r.json());
      if (j.agent) { setAgent(j.agent); setSystem(j.system ?? ""); setRuns(j.runs ?? []); setActive(!!j.active); }
      else if (j.error) setMissing(true);
    } catch { /* server asleep */ }
    try {
      const s = await fetch("/api/v2/agents/status?once=1", { cache: "no-store" }).then((r) => r.json());
      const mine = Array.isArray(s.agents) ? s.agents.find((e: { agentId: string }) => e.agentId === id) : null;
      if (mine) setStatus({ status: mine.status, detail: mine.detail });
    } catch { /* fine */ }
    try {
      const a = await fetch("/api/agents/approvals", { cache: "no-store" }).then((r) => r.json());
      if (Array.isArray(a.approvals)) setApprovals(a.approvals.filter((x: ApprovalReq) => x.agentId === id));
    } catch { /* fine */ }
    try {
      const t = await fetch(`/api/v2/agents/${id}/telemetry`, { cache: "no-store" }).then((r) => r.json());
      if (Array.isArray(t.sessions)) setSessions(t.sessions);
      if (Array.isArray(t.statusEvents)) setStatusEvents(t.statusEvents);
    } catch { /* fine */ }
  }, [id]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const patch = useCallback(async (p: Record<string, unknown>): Promise<{ ok: boolean; error?: string; warning?: string }> => {
    try {
      const r = await fetch(`/api/agents/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
      const j = await r.json().catch(() => ({}));
      await load();
      if (!r.ok) return { ok: false, error: j.error ?? `save failed (${r.status})` };
      return { ok: true, warning: j.warning };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message ?? e) };
    }
  }, [id, load]);

  const runNow = useCallback(async (): Promise<string | null> => {
    try {
      const j = await fetch(`/api/agents/${id}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then((r) => r.json());
      await load();
      setTab("runs");
      return j.runId ?? null;
    } catch { return null; }
  }, [id, load]);

  const exile = useCallback(async () => {
    if (!agent) return;
    if (!confirm(`Exile "${agent.name}"? The agent and its history move to the exile folder (recoverable).`)) return;
    const r = await fetch(`/api/agents/${id}`, { method: "DELETE" }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    if (r && !r.ok) { alert(j?.error ?? "exile failed"); return; }
    router.push("/agents");
  }, [agent, id, router]);

  if (missing) {
    return (
      <div className="p-6 max-w-[1000px] mx-auto">
        <div className="text-[13px]" style={{ color: "var(--fg-dim)" }}>Agent not found (exiled?).</div>
        <button onClick={() => router.push("/agents")} className="mt-3 text-[12.5px]" style={{ color: AGENTS_ACCENT }}>← Back to Agents</button>
      </div>
    );
  }
  if (!agent) {
    return (
      <div className="p-6 max-w-[1000px] mx-auto flex items-center gap-2 text-[13px]" style={{ color: "var(--fg-dimmer)" }}>
        <Loader2 size={14} className="animate-spin" /> loading agent…
      </div>
    );
  }

  const band = status?.status ?? (agent.enabled ? "idle" : "offline");

  return (
    <div className="p-6 max-w-[1000px] mx-auto">
      <button onClick={() => router.push("/agents")} className="mb-3 text-[12px] flex items-center gap-1" style={{ color: "var(--fg-dim)" }}>
        <ArrowLeft size={12} /> Agents
      </button>

      <div className="rounded-2xl border overflow-hidden mb-4" style={{ borderColor: "var(--panel-border)" }}>
        <StatusBand status={band} />
        <div className="p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5 min-w-0">
            <Bot size={18} style={{ color: AGENTS_ACCENT }} />
            <span className="text-[17px] font-medium truncate" style={{ color: "var(--fg)" }}>{agent.name}</span>
            <span className="text-[9.5px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0"
              style={{ borderColor: `${MODE_META[agent.permissionMode].color}55`, color: MODE_META[agent.permissionMode].color }}>
              {MODE_META[agent.permissionMode].label}
            </span>
            <span className="text-[11px] font-mono shrink-0" style={{ color: "var(--fg-dimmer)" }}>
              {STATUS_BAND_LABELS[band]}{status?.detail ? ` · ${status.detail}` : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void runNow()} disabled={active || !agent.enabled}
              className="px-3 h-8 rounded-lg border text-[12px] flex items-center gap-1.5 disabled:opacity-40 text-emerald-300"
              style={{ borderColor: "rgba(52,211,153,0.5)", background: "rgba(52,211,153,0.10)" }}>
              <Play size={12} /> Run now
            </button>
            <button onClick={() => void patch({ enabled: !agent.enabled })}
              className={`px-3 h-8 rounded-lg border text-[12px] flex items-center gap-1.5 ${agent.enabled ? "" : "text-amber-300"}`}
              style={{ borderColor: "var(--panel-border)", ...(agent.enabled ? { color: "var(--fg-dim)" } : {}) }}>
              <Pause size={12} /> {agent.enabled ? "Pause" : "Resume"}
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 mb-4">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className="px-3 h-8 rounded-lg border text-[12px] capitalize transition"
            style={{
              borderColor: tab === t ? AGENTS_ACCENT : "var(--panel-border)",
              color: tab === t ? AGENTS_ACCENT : "var(--fg-dim)",
              background: tab === t ? "rgba(167,139,250,0.10)" : "transparent",
            }}>
            {t}{t === "approvals" && approvals.length > 0 ? ` (${approvals.length})` : ""}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <OverviewTab agent={agent} system={system} band={band} detail={status?.detail} runs={runs} patch={patch} onRunNow={runNow} onExile={exile} />
      )}
      {tab === "runs" && (
        <RunsTab agentId={id} runs={runs} sessions={sessions} statusEvents={statusEvents} />
      )}
      {tab === "approvals" && (
        <ApprovalsTab approvals={approvals} onDecided={() => void load()} />
      )}
      {tab === "settings" && (
        <SettingsTab agent={agent} system={system} patch={patch} onExile={exile} />
      )}
    </div>
  );
}
