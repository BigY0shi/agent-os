"use client";

import { useCallback, useState } from "react";
import { ChevronDown, ChevronRight, ListOrdered, Loader2, RotateCcw } from "lucide-react";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import { EmptyState, StatusPill, fmtAgo, fmtDate, inputStyle } from "./shared";

// ── IngestLogs (SPEC-A A8.4 / A2 logs UI) ────────────────────────────────────
// GET /api/v2/memory/logs?status=&limit= → ingestion_queue rows, newest first.
// Status pills: PENDING amber / PROCESSING blue / COMPLETED green / FAILED red.
// FAILED rows get a Retry button → POST /logs {id, action:"retry"} (max 3).

interface LogRow {
  id: string;
  status: string;
  stage: string | null;
  source: string;
  title: string | null;
  sessionId: string | null;
  graphIds: string[];
  labelIds: string[];
  error: string | null;
  retryCount: number;
  createdAt: string;
  processedAt: string | null;
}

const STATUS_FILTERS = ["", "PENDING", "PROCESSING", "COMPLETED", "FAILED"] as const;

export default function IngestLogs() {
  const [status, setStatus] = useState<string>("");
  const [logs, setLogs] = useState<LogRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retryErr, setRetryErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const sp = new URLSearchParams({ limit: "100" });
      if (status) sp.set("status", status);
      const r = await fetch(`/api/v2/memory/logs?${sp.toString()}`, { cache: "no-store" });
      const j = await r.json();
      if (Array.isArray(j?.logs)) { setLogs(j.logs as LogRow[]); setFailed(false); }
    } catch { setFailed(true); }
  }, [status]);

  usePollWhileVisible(refresh, 3000, [status]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function retry(id: string) {
    setRetrying(id); setRetryErr(null);
    try {
      const r = await fetch("/api/v2/memory/logs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action: "retry" }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setRetryErr(j?.error ?? `retry failed (${r.status})`);
      await refresh();
    } catch { setRetryErr("server unreachable"); }
    finally { setRetrying(null); }
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <select value={status} onChange={(e) => setStatus(e.target.value)}
          className="h-7 rounded-md px-2 text-[11.5px] outline-none" style={inputStyle}>
          {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s || "all statuses"}</option>)}
        </select>
        {retryErr && <span className="text-[11px]" style={{ color: "#f87171" }}>{retryErr}</span>}
        <span className="ml-auto font-mono text-[10.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
          {failed ? "feed unreachable" : logs ? `${logs.length} rows` : "loading…"}
        </span>
      </div>

      {logs === null ? (
        <EmptyState title={failed ? "Feed unreachable" : "Loading ingestion queue…"} />
      ) : logs.length === 0 ? (
        <EmptyState icon={<ListOrdered size={22} />} title="Queue is empty"
          hint="Every ingest — manual, MCP, or migration — shows up here with its stage and result." />
      ) : (
        <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--panel-border, #2a2436)" }}>
          <table className="w-full text-[12px]" style={{ minWidth: 720 }}>
            <thead>
              <tr className="font-mono text-[9.5px] uppercase tracking-[0.15em]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                {["", "status", "stage", "source", "title / session", "episodes", "retries", "created"].map((h, i) => (
                  <th key={i} className="text-left font-medium px-3 py-2" style={{ borderBottom: "1px solid var(--panel-border, #2a2436)" }}>{h}</th>
                ))}
                <th className="px-3 py-2" style={{ borderBottom: "1px solid var(--panel-border, #2a2436)" }} />
              </tr>
            </thead>
            <tbody>
              {logs.map((row) => {
                const open = expanded.has(row.id);
                const expandable = !!row.error;
                return [
                  <tr key={row.id}
                    className={expandable ? "cursor-pointer" : undefined}
                    onClick={expandable ? () => toggle(row.id) : undefined}
                    style={{ borderBottom: "1px solid var(--panel-border, #2a2436)" }}>
                    <td className="pl-3 py-2 w-5">
                      {expandable && (open
                        ? <ChevronDown size={12} style={{ color: "var(--fg-dimmer, #6b6478)" }} />
                        : <ChevronRight size={12} style={{ color: "var(--fg-dimmer, #6b6478)" }} />)}
                    </td>
                    <td className="px-3 py-2"><StatusPill status={row.status} /></td>
                    <td className="px-3 py-2 font-mono text-[10.5px]" style={{ color: "var(--fg-dim, #9aa)" }}>{row.stage ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-[10.5px]" style={{ color: "var(--fg-dim, #9aa)" }}>{row.source}</td>
                    <td className="px-3 py-2 max-w-[240px]">
                      <span className="block truncate" style={{ color: "var(--fg, #e8e2f0)" }}>
                        {row.title ?? (row.sessionId ? `session ${row.sessionId.slice(0, 8)}…` : "—")}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[10.5px]" style={{ color: "var(--fg-dim, #9aa)" }}>{row.graphIds.length}</td>
                    <td className="px-3 py-2 font-mono text-[10.5px]" style={{ color: row.retryCount > 0 ? "#fbbf24" : "var(--fg-dimmer, #6b6478)" }}>{row.retryCount}</td>
                    <td className="px-3 py-2 font-mono text-[10.5px] whitespace-nowrap" title={fmtDate(row.createdAt)} style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                      {fmtAgo(row.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {row.status === "FAILED" && (
                        <button
                          onClick={(e) => { e.stopPropagation(); void retry(row.id); }}
                          disabled={retrying === row.id}
                          className="inline-flex items-center gap-1 px-2 h-6 rounded-md text-[10.5px] font-semibold disabled:opacity-50"
                          style={{ border: "1px solid #f8717155", color: "#f87171" }}
                        >
                          {retrying === row.id ? <Loader2 size={10} className="animate-spin" /> : <RotateCcw size={10} />}
                          Retry
                        </button>
                      )}
                    </td>
                  </tr>,
                  open && row.error ? (
                    <tr key={`${row.id}:err`} style={{ borderBottom: "1px solid var(--panel-border, #2a2436)" }}>
                      <td colSpan={9} className="px-4 py-2.5">
                        <pre className="whitespace-pre-wrap font-mono text-[10.5px] leading-relaxed max-h-[200px] overflow-y-auto"
                          style={{ color: "#f87171" }}>
                          {row.error}
                        </pre>
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
