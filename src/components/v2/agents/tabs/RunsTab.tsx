"use client";

// F5.2 Runs tab — run list + live transcript (RunView reused from
// AgentsView, seq-cursor polling) + the browser-sessions sub-list
// (browser_sessions WHERE agent_id via /api/v2/agents/[id]/telemetry —
// listSessionRows({agentId})) + agent_status_events history.

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Globe } from "lucide-react";
import type { RunMeta } from "@/lib/agentsTypes";
import { STATUS_COLORS } from "@/lib/agentsTypes";
import { RunView, ago } from "@/components/AgentsView";
import { STATUS_BAND_COLORS } from "@/components/v2/StatusBand";
import type { BandStatus } from "@/lib/agentsTypes";
import { AGENTS_ACCENT } from "../shared";
import type { SessionRow, StatusEventRow } from "../AgentDetail";

export default function RunsTab({
  agentId,
  runs,
  sessions,
  statusEvents,
}: {
  agentId: string;
  runs: RunMeta[];
  sessions: SessionRow[];
  statusEvents: StatusEventRow[];
}) {
  const [openRun, setOpenRun] = useState<string | null>(
    runs[0] && (runs[0].status === "running" || runs[0].status === "waiting") ? runs[0].id : null,
  );

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[10px] font-mono uppercase tracking-widest mb-1.5" style={{ color: "var(--fg-dimmer)" }}>Runs</div>
        {runs.length === 0 && <div className="text-[12px]" style={{ color: "var(--fg-dimmer)" }}>No runs yet.</div>}
        <div className="space-y-1.5">
          {runs.map((r) => (
            <button key={r.id} onClick={() => setOpenRun(openRun === r.id ? null : r.id)}
              className="w-full text-left rounded-lg border px-3 py-2 text-[12px] flex items-center gap-2.5 transition hover:brightness-110"
              style={{ borderColor: openRun === r.id ? `${AGENTS_ACCENT}55` : "var(--panel-border)", background: "rgba(255,255,255,0.02)" }}>
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: STATUS_COLORS[r.status] }} />
              <span style={{ color: "var(--fg-dim)" }}>{r.trigger}</span>
              <span className="font-mono text-[10.5px]" style={{ color: STATUS_COLORS[r.status] }}>{r.status}</span>
              <span className="font-mono text-[10.5px] ml-auto" style={{ color: "var(--fg-dimmer)" }}>
                {ago(r.startedAt)}{typeof r.numTurns === "number" ? ` · ${r.numTurns} turns` : ""}
              </span>
              <ChevronRight size={12} style={{ color: "var(--fg-dimmer)", transform: openRun === r.id ? "rotate(90deg)" : "none" }} />
            </button>
          ))}
        </div>
        {openRun && <div className="mt-2"><RunView agentId={agentId} runId={openRun} /></div>}
      </div>

      {/* Browser sessions this agent drove (E3∩F3). */}
      <div>
        <div className="text-[10px] font-mono uppercase tracking-widest mb-1.5 flex items-center gap-1.5" style={{ color: "var(--fg-dimmer)" }}>
          <Globe size={11} style={{ color: "#38bdf8" }} /> Browser sessions
        </div>
        {sessions.length === 0 ? (
          <div className="text-[12px]" style={{ color: "var(--fg-dimmer)" }}>No browser sessions driven by this agent yet.</div>
        ) : (
          <div className="space-y-1.5">
            {sessions.map((s) => (
              <div key={s.id} className="rounded-lg border px-3 py-2 text-[12px] flex items-center gap-2.5" style={{ borderColor: "var(--panel-border)", background: "rgba(255,255,255,0.02)" }}>
                <span className="font-mono" style={{ color: "var(--fg)" }}>{s.session_name}</span>
                <span className="text-[10.5px] font-mono" style={{ color: "var(--fg-dimmer)" }}>profile {s.profile_name}</span>
                <span className="text-[10.5px] font-mono" style={{ color: s.closed_at ? "var(--fg-dimmer)" : STATUS_BAND_COLORS.running }}>
                  {s.closed_at ? "closed" : "open"}
                </span>
                <Link href="/browser" className="ml-auto text-[11px]" style={{ color: "#38bdf8" }}>open in /browser →</Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Status history (agent_status_events). */}
      <div>
        <div className="text-[10px] font-mono uppercase tracking-widest mb-1.5" style={{ color: "var(--fg-dimmer)" }}>Status history</div>
        {statusEvents.length === 0 ? (
          <div className="text-[12px]" style={{ color: "var(--fg-dimmer)" }}>No status events recorded yet.</div>
        ) : (
          <div className="space-y-1 font-mono text-[11px]">
            {statusEvents.map((ev) => (
              <div key={ev.id} className="flex items-center gap-2" style={{ color: "var(--fg-dimmer)" }}>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: STATUS_BAND_COLORS[ev.status as BandStatus] ?? STATUS_BAND_COLORS.offline }} />
                <span style={{ color: "var(--fg-dim)" }}>{ev.status}</span>
                {ev.detail && <span className="truncate">{ev.detail}</span>}
                <span className="ml-auto shrink-0">{new Date(ev.ts).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
