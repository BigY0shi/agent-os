"use client";

import { useCallback, useState } from "react";
import { Bot } from "lucide-react";
import StatusBand, { STATUS_BAND_COLORS, STATUS_BAND_LABELS, type StatusBandKind } from "@/components/v2/StatusBand";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import { EmptyState, Eyebrow } from "@/components/v2/memory/shared";
import { fmtUntil } from "./shared";

// ── AgentsSection (SPEC-B §6 row 3) ──────────────────────────────────────────
// Compact cards for active/recent agents. Data: /api/v2/tasks/agents-strip
// (thin butler-activity derivation; SPEC-E's statusFeed replaces the internals
// later). The color band is the SHARED src/components/v2/StatusBand.tsx.

interface AgentStripRow {
  id: string;
  name: string;
  band: StatusBandKind;
  enabled: boolean;
  lastRunStatus: string | null;
  lastRunAt: number | null;
  needsYouCount: number;
  currentTask: { displayId: string; title: string } | null;
  upcoming: { displayId: string; title: string; nextRunAt: string | null }[];
}

export default function AgentsSection({
  onOpenTask,
}: {
  /** Open the TaskDetail slide-over by display id. */
  onOpenTask: (displayId: string) => void;
}) {
  const [agents, setAgents] = useState<AgentStripRow[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/v2/tasks/agents-strip", { cache: "no-store" });
      const j = await r.json();
      if (Array.isArray(j?.agents)) setAgents(j.agents as AgentStripRow[]);
    } catch {
      /* offline */
    }
  }, []);
  usePollWhileVisible(refresh, 5000, []);

  if (agents !== null && agents.length === 0) {
    return (
      <EmptyState
        icon={<Bot size={20} />}
        title="No agents yet"
        hint="Create background agents on the Agents page — their live status and task queue show up here."
      />
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
      {(agents ?? []).map((a) => {
        const c = STATUS_BAND_COLORS[a.band];
        return (
          <div
            key={a.id}
            className="rounded-xl overflow-hidden flex flex-col"
            style={{ border: "1px solid var(--panel-border, #2a2436)", background: "var(--panel, rgba(255,255,255,0.02))" }}
          >
            <StatusBand status={a.band} />
            <div className="p-2.5 flex-1 flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <Bot size={13} className="shrink-0" style={{ color: c }} />
                <span className="text-[12.5px] font-medium truncate" style={{ color: "var(--fg, #e8e2f0)" }}>
                  {a.name}
                </span>
              </div>
              <div className="font-mono text-[9.5px] uppercase tracking-[0.1em]" style={{ color: c }}>
                {STATUS_BAND_LABELS[a.band]}
                {a.band === "waiting" && a.needsYouCount > 0 ? ` · ${a.needsYouCount}` : ""}
              </div>

              {a.currentTask ? (
                <button
                  onClick={() => onOpenTask(a.currentTask!.displayId)}
                  className="text-left text-[11px] truncate transition hover:underline"
                  style={{ color: "var(--fg-dim, #9aa)" }}
                  title={a.currentTask.title}
                >
                  <span className="font-mono text-[9.5px] mr-1" style={{ color: c }}>
                    {a.currentTask.displayId}
                  </span>
                  {a.currentTask.title || "Untitled task"}
                </button>
              ) : (
                <span className="text-[11px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                  no current task
                </span>
              )}

              {a.upcoming.length > 0 && (
                <div className="mt-auto pt-1.5" style={{ borderTop: "1px solid var(--panel-border, #2a2436)" }}>
                  <Eyebrow>upcoming</Eyebrow>
                  {a.upcoming.map((u) => (
                    <button
                      key={u.displayId}
                      onClick={() => onOpenTask(u.displayId)}
                      className="flex items-center gap-1.5 w-full text-left text-[10.5px] truncate transition hover:underline"
                      style={{ color: "var(--fg-dim, #9aa)" }}
                      title={u.title}
                    >
                      <span className="font-mono text-[9.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                        {u.displayId}
                      </span>
                      <span className="truncate flex-1">{u.title || "Untitled"}</span>
                      <span className="font-mono text-[9px] shrink-0" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                        {fmtUntil(u.nextRunAt)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
