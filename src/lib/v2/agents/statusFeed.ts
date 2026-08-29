// SPEC-E F2.1 — the SINGLE band-status derivation (CONVENTIONS §6). Every
// surface (agents hero SSE, /api/v2/tasks/agents-strip, the agent-status home
// widget) consumes getStatusSnapshot() — nobody re-derives.
//
// Derivation source: the run registry agentsRuntime keeps on
// globalThis.__agentsRuns (read structurally — no import of agentsRuntime, so
// no module cycle: agentsRuntime CALLS notifyStatus() from its transition
// sites) + run metas on disk + the v2 task assignments (the B4 overlay that
// agents-strip used to compute locally — folded in here so the derivation
// stays single).
//
// Mapping (SPEC-E §6, normative order):
//   enabled:false                         → offline ("disabled")
//   lifecycle ∈ {ideation,forge,test,retired} → offline (label = lifecycle word)
//   live run status waiting (parked)      → waiting
//   live run status running / Working task → running
//   Waiting/Review task assigned          → waiting
//   last run error (no newer success)     → error
//   else                                  → idle
//
// On every status CHANGE: one agent_status_events row (migration 051, TEXT ISO
// ts) + one "agent.status" emit on the Fd2 bus. Dedupe lives on globalThis.

import type { AgentDef, BandStatus, RunMeta } from "../../agentsTypes";
import { listAgents, listRuns } from "../../agentsStore";
import { getDb } from "../db";
import { emit, on } from "../events";
import { listTasks } from "../tasks/store";

export interface AgentStatusEntry {
  agentId: string;
  name: string;
  status: BandStatus;
  runId?: string;
  detail?: string;
  /** epoch ms when this status was first observed (stable across polls). */
  since: number;
}

export interface AgentStatusEvent {
  agentId: string;
  name: string;
  status: BandStatus;
  runId?: string;
  detail?: string;
  ts: number;
}

// Structural view of agentsRuntime's LiveRun registry — read-only here.
interface LiveRunView {
  meta: RunMeta;
}

declare global {
  // eslint-disable-next-line no-var
  var __agentosAgentStatus:
    | Map<string, { status: BandStatus; since: number; runId?: string; detail?: string }>
    | undefined;
}

function statusMap() {
  return (globalThis.__agentosAgentStatus ??= new Map());
}

function liveRuns(): Map<string, LiveRunView> {
  const g = globalThis as unknown as { __agentsRuns?: Map<string, LiveRunView> };
  return g.__agentsRuns ?? new Map();
}

const OFFLINE_LIFECYCLES = new Set(["ideation", "forge", "test", "retired"]);

async function deriveOne(def: AgentDef): Promise<Omit<AgentStatusEntry, "since">> {
  const base = { agentId: def.id, name: def.name };

  if (!def.enabled) return { ...base, status: "offline", detail: "disabled" };
  const lifecycle = def.lifecycle ?? "deployed";
  if (OFFLINE_LIFECYCLES.has(lifecycle)) return { ...base, status: "offline", detail: lifecycle };

  // Live registry first: an in-flight run is the strongest signal.
  let running: RunMeta | null = null;
  let waiting: RunMeta | null = null;
  for (const r of liveRuns().values()) {
    if (r.meta.agentId !== def.id) continue;
    if (r.meta.status === "waiting") waiting = r.meta;
    else if (r.meta.status === "running") running = r.meta;
  }
  if (waiting) return { ...base, status: "waiting", runId: waiting.id, detail: "approval pending" };
  if (running) return { ...base, status: "running", runId: running.id, detail: `run: ${running.trigger}` };

  // v2 task overlay (the B4 signals; guarded — tasks store needs the db).
  try {
    const assigned = listTasks({ agentId: def.id, limit: 100 });
    const working = assigned.find((t) => t.status === "Working");
    if (working) return { ...base, status: "running", detail: `task ${working.displayId}` };
    const needsYou = assigned.filter((t) => t.status === "Waiting" || t.status === "Review");
    if (needsYou.length > 0) {
      return { ...base, status: "waiting", detail: `${needsYou.length} task${needsYou.length > 1 ? "s" : ""} need you` };
    }
  } catch {
    /* tasks store unavailable — run-derived status stands */
  }

  // Last run on disk: error with no newer success → error.
  const lastRun = (await listRuns(def.id, 1).catch(() => []))[0] ?? null;
  if (lastRun?.status === "error") {
    return { ...base, status: "error", runId: lastRun.id, detail: (lastRun.error ?? "last run failed").slice(0, 200) };
  }

  return { ...base, status: "idle" };
}

