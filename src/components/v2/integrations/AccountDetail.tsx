"use client";

// SPEC-D G1 §6.1 — AccountDetail slide-over. Tabs per the chunk-3 brief:
// Overview (identity, toggles, disconnect) · Tools ([Try] via /call) ·
// Activity (activity list) · Sync (runs + manual sync) · Rules (CRUD) ·
// Logs (call logs). All data from the §5.3–5.6 routes; polling via
// usePollWhileVisible for the live tabs.

import { useCallback, useEffect, useState } from "react";
import { X, RefreshCw, Loader2, Unplug, ExternalLink } from "lucide-react";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import {
  INTEGRATIONS_ACCENT,
  INGEST_STATUS_COLORS,
  EmptyState,
  StatusChip,
  fmtAgo,
  fmtDate,
  monoStyle,
  panelStyle,
  type AccountInfo,
  type ActivityInfo,
  type CallLogInfo,
  type SyncRunInfo,
} from "./shared";
import ToolsTab from "./ToolsTab";
import RulesTab from "./RulesTab";

const TABS = ["overview", "tools", "activity", "sync", "rules", "logs"] as const;
type Tab = (typeof TABS)[number];

export default function AccountDetail({
  account: initial,
  connectorName,
  onClose,
  onChanged,
}: {
  account: AccountInfo;
  connectorName: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [account, setAccount] = useState<AccountInfo>(initial);
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refreshAccount = useCallback(async () => {
    try {
      const res = await fetch(`/api/v2/integrations/accounts/${initial.id}`, { cache: "no-store" });
      const j = await res.json();
      if (res.ok && j?.account) setAccount(j.account as AccountInfo);
    } catch {}
  }, [initial.id]);

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/v2/integrations/accounts/${initial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (res.ok && j?.account) setAccount(j.account as AccountInfo);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/v2/integrations/accounts/${initial.id}/sync`, { method: "POST" });
      const j = await res.json();
      if (res.status === 202 && j?.running) setNote("a sync is already running");
      else if (j?.ok) setNote(`synced — ${j.activitiesCount} new activit${j.activitiesCount === 1 ? "y" : "ies"}`);
      else setNote(j?.error ? `sync failed: ${j.error}` : "sync failed");
      refreshAccount();
      onChanged();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm(`Disconnect ${account.displayName ?? account.accountId}? The account row and its history are kept; reconnecting reactivates it.`)) return;
    setBusy(true);
    try {
      await fetch(`/api/v2/integrations/accounts/${initial.id}`, { method: "DELETE" });
      onChanged();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end" style={{ background: "rgba(0,0,0,0.45)" }} onClick={onClose}>
      <div
        className="h-full w-full max-w-[640px] overflow-y-auto p-5"
        style={{ background: "var(--panel-solid, #14101d)", borderLeft: `1px solid ${INTEGRATIONS_ACCENT}44` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <div>
            <h2 className="text-[15px] font-semibold leading-tight" style={{ color: "var(--fg, #e8e2f0)" }}>
              {account.displayName ?? account.accountId}
            </h2>
            <span className="font-mono text-[10px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
              {connectorName} · {account.accountId}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {!account.isActive && <StatusChip color="#9ca3af">disconnected</StatusChip>}
            <button onClick={onClose} className="grid place-items-center w-7 h-7 rounded-md" style={{ color: "var(--fg-dim, #9aa)" }}>
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="flex gap-1.5 mb-4 flex-wrap">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-2.5 h-7 rounded-lg text-[11.5px] font-medium capitalize transition"
              style={{
                border: `1px solid ${tab === t ? INTEGRATIONS_ACCENT : "var(--panel-border, #2a2436)"}`,
                color: tab === t ? INTEGRATIONS_ACCENT : "var(--fg-dim, #9aa)",
                background: tab === t ? `${INTEGRATIONS_ACCENT}0f` : "transparent",
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "overview" && (
          <div className="flex flex-col gap-3">
            <div className="rounded-xl p-3" style={panelStyle}>
              <div className="text-[11px] mb-1" style={{ color: "var(--fg-dimmer, #6b6478)" }}>Last sync</div>
              {account.lastSync ? (
                <div className="text-[12px]" style={{ color: "var(--fg, #e8e2f0)" }}>
                  {fmtAgo(account.lastSync.at)} ·{" "}
                  <span style={{ color: account.lastSync.ok ? "#34d399" : "#f87171" }}>
                    {account.lastSync.ok ? `ok, ${account.lastSync.activitiesCount} activities` : `failed${account.lastSync.error ? `: ${account.lastSync.error}` : ""}`}
                  </span>
                </div>
              ) : (
                <div className="text-[12px]" style={{ color: "var(--fg-dim, #9aa)" }}>never synced</div>
              )}
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={syncNow}
                  disabled={busy || !account.isActive}
                  className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12px] font-medium transition disabled:opacity-40"
                  style={{ border: `1px solid ${INTEGRATIONS_ACCENT}66`, background: `${INTEGRATIONS_ACCENT}18`, color: INTEGRATIONS_ACCENT }}
                >
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Sync now
                </button>
                {note && <span className="text-[11px]" style={{ color: "var(--fg-dim, #9aa)" }}>{note}</span>}
              </div>
            </div>

            <label className="flex items-start gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={account.autoActivityRead}
                disabled={busy}
                onChange={(e) => patch({ autoActivityRead: e.target.checked })}
                className="mt-[2px]"
                style={{ accentColor: INTEGRATIONS_ACCENT }}
              />
              <span>
                <span className="block text-[12px] font-medium" style={{ color: "var(--fg, #e8e2f0)" }}>Auto activity read</span>
                <span className="block text-[10.5px] leading-relaxed" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                  Scheduled sync + webhook processing for this account. Off = manual sync only.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={account.triggersEnabled}
                disabled={busy}
                onChange={(e) => patch({ triggersEnabled: e.target.checked })}
                className="mt-[2px]"
                style={{ accentColor: INTEGRATIONS_ACCENT }}
              />
              <span>
                <span className="block text-[12px] font-medium" style={{ color: "var(--fg, #e8e2f0)" }}>Triggers enabled</span>
                <span className="block text-[10.5px] leading-relaxed" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                  Lets this account&apos;s events fire automations (G5).
                </span>
              </span>
            </label>

            <div className="pt-2" style={{ borderTop: "1px solid var(--panel-border, #2a2436)" }}>
              <button
                onClick={disconnect}
                disabled={busy || !account.isActive}
                className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12px] font-medium transition disabled:opacity-40"
                style={{ border: "1px solid #f8717155", color: "#f87171" }}
              >
                <Unplug size={12} /> Disconnect
              </button>
              <span className="ml-2 text-[10.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                Deactivates only — history is kept; reconnecting reactivates.
              </span>
            </div>
          </div>
        )}

        {tab === "tools" && <ToolsTab accountId={initial.id} />}
        {tab === "activity" && <ActivityPanel accountId={initial.id} />}
        {tab === "sync" && <SyncPanel accountId={initial.id} onSyncNow={syncNow} busy={busy} note={note} />}
        {tab === "rules" && <RulesTab accountId={initial.id} />}
        {tab === "logs" && <LogsPanel accountId={initial.id} />}
      </div>
    </div>
  );
}

// ── Activity tab ─────────────────────────────────────────────────────────────

function ActivityPanel({ accountId }: { accountId: string }) {
  const [activities, setActivities] = useState<ActivityInfo[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/v2/integrations/accounts/${accountId}/activity?limit=50`, { cache: "no-store" });
      const j = await res.json();
      if (res.ok && Array.isArray(j?.activities)) setActivities(j.activities as ActivityInfo[]);
    } catch {}
  }, [accountId]);

  usePollWhileVisible(refresh, 15000, [refresh]);

  if (activities === null) return <EmptyState title="Loading activity…" />;
  if (activities.length === 0) return <EmptyState title="No activity yet" hint="Run a sync (Sync tab) — accepted items land here and ride into memory." />;

  return (
    <div className="flex flex-col gap-1.5">
      {activities.map((a) => (
        <div key={a.id} className="rounded-lg px-3 py-2" style={panelStyle}>
          <div className="flex items-center gap-2 mb-1">
            <StatusChip color={INGEST_STATUS_COLORS[a.ingestStatus] ?? "#9aa"}>{a.ingestStatus}</StatusChip>
            {a.eventType && (
              <span className="font-mono text-[9.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>{a.eventType}</span>
            )}
            <span className="ml-auto font-mono text-[9.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>{fmtAgo(a.createdAt)}</span>
          </div>
          <div className="text-[11.5px] leading-relaxed break-words" style={{ color: "var(--fg, #e8e2f0)" }}>
            {a.text}
          </div>
          {a.rejectionReason && (
            <div className="mt-1 text-[10.5px]" style={{ color: "#9ca3af" }}>rejected: {a.rejectionReason}</div>
          )}
          {a.sourceUrl && (
            <a
              href={a.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-[10.5px]"
              style={{ color: INTEGRATIONS_ACCENT }}
            >
              <ExternalLink size={10} /> source
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Sync tab ─────────────────────────────────────────────────────────────────

function SyncPanel({
  accountId,
  onSyncNow,
  busy,
  note,
}: {
  accountId: string;
  onSyncNow: () => void;
  busy: boolean;
  note: string | null;
}) {
  const [runs, setRuns] = useState<SyncRunInfo[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/v2/integrations/accounts/${accountId}/logs`, { cache: "no-store" });
      const j = await res.json();
      if (res.ok && Array.isArray(j?.syncs)) setRuns(j.syncs as SyncRunInfo[]);
    } catch {}
  }, [accountId]);

  usePollWhileVisible(refresh, 10000, [refresh]);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={onSyncNow}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12px] font-medium transition disabled:opacity-40"
          style={{ border: `1px solid ${INTEGRATIONS_ACCENT}66`, background: `${INTEGRATIONS_ACCENT}18`, color: INTEGRATIONS_ACCENT }}
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Sync now
        </button>
        {note && <span className="text-[11px]" style={{ color: "var(--fg-dim, #9aa)" }}>{note}</span>}
      </div>
      {runs === null ? (
        <EmptyState title="Loading sync runs…" />
      ) : runs.length === 0 ? (
        <EmptyState title="No sync runs yet" />
      ) : (
        <div className="flex flex-col gap-1">
          {runs.map((r) => (
            <div key={r.id} className="rounded-lg px-3 py-1.5 flex items-center gap-2" style={panelStyle}>
              <StatusChip color={r.ok === null ? "#fbbf24" : r.ok ? "#34d399" : "#f87171"}>
                {r.ok === null ? "running" : r.ok ? "ok" : "failed"}
              </StatusChip>
              <span className="font-mono text-[10px]" style={{ color: "var(--fg-dim, #9aa)" }}>{r.trigger}</span>
              <span className="text-[11px]" style={{ color: "var(--fg-dim, #9aa)" }}>
                {r.activitiesCount} activit{r.activitiesCount === 1 ? "y" : "ies"}
              </span>
              {r.error && <span className="truncate text-[10.5px]" style={{ color: "#f87171" }}>{r.error}</span>}
              <span className="ml-auto font-mono text-[9.5px] shrink-0" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                {fmtDate(r.startedAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Logs tab ─────────────────────────────────────────────────────────────────

function LogsPanel({ accountId }: { accountId: string }) {
  const [calls, setCalls] = useState<CallLogInfo[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/v2/integrations/accounts/${accountId}/logs`, { cache: "no-store" });
      const j = await res.json();
      if (res.ok && Array.isArray(j?.calls)) setCalls(j.calls as CallLogInfo[]);
    } catch {}
  }, [accountId]);

  usePollWhileVisible(refresh, 10000, [refresh]);

  if (calls === null) return <EmptyState title="Loading call logs…" />;
  if (calls.length === 0) return <EmptyState title="No tool calls yet" hint="Every [Try], automation and MCP call lands here with redacted args." />;

  return (
    <div className="flex flex-col gap-1">
      {calls.map((c) => (
        <div key={c.id} className="rounded-lg px-3 py-1.5" style={panelStyle}>
          <button className="w-full flex items-center gap-2 text-left" onClick={() => setExpanded((e) => (e === c.id ? null : c.id))}>
            <StatusChip color={c.ok ? "#34d399" : "#f87171"}>{c.ok ? "ok" : "err"}</StatusChip>
            <span className="font-mono text-[11px] truncate" style={{ color: "var(--fg, #e8e2f0)" }}>{c.toolName}</span>
            {c.source && <span className="font-mono text-[9.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>{c.source}</span>}
            {c.durationMs !== null && (
              <span className="font-mono text-[9.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>{c.durationMs}ms</span>
            )}
            <span className="ml-auto font-mono text-[9.5px] shrink-0" style={{ color: "var(--fg-dimmer, #6b6478)" }}>{fmtAgo(c.createdAt)}</span>
          </button>
          {expanded === c.id && (
            <div className="mt-1.5">
              <pre className="text-[10.5px] max-h-[140px] overflow-auto" style={{ ...monoStyle, color: "var(--fg-dim, #9aa)" }}>
                {JSON.stringify(c.args, null, 2)}
              </pre>
              {c.error && <div className="mt-1 text-[10.5px]" style={{ color: "#f87171" }}>{c.error}</div>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
