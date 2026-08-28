"use client";

// SPEC-E F2.3 — AgentsHero. Live agent viz fed by the /api/v2/agents/status
// SSE stream (snapshot frame on connect, event frames on change); when SSE
// drops it falls back to `?once=1` JSON polling at settings.agentsPage
// .heroPollMs (default 4000) and periodically re-attempts SSE.
//
// Honest telemetry (house style): the location chip derives ONLY from the
// statusFeed `detail` line ("run: <trigger>" / "task tk-N" / "approval
// pending" / lifecycle word) — no fabricated positions. Absent signal = "—".

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Hammer, Rocket, Wrench, List } from "lucide-react";
import { STATUS_BAND_COLORS, STATUS_BAND_LABELS } from "@/components/v2/StatusBand";
import type { BandStatus } from "@/lib/agentsTypes";
import { AGENTS_ACCENT, type StatusEntry } from "./shared";

const SSE_RETRY_MS = 30_000;

interface StatusFrame {
  type: "snapshot" | "event";
  agents?: StatusEntry[];
  agentId?: string;
  name?: string;
  status?: BandStatus;
  runId?: string;
  detail?: string;
  ts?: number;
}

export default function AgentsHero({
  heroPollMs,
  onEntries,
  onDeploy,
  onForgeAgent,
  onForgeHarness,
}: {
  heroPollMs: number;
  /** Lifts the latest snapshot to the page (cards grid consumes it too). */
  onEntries?: (entries: StatusEntry[]) => void;
  onDeploy: () => void;
  onForgeAgent: () => void;
  onForgeHarness: () => void;
}) {
  const [entries, setEntries] = useState<StatusEntry[]>([]);
  const [live, setLive] = useState(false); // SSE connected?
  const [loaded, setLoaded] = useState(false);
  const sseDownRef = useRef(false);

  useEffect(() => { onEntries?.(entries); }, [entries, onEntries]);

  // SSE with poll fallback.
  useEffect(() => {
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let retryTimer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;

    const applyFrame = (f: StatusFrame) => {
      if (f.type === "snapshot" && Array.isArray(f.agents)) {
        setEntries(f.agents);
        setLoaded(true);
      } else if (f.type === "event" && typeof f.agentId === "string" && typeof f.status === "string") {
        setEntries((prev) => {
          const next = prev.slice();
          const i = next.findIndex((e) => e.agentId === f.agentId);
          const entry: StatusEntry = {
            agentId: f.agentId!,
            name: f.name ?? next[i]?.name ?? f.agentId!,
            status: f.status as BandStatus,
            runId: f.runId,
            detail: f.detail,
            since: f.ts ?? Date.now(),
          };
          if (i >= 0) next[i] = entry;
          else next.push(entry);
          return next;
        });
      }
    };

    const poll = async () => {
      try {
        const j = await fetch("/api/v2/agents/status?once=1", { cache: "no-store" }).then((r) => r.json());
        if (!stopped && Array.isArray(j.agents)) {
          setEntries(j.agents);
          setLoaded(true);
        }
      } catch {
        /* server asleep — next tick */
      }
    };

    const startPolling = () => {
      if (pollTimer) return;
      void poll();
      pollTimer = setInterval(() => {
        if (document.visibilityState === "visible") void poll();
      }, Math.max(heroPollMs, 1000));
    };
    const stopPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    };

    const connect = () => {
      if (stopped) return;
      try {
        es = new EventSource("/api/v2/agents/status");
      } catch {
        sseDownRef.current = true;
        setLive(false);
        startPolling();
        return;
      }
      es.onopen = () => {
        sseDownRef.current = false;
        setLive(true);
        stopPolling();
      };
      es.onmessage = (ev) => {
        try {
          applyFrame(JSON.parse(ev.data) as StatusFrame);
        } catch {
          /* malformed frame — ignore */
        }
      };
      es.onerror = () => {
        es?.close();
        es = null;
        sseDownRef.current = true;
        setLive(false);
        startPolling();
      };
    };

    connect();
    retryTimer = setInterval(() => {
      if (sseDownRef.current && !es && document.visibilityState === "visible") connect();
    }, SSE_RETRY_MS);

    return () => {
      stopped = true;
      es?.close();
      stopPolling();
      if (retryTimer) clearInterval(retryTimer);
    };
  }, [heroPollMs]);

  const running = entries.filter((e) => e.status === "running").length;
  const waiting = entries.filter((e) => e.status === "waiting").length;

  return (
    <div className="rounded-2xl border p-5 mb-5 relative overflow-hidden" style={{ borderColor: `${AGENTS_ACCENT}33`, background: "rgba(167,139,250,0.04)" }}>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-widest mb-1 flex items-center gap-2" style={{ color: "var(--fg-dimmer)" }}>
            Fleet
            <span className="flex items-center gap-1" title={live ? "live SSE feed" : "polling fallback"}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: live ? STATUS_BAND_COLORS.running : STATUS_BAND_COLORS.offline }} />
              {live ? "live" : "poll"}
            </span>
          </div>
          <div className="text-[13px]" style={{ color: "var(--fg-dim)" }}>
            {entries.length} agent{entries.length === 1 ? "" : "s"}
            {running > 0 && <span style={{ color: STATUS_BAND_COLORS.running }}> · {running} running</span>}
            {waiting > 0 && <span style={{ color: STATUS_BAND_COLORS.waiting }}> · {waiting} waiting on you</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={onDeploy}
            className="px-3 h-9 rounded-lg border text-[12.5px] flex items-center gap-1.5 transition hover:brightness-125 text-emerald-300"
            style={{ borderColor: "rgba(52,211,153,0.5)", background: "rgba(52,211,153,0.08)" }}>
            <Rocket size={13} /> Deploy Agent
          </button>
          <button onClick={onForgeAgent}
            className="px-3 h-9 rounded-lg border text-[12.5px] flex items-center gap-1.5 transition hover:brightness-125"
            style={{ borderColor: `${AGENTS_ACCENT}66`, color: AGENTS_ACCENT, background: "rgba(167,139,250,0.10)" }}>
            <Hammer size={13} /> Forge Agent
          </button>
          <button onClick={onForgeHarness}
            className="px-3 h-9 rounded-lg border text-[12.5px] flex items-center gap-1.5 transition hover:brightness-125"
            style={{ borderColor: "var(--panel-border)", color: "var(--fg-dim)" }}>
            <Wrench size={13} /> Forge Harness
          </button>
          <button onClick={() => document.getElementById("agents-registry")?.scrollIntoView({ behavior: "smooth" })}
            className="px-3 h-9 rounded-lg border text-[12.5px] flex items-center gap-1.5 transition hover:brightness-125"
            style={{ borderColor: "var(--panel-border)", color: "var(--fg-dim)" }}>
            <List size={13} /> Registry &amp; Runs
          </button>
        </div>
      </div>

      {/* Live canvas: one node per agent. */}
      {loaded && entries.length === 0 && (
        <div className="text-[12.5px] py-4" style={{ color: "var(--fg-dimmer)" }}>
          No agents yet — Forge Agent starts the wizard.
        </div>
      )}
      <div className="flex gap-3 flex-wrap">
        <AnimatePresence>
          {entries.map((e) => {
            const color = STATUS_BAND_COLORS[e.status] ?? STATUS_BAND_COLORS.offline;
            return (
              <motion.div key={e.agentId} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                className="rounded-xl border px-3 py-2.5 min-w-[180px]"
                style={{ borderColor: `${color}44`, background: "rgba(0,0,0,0.25)" }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="relative flex w-2.5 h-2.5 shrink-0" title={STATUS_BAND_LABELS[e.status] ?? e.status}>
                    {(e.status === "running" || e.status === "waiting") && (
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ background: color }} />
                    )}
                    <span className="relative inline-flex rounded-full w-2.5 h-2.5" style={{ background: color }} />
                  </span>
                  <span className="text-[12.5px] font-medium truncate" style={{ color: "var(--fg)" }}>{e.name}</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10.5px] font-mono" style={{ color: "var(--fg-dimmer)" }}>
                  <span className="px-1.5 py-0.5 rounded border truncate max-w-[160px]" style={{ borderColor: `${color}33`, color: e.detail ? color : "var(--fg-dimmer)" }}>
                    {e.detail ?? "—"}
                  </span>
                </div>
                {e.status === "running" && (
                  <motion.div className="mt-1.5 h-[2px] rounded-full" style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }}
                    animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.6, repeat: Infinity }} />
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
