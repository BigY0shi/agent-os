import { getDb } from "../db";
import { now } from "../ids";
import { upsertByDedupeKey, autoResolve, listItems } from "./store";
import { listActiveAccounts, latestSyncRun } from "../integrations/store";
import { listApprovals } from "../webmcp/approvals";
import { listAgents, listRuns, readApprovals } from "../../agentsStore";
import type { AgentDef, ApprovalReq, RunMeta } from "../../agentsTypes";

/**
 * SPEC-D H4.1 §3.5 — pull collectors, run on the 60s tick (attention/index.ts).
 * Honest-metrics house rule: a collector that cannot read its source reports
 * itself unavailable in the health payload — it never fabricates a clean zero.
 *
 * Collectors:
 *  - sync-failures: latest integration_sync_runs per active account; error →
 *    'sync_failed' item, next success → autoResolve.
 *  - pending-approvals: webmcp_approvals status=pending → item (same dedupeKey
 *    as the createApproval attention.flag emit: the approval id — the bridge
 *    row and the collector row are ONE row); resolved/expired → autoResolve.
 *  - agents (the spec's agents-dir file collector — implemented because it IS
 *    trivially safe: agentsStore reads are read-only JSON): pending entries in
 *    ~/.agentic-os/agents/approvals.json → items; error runs from the last 24h
 *    (runs/*.meta.json) → items, auto-resolved once they age out.
 */

export interface CollectorHealth {
  name: string;
  ok: boolean;
  lastRunAt: string | null;
  unavailableReason?: string;
}

interface AgentsSource {
  readApprovals(): Promise<ApprovalReq[]>;
  listAgents(): Promise<AgentDef[]>;
  listRuns(agentId: string, limit?: number): Promise<RunMeta[]>;
}

declare global {
  // eslint-disable-next-line no-var
  var __agentosAttentionHealth: Map<string, CollectorHealth> | undefined;
  // eslint-disable-next-line no-var
  var __agentosAttentionAgentsSource: AgentsSource | null | undefined;
}

function health(): Map<string, CollectorHealth> {
  if (!globalThis.__agentosAttentionHealth) globalThis.__agentosAttentionHealth = new Map();
  return globalThis.__agentosAttentionHealth;
}

/** Smoke seam: swap the agents-dir reader (the real one reads ~/.agentic-os). */
export function __setAgentsSourceForTests(src: AgentsSource | null): void {
  globalThis.__agentosAttentionAgentsSource = src;
}

function agentsSource(): AgentsSource {
  return globalThis.__agentosAttentionAgentsSource ?? { readApprovals, listAgents, listRuns };
}

export function getCollectorHealth(): CollectorHealth[] {
  return [...health().values()];
}

// ─── collectors ──────────────────────────────────────────────────────────────

function collectSyncFailures(): void {
  for (const account of listActiveAccounts()) {
    const latest = latestSyncRun(account.id);
    const dedupeKey = `sync-fail:${account.id}`;
    if (!latest || latest.ok === null) continue; // never ran / still running
    if (latest.ok === false) {
      upsertByDedupeKey({
        dedupeKey,
        kind: "sync_failed",
        severity: "warn",
        title: `Sync failing: ${account.definitionSlug}${account.displayName ? ` · ${account.displayName}` : ""}`,
        body: latest.error ?? null,
        route: "/integrations",
        payload: { accountId: account.id, slug: account.definitionSlug, at: latest.startedAt },
        source: "integrations",
      });
    } else {
      autoResolve(dedupeKey);
    }
  }
}

function collectPendingApprovals(): void {
  const pending = listApprovals({ status: "pending", limit: 200 });
  const pendingIds = new Set(pending.map((a) => a.id));
  for (const a of pending) {
    // Same dedupeKey the createApproval attention.flag emit uses → one row.
    upsertByDedupeKey({
      dedupeKey: a.id,
      kind: "webmcp.approval",
      severity: "warn",
      title: `Approval needed: ${a.slug === "registry" ? a.tool : `${a.slug}/${a.tool}`}`,
      route: "/webmcp",
      payload: { approvalId: a.id, requestedBy: a.requestedBy },
      source: "webmcp",
    });
  }
  // Open items of this kind whose approval is no longer pending → resolved.
  for (const item of listItems({ status: "open", kind: "webmcp.approval", limit: 500 })) {
    if (!pendingIds.has(item.dedupeKey)) autoResolve(item.dedupeKey);
  }
}

const AGENT_RUN_WINDOW_MS = 24 * 60 * 60 * 1000;

async function collectAgents(): Promise<void> {
  const src = agentsSource();

  // Pending agent tool approvals (global queue file, read-only).
  const approvals = await src.readApprovals();
  const pendingKeys = new Set(approvals.map((a) => `agent-approval:${a.id}`));
  for (const a of approvals) {
    upsertByDedupeKey({
      dedupeKey: `agent-approval:${a.id}`,
      kind: "agent_approval",
      severity: "warn",
      title: `Agent approval: ${a.agentName} · ${a.toolName}`,
      body: a.inputPreview?.slice(0, 500) ?? null,
      route: "/agents",
      payload: { agentId: a.agentId, runId: a.runId, reason: a.reason },
      source: "agents",
    });
  }
  for (const item of listItems({ status: "open", kind: "agent_approval", limit: 500 })) {
    if (!pendingKeys.has(item.dedupeKey)) autoResolve(item.dedupeKey);
  }

  // Error runs in the last 24h; aged-out ones auto-resolve.
  const cutoff = Date.now() - AGENT_RUN_WINDOW_MS;
  const freshKeys = new Set<string>();
  for (const agent of await src.listAgents()) {
    for (const run of await src.listRuns(agent.id, 30)) {
      if (run.status !== "error") continue;
      const at = run.endedAt ?? run.startedAt;
      if (at < cutoff) continue;
      const dedupeKey = `agent-run-fail:${agent.id}:${run.id}`;
      freshKeys.add(dedupeKey);
      upsertByDedupeKey({
        dedupeKey,
        kind: "agent_error",
        severity: "warn",
        title: `Agent run failed: ${agent.name}`,
        body: run.error?.slice(0, 500) ?? null,
        route: "/agents",
        payload: { agentId: agent.id, runId: run.id, at: new Date(at).toISOString() },
        source: "agents",
      });
    }
  }
  for (const item of listItems({ status: "open", kind: "agent_error", limit: 500 })) {
    if (!freshKeys.has(item.dedupeKey)) autoResolve(item.dedupeKey);
  }
}

// ─── tick ────────────────────────────────────────────────────────────────────

const COLLECTORS: Array<{ name: string; run: () => void | Promise<void> }> = [
  { name: "sync-failures", run: collectSyncFailures },
  { name: "pending-approvals", run: collectPendingApprovals },
  { name: "agents", run: collectAgents },
];

/** One collector pass. Per-collector health recorded; a broken collector never
 *  breaks the others (honest-metrics: it reports unavailable instead). */
export async function runCollectorsOnce(): Promise<CollectorHealth[]> {
  getDb(); // fail loudly up-front if the DB is unavailable
  for (const c of COLLECTORS) {
    try {
      await c.run();
      health().set(c.name, { name: c.name, ok: true, lastRunAt: now() });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[v2/attention] collector '${c.name}' unavailable: ${reason}`);
      health().set(c.name, { name: c.name, ok: false, lastRunAt: now(), unavailableReason: reason });
    }
  }
  return getCollectorHealth();
}