/** Record a change: agent_status_events row + Fd2 "agent.status" emit. THIN
 *  and never-throwing — a status-feed failure must not break a run. */
function recordChange(ev: AgentStatusEvent): void {
  try {
    getDb()
      .prepare("INSERT INTO agent_status_events (ts, agent_id, status, run_id, detail) VALUES (?, ?, ?, ?, ?)")
      .run(new Date(ev.ts).toISOString(), ev.agentId, ev.status, ev.runId ?? null, ev.detail ?? null);
  } catch (err) {
    console.error("[agents/statusFeed] agent_status_events insert failed:", err);
  }
  try {
    emit("agent.status", { ...ev }, "agents");
  } catch (err) {
    console.error("[agents/statusFeed] bus emit failed:", err);
  }
}

/**
 * THE single derivation (CONVENTIONS §6). Computes every agent's band status,
 * records rows/bus events for any that CHANGED since last observation, and
 * returns the snapshot.
 */
export async function getStatusSnapshot(): Promise<AgentStatusEntry[]> {
  const defs = await listAgents();
  const map = statusMap();
  const now = Date.now();
  const seen = new Set<string>();
  const out: AgentStatusEntry[] = [];

  for (const def of defs) {
    seen.add(def.id);
    const derived = await deriveOne(def);
    const prev = map.get(def.id);
    if (!prev || prev.status !== derived.status) {
      map.set(def.id, { status: derived.status, since: now, runId: derived.runId, detail: derived.detail });
      // First observation of a fresh process is a change worth logging too —
      // the event log is how "came back offline after a restart" is visible.
      recordChange({ ...derived, ts: now });
    } else {
      // Same band — keep `since`, refresh the detail/runId (cheap, no row).
      prev.runId = derived.runId;
      prev.detail = derived.detail;
    }
    const cur = map.get(def.id)!;
    out.push({ ...derived, since: cur.since });
  }

  // Exiled/vanished agents drop out of the dedupe map.
  for (const id of [...map.keys()]) if (!seen.has(id)) map.delete(id);

  return out;
}

/**
 * Transition hook — agentsRuntime calls this (fire-and-forget) from its run
 * start/end/approval sites. Recomputing the full snapshot keeps the dedupe map
 * the single source; never throws.
 */
export async function notifyStatus(_agentId?: string): Promise<void> {
  try {
    await getStatusSnapshot();
  } catch (err) {
    console.error("[agents/statusFeed] notifyStatus failed:", err);
  }
}

/** Subscribe to status CHANGES (wraps the Fd2 bus). Returns unsubscribe. */
export function subscribeStatus(cb: (ev: AgentStatusEvent) => void): () => void {
  return on("agent.status", (event) => {
    const p = event.payload as unknown as AgentStatusEvent;
    if (p && typeof p.agentId === "string" && typeof p.status === "string") cb(p);
  });
}

/** Recent agent_status_events rows (detail tabs / debugging). */
export function listStatusEvents(opts: { agentId?: string; limit?: number } = {}): Array<{
  id: number;
  ts: string;
  agent_id: string;
  status: string;
  run_id: string | null;
  detail: string | null;
}> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  try {
    if (opts.agentId) {
      return getDb()
        .prepare("SELECT * FROM agent_status_events WHERE agent_id = ? ORDER BY id DESC LIMIT ?")
        .all(opts.agentId, limit) as ReturnType<typeof listStatusEvents>;
    }
    return getDb()
      .prepare("SELECT * FROM agent_status_events ORDER BY id DESC LIMIT ?")
      .all(limit) as ReturnType<typeof listStatusEvents>;
  } catch (err) {
    console.error("[agents/statusFeed] listStatusEvents failed:", err);
    return [];
  }
}
