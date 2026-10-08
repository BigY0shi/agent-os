"use client";

// SPEC-E F5.1 — compact agent cards. Each card: StatusBand (top edge, shared
// palette — no local re-derivation: status comes from the statusFeed snapshot
// the page already holds), lifecycle chip, harness chip, trigger summary,
// last-run relative time. Click → /agents/[id].

import Link from "next/link";
import type { AgentTrigger, BandStatus } from "@/lib/agentsTypes";
import { MODE_META } from "@/lib/agentsTypes";
import StatusBand from "@/components/v2/StatusBand";
import AgentAvatar from "@/components/AgentAvatar";
import { ago } from "@/components/AgentsView";
import { LIFECYCLE_META, lifecycleOf, type AgentCardData } from "./shared";

function triggerSummary(triggers: AgentTrigger[]): string {
  if (!triggers?.length) return "no triggers";
  const parts = triggers.map((t) => {
    switch (t.type) {
      case "manual": return "manual";
      case "webhook": return "webhook";
      case "gmail": return `gmail ${t.intervalMin}m`;
      case "webwatch": return `watch ${t.intervalMin}m`;
      case "filewatch": return "files";
      case "schedule": return `cron ${t.cron}`;
    }
  });
  return parts.slice(0, 3).join(" · ") + (parts.length > 3 ? ` +${parts.length - 3}` : "");
}

export default function AgentCardsGrid({
  agents,
  statuses,
  harnessNames,
}: {
  agents: AgentCardData[];
  /** agentId → band status + detail, from the hero's status snapshot. */
  statuses: Record<string, { status: BandStatus; detail?: string }>;
  /** harness id → display name (from /api/v2/harnesses). */
  harnessNames: Record<string, string>;
}) {
  if (agents.length === 0) return null;
  return (
    <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
      {agents.map((a) => {
        const st = statuses[a.id];
        const status: BandStatus = st?.status ?? (a.enabled ? "idle" : "offline");
        const lc = lifecycleOf(a);
        const lcMeta = LIFECYCLE_META[lc];
        const harnessName = a.harnessId ? harnessNames[a.harnessId] ?? a.harnessId : null;
        return (
          <Link key={a.id} href={`/agents/${a.id}`}
            className="text-left rounded-2xl border overflow-hidden transition hover:brightness-110 block"
            style={{ borderColor: "var(--panel-border)", background: "rgba(255,255,255,0.02)", opacity: a.enabled ? 1 : 0.6 }}>
            <StatusBand status={status} />
            <div className="p-4">
              <div className="flex items-center justify-between mb-1.5 gap-2">
                <span className="flex items-center gap-2 min-w-0"><AgentAvatar agent={a.id} name={a.name} size={28} pulse={status === "running"} /><span className="text-[14px] font-medium truncate" style={{ color: "var(--fg)" }}>{a.name}</span></span>
                <span className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[9.5px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border"
                    style={{ borderColor: `${lcMeta.color}55`, color: lcMeta.color }}>
                    {lcMeta.label}
                  </span>
                  <span className="text-[9.5px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border"
                    style={{ borderColor: `${MODE_META[a.permissionMode].color}55`, color: MODE_META[a.permissionMode].color }}>
                    {MODE_META[a.permissionMode].label}
                  </span>
                </span>
              </div>
              {a.description && <div className="text-[12px] mb-2 line-clamp-2" style={{ color: "var(--fg-dim)" }}>{a.description}</div>}
              <div className="flex items-center gap-2 flex-wrap text-[10.5px] font-mono" style={{ color: "var(--fg-dimmer)" }}>
                {harnessName && (
                  <span className="px-1.5 py-0.5 rounded border" style={{ borderColor: "var(--panel-border)" }} title="harness">{harnessName}</span>
                )}
                <span className="truncate" title="triggers">{triggerSummary(a.triggers)}</span>
              </div>
              <div className="mt-2 text-[10.5px] font-mono flex items-center gap-2" style={{ color: "var(--fg-dimmer)" }}>
                {st?.detail ? (
                  <span className="truncate">{st.detail}</span>
                ) : a.lastRun ? (
                  <span>last run {a.lastRun.status} · {ago(a.lastRun.startedAt)}</span>
                ) : (
                  <span>never run</span>
                )}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
