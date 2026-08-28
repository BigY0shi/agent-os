// SPEC-E F1.2 — lifecycle transitions. Layered ONTO the existing agents module
// (agentsStore stays authoritative; lifecycle is an optional AgentDef field).
// Absent lifecycle = "deployed", so every pre-existing agent keeps firing.
//
// Trigger eligibility: the agentsTriggers tick SKIPS agents whose lifecycle is
// in {ideation, forge, test, retired} — `enabled` stays orthogonal (a test
// agent is enabled:true but never trigger-fired; manual runs still work).

import type { AgentDef, AgentLifecycle } from "../../agentsTypes";
import { listRuns, loadAgent, saveAgent } from "../../agentsStore";

export const AGENT_LIFECYCLES: readonly AgentLifecycle[] = [
  "ideation",
  "forge",
  "test",
  "deployed",
  "retired",
];

/** Lifecycles the trigger tick skips (F1.2). */
export const TRIGGER_SKIP_LIFECYCLES: ReadonlySet<AgentLifecycle> = new Set([
  "ideation",
  "forge",
  "test",
  "retired",
]);

export function effectiveLifecycle(def: Pick<AgentDef, "lifecycle">): AgentLifecycle {
  const lc = def.lifecycle;
  return lc && (AGENT_LIFECYCLES as readonly string[]).includes(lc) ? lc : "deployed";
}

/** The one-line filter the agentsTriggers tick uses. Pure — smoke-testable. */
export function lifecycleAllowsTriggers(def: Pick<AgentDef, "lifecycle">): boolean {
  return !TRIGGER_SKIP_LIFECYCLES.has(effectiveLifecycle(def));
}

/** Deploy guard: ≥1 run finished `done` (scan run metas). */
export async function hasSuccessfulRun(agentId: string): Promise<boolean> {
  const runs = await listRuns(agentId, 100).catch(() => []);
  return runs.some((r) => r.status === "done");
}

/**
 * Guarded transition. → deployed requires ≥1 successful (`done`) run AND at
 * least one trigger; other transitions are unguarded. `retired` is a soft
 * state — the agent stays on disk (exile is a separate, existing path).
 */
export async function transitionLifecycle(
  agentId: string,
  to: AgentLifecycle,
): Promise<{ agent: AgentDef } | { error: string; status: number }> {
  if (!(AGENT_LIFECYCLES as readonly string[]).includes(to)) {
    return { error: `unknown lifecycle "${to}"`, status: 400 };
  }
  const def = await loadAgent(agentId);
  if (!def) return { error: "agent not found", status: 404 };

  if (to === "deployed" && effectiveLifecycle(def) !== "deployed") {
    if (!(await hasSuccessfulRun(agentId))) {
      return {
        error: "deploy requires at least one successful (done) run — run the agent in Test first",
        status: 409,
      };
    }
    if (!def.triggers?.length) {
      return { error: "deploy requires at least one trigger (manual counts)", status: 409 };
    }
  }

  const next: AgentDef = { ...def, lifecycle: to };
  await saveAgent(next);
  return { agent: next };
}
