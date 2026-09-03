"use client";

// RunsTray — the corner tray that keeps a module run in view after its page is
// gone (roadmap S2). Mounted in src/app/layout.tsx on every route except
// /login. One entry per live run, stacked; finished runs linger so the owner
// sees the outcome, then dismiss themselves after `runsTray.autoDismissSec`
// (gear: rule 16, a small settings popover in the tray header). A running run
// carries a STOP button (roadmap S3): the ONE mid-run control. A stopped run
// reads "stopped", never "done".
//
// Data: /api/runs/stream (SSE, a snapshot then one frame per change) with a
// polling fallback on /api/runs while the tab is visible. The tray never
// invents a run: an empty tray renders nothing at all.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Check, AlertTriangle, X, Settings2, PowerOff, Square } from "lucide-react";
import { useSettings } from "@/components/ConfigMenu";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";

interface RunRow {
  id: string;
  module: string;
  label: string;
  href?: string;
  status: "running" | "done" | "error" | "lost" | "stopped";
  startedAt: number;
  endedAt?: number;
  error?: string;
  stoppedBy?: string;
  progress?: { n: number; total: number };
  events: { at: number; text: string }[];
  dismissedAt?: number;
}

const MODULE_NAME: Record<string, string> = {
  "content-engine": "Content Engine",
  "agent-kanban": "Agent Kanban",
  marketing: "Marketing Hub",
  deals: "Deal Desk",
  hire: "Hire Engine",
  agents: "Agents",
  loop: "Loop",
  pipeline: "Pipeline",
};

