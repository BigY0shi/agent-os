"use client";

// SPEC-C D3.5 — Logs tab: call logs with ok/error chips + source column.
// First page rides in the package GET (recentLogs); older pages come from
// GET /api/v2/webmcp/packages/[id]/logs with `before` cursor paging.

import { useEffect, useState } from "react";
import { RefreshCw, Loader2, ChevronDown } from "lucide-react";
import { WEBMCP_ACCENT, EmptyState, fmtDate, monoStyle, type LogRow } from "./shared";

export default function LogsPanel({
  slug,
  initialLogs,
  onRefresh,
}: {
  slug: string;
  initialLogs: LogRow[];
  onRefresh: () => void;
}) {
  const [logs, setLogs] = useState<LogRow[]>(initialLogs);
  const [cursor, setCursor] = useState<string | null>(
    initialLogs.length > 0 ? initialLogs[initialLogs.length - 1].createdAt : null,
  );
  const [loading, setLoading] = useState(false);
  const [exhausted, setExhausted] = useState(initialLogs.length < 20);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setLogs(initialLogs);
    setCursor(initialLogs.length > 0 ? initialLogs[initialLogs.length - 1].createdAt : null);
    setExhausted(initialLogs.length < 20);
  }, [initialLogs]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/v2/webmcp/packages/${slug}/logs?before=${encodeURIComponent(cursor)}&limit=50`,
        { cache: "no-store" },
      );
      const j = (await res.json()) as { logs?: LogRow[]; nextCursor?: string | null };
      const more = Array.isArray(j.logs) ? j.logs : [];
      setLogs((l) => [...l, ...more]);
      setCursor(j.nextCursor ?? null);
      if (!j.nextCursor) setExhausted(true);
    } catch {
      /* offline — leave what we have */
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={onRefresh}
          className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-[11.5px] font-medium transition"
          style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}
        >
          <RefreshCw size={11} /> Refresh
        </button>
        <span className="text-[10.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
          Args are stored redacted (secret-looking keys + configured secret values masked), capped 4KB.
        </span>
      </div>

      {logs.length === 0 ? (
        <EmptyState title="No calls logged" hint="Every tool run — sandbox tests, hub calls, Jarvis — writes one append-only row here." />
      ) : (
        <div className="flex flex-col gap-1">
          {logs.map((l) => (
            <div
              key={l.id}
              className="rounded-lg px-2.5 py-1.5"
              style={{ border: "1px solid var(--panel-border, #2a2436)", background: "var(--panel, rgba(255,255,255,0.02))" }}
            >
              <button className="flex items-center gap-2 w-full min-w-0 text-left" onClick={() => setExpanded((e) => (e === l.id ? null : l.id))}>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: l.ok ? "#34d399" : "#f87171" }} />
                <span className="font-mono text-[11.5px] truncate" style={{ color: "var(--fg, #e8e2f0)" }}>{l.toolName}</span>
                <span
                  className="px-1.5 py-[1px] rounded text-[9.5px] font-semibold uppercase tracking-[0.08em] shrink-0"
                  style={{ color: WEBMCP_ACCENT, background: `${WEBMCP_ACCENT}14`, border: `1px solid ${WEBMCP_ACCENT}33` }}
                >
                  {l.source}
                </span>
                <span className="ml-auto shrink-0 font-mono text-[10px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                  {l.durationMs}ms · {fmtDate(l.createdAt)}
                </span>
                <ChevronDown size={11} className="shrink-0 transition" style={{ color: "var(--fg-dimmer, #6b6478)", transform: expanded === l.id ? "rotate(180deg)" : "none" }} />
              </button>
              {expanded === l.id && (
                <div className="mt-1.5 pt-1.5" style={{ borderTop: "1px solid var(--panel-border, #2a2436)" }}>
                  <pre className="text-[10.5px] whitespace-pre-wrap break-all" style={{ ...monoStyle, color: "var(--fg-dim, #9aa)" }}>
                    args: {l.argsJson}
                  </pre>
                  {l.error && (
                    <pre className="mt-1 text-[10.5px] whitespace-pre-wrap break-words" style={{ ...monoStyle, color: "#f87171" }}>
                      {l.error}
                    </pre>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!exhausted && logs.length > 0 && (
        <button
          onClick={loadMore}
          disabled={loading}
          className="mt-3 inline-flex items-center gap-1.5 px-3 h-7 rounded-lg text-[11.5px] font-medium transition disabled:opacity-40"
          style={{ border: `1px solid ${WEBMCP_ACCENT}55`, color: WEBMCP_ACCENT }}
        >
          {loading ? <Loader2 size={11} className="animate-spin" /> : <ChevronDown size={11} />} Older
        </button>
      )}
    </div>
  );
}
