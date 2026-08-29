// SPEC-E F workstream — shared client-side bits for the Agents page.
// Client-safe: no node imports (agentsTypes rule).

import type { AgentDef, AgentLifecycle, BandStatus, RunMeta } from "@/lib/agentsTypes";

export const AGENTS_ACCENT = "#a78bfa";

/** The /api/agents GET card shape (existing route, unchanged). */
export type AgentCardData = AgentDef & { lastRun: RunMeta | null; active: boolean };

/** One entry of the /api/v2/agents/status snapshot (statusFeed contract). */
export interface StatusEntry {
  agentId: string;
  name: string;
  status: BandStatus;
  runId?: string;
  detail?: string;
  since: number;
}

/** Lifecycle chip colors — display-only accents, NOT the StatusBand palette
 *  (that lives in src/components/v2/StatusBand.tsx and is normative). */
export const LIFECYCLE_META: Record<AgentLifecycle, { label: string; color: string }> = {
  ideation: { label: "ideation", color: "#c084fc" },
  forge: { label: "forge", color: "#e879f9" },
  test: { label: "test", color: "#fb923c" },
  deployed: { label: "deployed", color: "#4ade80" },
  retired: { label: "retired", color: "#94a3b8" },
};

export function lifecycleOf(a: Pick<AgentDef, "lifecycle">): AgentLifecycle {
  const lc = a.lifecycle;
  return lc && lc in LIFECYCLE_META ? lc : "deployed";
}
