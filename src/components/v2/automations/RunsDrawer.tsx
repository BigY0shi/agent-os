"use client";

// ── RunsDrawer (SPEC-D G5.3 §6.3) — automation_runs table for one rule ───────
// Slide-over: status chip (ok green / condition_miss gray / action_failed red),
// created_at, error, per-condition/per-action detail JSON expander, triggering
// activity id when the trigger was activity.created.

import { useCallback, useState } from "react";
import { X, History } from "lucide-react";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import type { AutomationRule, AutomationRunRow } from "@/lib/v2/automations/types";
import { EmptyState, StatusChip, fmtDate, monoStyle, panelStyle } from "../integrations/shared";

const STATUS_COLOR: Record<string, string> = {
  ok: "#34d399",
  condition_miss: "#9ca3af",
  action_failed: "#f87171",
};

export default function RunsDrawer({ rule, onClose }: { rule: AutomationRule; onClose: () => void }) {
  const [runs, setRuns] = useState<AutomationRunRow[] | null>(null);
  const [openDetail, setOpenDetail] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/v2/automations/runs?ruleId=${encodeURIComponent(rule.id)}&limit=100`, { cache: "no-store" });
      const j = await res.json();
      if (Array.isArray(j?.runs)) setRuns(j.runs as AutomationRunRow[]);
    } catch {
      /* keep last */
    }
  }, [rule.id]);

  usePollWhileVisible(refresh, 10000, [rule.id]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="h-full w-full max-w-[520px] overflow-y-auto p-4 flex flex-col gap-3"
        style={{ ...panelStyle, background: "var(--panel-solid, #14101c)", borderLeft: "1px solid var(--panel-border, #2a2436)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <History size={15} style={{ color: "var(--fg-dim, #9aa)" }} />
          <div className="text-[13px] font-semibold truncate" style={{ color: "var(--fg, #e8e2f0)" }}>
            Runs · {rule.name}
          </div>
          <button onClick={onClose} className="ml-auto p-1 rounded-lg hover:bg-[rgba(255,255,255,0.05)]" style={{ color: "var(--fg-dim, #9aa)" }}>
            <X size={15} />
          </button>
        </div>

        {!runs ? (
          <EmptyState title="Loading runs…" />
        ) : runs.length === 0 ? (
          <EmptyState title="No runs yet" hint="Runs are recorded when the trigger matches: ok, condition_miss, or action_failed." />
        ) : (
          <div className="flex flex-col gap-2">
            {runs.map((run) => (
              <div key={run.id} className="rounded-lg p-2.5 flex flex-col gap-1.5" style={{ border: "1px solid var(--panel-border, #2a2436)" }}>
                <div className="flex items-center gap-2">
                  <StatusChip color={STATUS_COLOR[run.status] ?? "#9ca3af"}>{run.status}</StatusChip>
                  <span className="font-mono text-[10px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                    {fmtDate(run.createdAt)}
                  </span>
                  <button
                    onClick={() => setOpenDetail(openDetail === run.id ? null : run.id)}
                    className="ml-auto text-[10.5px] px-1.5 h-6 rounded-md"
                    style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}
                  >
                    {openDetail === run.id ? "hide detail" : "detail"}
                  </button>
                </div>
                {run.error && (
                  <div className="text-[11px] leading-relaxed" style={{ color: "#f87171" }}>{run.error}</div>
                )}
                {run.activityId && (
                  <div className="font-mono text-[9.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                    activity {run.activityId}
                  </div>
                )}
                {openDetail === run.id && (
                  <pre
                    className="text-[10px] rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-all"
                    style={{ ...monoStyle, background: "rgba(255,255,255,0.03)", color: "var(--fg-dim, #9aa)" }}
                  >
                    {JSON.stringify({ trigger: run.trigger, detail: run.detail }, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
