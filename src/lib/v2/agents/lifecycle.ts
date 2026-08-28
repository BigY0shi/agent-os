// SPEC-E F1.2 — lifecycle transitions. Layered ONTO the existing agents module
// (agentsStore stays authoritative; lifecycle is an optional AgentDef field).
// Absent lifecycle = "deployed", so every pre-existing agent keeps firing.
//
// Trigger eligibility: the agentsTriggers tick SKIPS agents whose lifecycle is
// in {ideation, forge, test, retired} — `enabled` stays orthogonal (a test
// agent is enabled:true but never trigger-fired; manual runs still work).

import type { AgentDef, AgentLifecycle } from "../../agentsTypes";
import { listRuns, loadAgent, saveAgent } from "../../agentsStore";
import { readSettings } from "../../settings";

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
 * Deploy gate (CONVENTIONS §11) — the ONE guard both transitionLifecycle and
 * the PATCH /api/agents/[id] route consult when promoting INTO "deployed".
 *
 * `settings.agents.requireTestRun` picks the mode:
 *   true  (default) → no successful run = HARD block (409)
 *   false           → no successful run = allowed, but a WARNING string is
 *                     returned for the UI to surface as an amber banner.
 * The ≥1-trigger requirement stays hard in both modes (trivially satisfiable —
 * manual counts). ASK-YOSHI: CONVENTIONS §11 suggests warning as the default.
 */
export async function checkDeployGuard(
  agentId: string,
  def: AgentDef,
): Promise<{ block?: { error: string; status: number }; warning?: string }> {
  if (!def.triggers?.length) {
    return { block: { error: "deploy requires at least one trigger (manual counts)", status: 409 } };
  }
  if (await hasSuccessfulRun(agentId)) return {};
  const requireTestRun = readSettings().agents?.requireTestRun !== false;
  if (requireTestRun) {
    return {
      block: {
        error: "deploy requires at least one successful (done) run — run the agent in Test first",
        status: 409,
      },
    };
  }
  return {
    warning:
      "deployed without a successful test run — agents.requireTestRun is off; consider firing a manual run to verify it works",
  };
}

/**
 * Guarded transition. → deployed runs the deploy gate above; other transitions
 * are unguarded. `retired` is a soft state — the agent stays on disk (exile is
 * a separate, existing path).
 */
export async function transitionLifecycle(
  agentId: string,
  to: AgentLifecycle,
): Promise<{ agent: AgentDef; warning?: string } | { error: string; status: number }> {
  if (!(AGENT_LIFECYCLES as readonly string[]).includes(to)) {
    return { error: `unknown lifecycle "${to}"`, status: 400 };
  }
  const def = await loadAgent(agentId);
  if (!def) return { error: "agent not found", status: 404 };

  let warning: string | undefined;
  if (to === "deployed" && effectiveLifecycle(def) !== "deployed") {
    const gate = await checkDeployGuard(agentId, def);
    if (gate.block) return gate.block;
    warning = gate.warning;
  }

  const next: AgentDef = { ...def, lifecycle: to };
  await saveAgent(next);
  return warning ? { agent: next, warning } : { agent: next };
}