function elapsed(from: number, to?: number): string {
  const s = Math.max(0, Math.round(((to ?? Date.now()) - from) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function RunsTray() {
  const pathname = usePathname();
  const { settings, save } = useSettings();
  const cfg = ((settings as unknown as { runsTray?: { enabled?: boolean; autoDismissSec?: number } })?.runsTray) ?? {};
  const enabled = cfg.enabled ?? true;
  const autoDismissSec = cfg.autoDismissSec ?? 45;

  const [runs, setRuns] = useState<RunRow[]>([]);
  const [gearOpen, setGearOpen] = useState(false);
  const [, tick] = useState(0);
  const sseOk = useRef(false);
  const hidden = useRef<Set<string>>(new Set()); // dismissed locally before the server confirms

  const applyRun = useCallback((run: RunRow) => {
    setRuns((prev) => {
      const next = prev.filter((r) => r.id !== run.id);
      if (!run.dismissedAt) next.push(run);
      return next;
    });
  }, []);

  const pull = useCallback(async () => {
    try {
      const r = await fetch("/api/runs?limit=40", { cache: "no-store" });
      const j = (await r.json()) as { ok?: boolean; runs?: RunRow[] };
      if (j.ok && Array.isArray(j.runs)) setRuns(j.runs.filter((x) => !x.dismissedAt));
    } catch { /* server away; keep what we have */ }
  }, []);

  // SSE first; poll only while the stream is down and the tab is visible.
  useEffect(() => {
    if (pathname === "/login" || !enabled) return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const connect = () => {
      if (stopped) return;
      try { es = new EventSource("/api/runs/stream"); } catch { return; }
      es.onopen = () => { sseOk.current = true; };
      es.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data) as { type: string; runs?: RunRow[]; run?: RunRow };
          if (d.type === "snapshot" && Array.isArray(d.runs)) setRuns(d.runs.filter((x) => !x.dismissedAt));
          else if (d.type === "run" && d.run) applyRun(d.run);
        } catch { /* ignore a bad frame */ }
      };
      es.onerror = () => {
        sseOk.current = false;
        es?.close();
        es = null;
        retry = setTimeout(connect, 4000);
      };
    };
    connect();
    void pull();
    return () => {
      stopped = true;
      es?.close();
      if (retry) clearTimeout(retry);
    };
  }, [pathname, enabled, applyRun, pull]);

  usePollWhileVisible(() => { if (!sseOk.current && enabled && pathname !== "/login") void pull(); }, 5000, [enabled, pathname]);

  // Re-render elapsed counters once a second while anything is running.
  const anyRunning = runs.some((r) => r.status === "running");
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [anyRunning]);

  const dismiss = useCallback(async (id: string) => {
    hidden.current.add(id);
    setRuns((prev) => prev.filter((r) => r.id !== id));
    try { await fetch(`/api/runs/${encodeURIComponent(id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "dismiss" }) }); }
    catch { /* offline: it stays hidden locally until the next snapshot */ }
  }, []);

  // STOP: the server aborts the run's signal (the child CLI dies) and marks it
  // "stopped"; the SSE frame that follows repaints this row. Optimistic label
  // only, never an optimistic status: the truth comes back from the server.
  const [stopping, setStopping] = useState<Set<string>>(new Set());
  const stop = useCallback(async (id: string) => {
    setStopping((s) => new Set(s).add(id));
    try {
      const r = await fetch(`/api/runs/${encodeURIComponent(id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "stop" }) });
      const j = (await r.json()) as { ok?: boolean; run?: RunRow };
      if (j.run) applyRun(j.run);
    } catch { /* server away: the row keeps its live status until the next snapshot */ }
    finally { setStopping((s) => { const n = new Set(s); n.delete(id); return n; }); }
  }, [applyRun]);

  // Auto-dismiss finished runs after the configured grace, so a done run is
  // seen and then gets out of the way. 0 = keep until dismissed by hand.
  useEffect(() => {
    if (!autoDismissSec) return;
    const due = runs.filter((r) => r.status !== "running" && r.endedAt && Date.now() - r.endedAt > autoDismissSec * 1000);
    if (!due.length) return;
    for (const r of due) void dismiss(r.id);
  }, [runs, autoDismissSec, dismiss]);

  if (pathname === "/login" || !enabled) return null;
  const visible = runs.filter((r) => !hidden.current.has(r.id) && r.module !== "agents" ? true : !hidden.current.has(r.id));
  if (!visible.length) return null;

  const running = visible.filter((r) => r.status === "running").length;

  return (
    <div className="fixed left-4 bottom-4 z-40 flex flex-col gap-2 w-[340px] max-w-[calc(100vw-2rem)]" role="status" aria-live="polite">
      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--fg-dim, #9aa3b2)" }}>
          <Activity size={11} className="inline mr-1 -mt-0.5" />
          {running ? `${running} running` : "Recent runs"}
        </span>
        <button onClick={() => setGearOpen((v) => !v)} title="Runs tray settings" className="p-1 rounded hover:bg-white/10" style={{ color: "var(--fg-dim, #9aa3b2)" }}>
          <Settings2 size={12} />
        </button>
      </div>
      {gearOpen && (
        <div className="rounded-lg p-3 text-[12px] space-y-2" style={{ background: "var(--panel-bg, #14101c)", border: "1px solid var(--panel-border, #2a2436)" }}>
          <label className="flex items-center justify-between gap-2">
            <span>Auto-dismiss finished after</span>
            <select
              value={autoDismissSec}
              onChange={(e) => void save({ runsTray: { autoDismissSec: Number(e.target.value) } } as never)}
              className="bg-transparent border rounded px-1 py-0.5"
              style={{ borderColor: "var(--panel-border, #2a2436)" }}
            >
              <option value={0} style={{ background: "#14101c" }}>never</option>
              <option value={20} style={{ background: "#14101c" }}>20 s</option>
              <option value={45} style={{ background: "#14101c" }}>45 s</option>
              <option value={120} style={{ background: "#14101c" }}>2 min</option>
              <option value={600} style={{ background: "#14101c" }}>10 min</option>
            </select>
          </label>
          <button
            onClick={() => void save({ runsTray: { enabled: false } } as never)}
            className="inline-flex items-center gap-1.5 text-[11.5px]"
            style={{ color: "var(--fg-dim, #9aa3b2)" }}
            title="Hide the tray. Re-enable it from the Jarvis gear."
          >
            <PowerOff size={11} /> Hide the tray
          </button>
        </div>
      )}
      {visible.map((r) => {
        const done = r.status === "done";
        const stopped = r.status === "stopped";
        const bad = r.status === "error" || r.status === "lost";
        const accent = done ? "#34d399" : stopped ? "#fbbf24" : bad ? "#f87171" : "#22d3ee";
        const last = r.events.length ? r.events[r.events.length - 1].text : r.error ?? "";
        return (
          <div key={r.id} className="rounded-lg px-3 py-2.5" style={{ background: "var(--panel-bg, #14101c)", border: "1px solid var(--panel-border, #2a2436)", borderLeft: `3px solid ${accent}` }}>
            <div className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0" style={{ color: accent }}>
                {r.status === "running" ? <span className="inline-block w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: accent }} /> : done ? <Check size={13} /> : stopped ? <Square size={12} /> : <AlertTriangle size={13} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--fg-dim, #9aa3b2)" }}>
                  <span className="font-semibold uppercase tracking-wide">{MODULE_NAME[r.module] ?? r.module}</span>
                  <span>·</span>
                  <span>{r.status === "running" ? elapsed(r.startedAt) : r.status === "done" ? `done in ${elapsed(r.startedAt, r.endedAt)}` : stopped ? `stopped by ${r.stoppedBy ?? "owner"} after ${elapsed(r.startedAt, r.endedAt)}` : r.status}</span>
                  {r.progress && r.status === "running" && <span>· {r.progress.n}/{r.progress.total}</span>}
                </div>
                <div className="text-[13px] leading-snug truncate" title={r.label}>{r.label}</div>
                {last && <div className="text-[11.5px] truncate mt-0.5" style={{ color: bad ? "#f87171" : "var(--fg-dim, #9aa3b2)" }} title={last}>{last}</div>}
                {r.href && (
                  <Link href={r.href} className="text-[11.5px] underline-offset-2 hover:underline" style={{ color: "#22d3ee" }}>Open</Link>
                )}
              </div>
              {r.status === "running" && r.module !== "agents" && (
                <button
                  onClick={() => void stop(r.id)}
                  disabled={stopping.has(r.id)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10.5px] font-semibold uppercase tracking-wide shrink-0 disabled:opacity-50"
                  title="Stop this run. The only mid-run control."
                  style={{ background: "rgba(248,113,113,0.16)", color: "#f87171", border: "1px solid rgba(248,113,113,0.4)" }}
                >
                  <Square size={10} /> {stopping.has(r.id) ? "Stopping" : "Stop"}
                </button>
              )}
              {r.status !== "running" && (
                <button onClick={() => void dismiss(r.id)} className="p-1 rounded hover:bg-white/10 shrink-0" title="Dismiss" style={{ color: "var(--fg-dim, #9aa3b2)" }}>
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
