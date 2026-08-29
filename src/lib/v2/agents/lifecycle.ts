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
 *
 * `opts.force` is the per-deploy override (2026-08-29): it lifts the test-run
 * requirement for THIS deploy only, without touching the setting. The default
 * stays strict — the escape hatch is a deliberate act each time, not a mode you
 * can leave switched on and forget.
 *
 * force does NOT lift the ≥1-trigger requirement, in either mode. That one is
 * not a policy: an agent with no trigger can never fire, so calling it
 * "deployed" would simply be false. A setting can be relaxed; arithmetic can't.
 */
export async function checkDeployGuard(
  agentId: string,
  def: AgentDef,
  opts?: { force?: boolean },
): Promise<{
  block?: { error: string; status: number; overridable?: boolean };
  warning?: string;
  /** True only when force actually lifted a gate that would have blocked. */
  overrode?: boolean;
}> {
  if (!def.triggers?.length) {
    // Deliberately NOT overridable — see above.
    return { block: { error: "deploy requires at least one trigger (manual counts)", status: 409 } };
  }
  if (await hasSuccessfulRun(agentId)) return {};
  const requireTestRun = readSettings().agents?.requireTestRun !== false;
  if (requireTestRun && !opts?.force) {
    return {
      block: {
        error: "deploy requires at least one successful (done) run — run the agent in Test first",
        status: 409,
        overridable: true,
      },
    };
  }
  // force is a no-op when the setting is already off; only report an override
  // when one actually happened.
  if (requireTestRun && opts?.force) {
    return {
      overrode: true,
      warning:
        "deployed WITHOUT a successful test run — you overrode the gate, so nothing has proven this agent works",
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
  opts?: { force?: boolean; reason?: string },
): Promise<{ agent: AgentDef; warning?: string } | { error: string; status: number; overridable?: boolean }> {
  if (!(AGENT_LIFECYCLES as readonly string[]).includes(to)) {
    return { error: `unknown lifecycle "${to}"`, status: 400 };
  }
  const def = await loadAgent(agentId);
  if (!def) return { error: "agent not found", status: 404 };

  let warning: string | undefined;
  let overrode = false;
  if (to === "deployed" && effectiveLifecycle(def) !== "deployed") {
    const gate = await checkDeployGuard(agentId, def, opts);
    if (gate.block) return gate.block;
    warning = gate.warning;
    overrode = !!gate.overrode;
  }

  const next: AgentDef = { ...def, lifecycle: to };
  // Stamped on the record, not just logged: an agent deployed without ever
  // passing a run should stay distinguishable from one that earned it.
  if (overrode) {
    next.deployOverride = { at: Date.now(), ...(opts?.reason ? { reason: opts.reason.slice(0, 300) } : {}) };
  }
  await saveAgent(next);
  return warning ? { agent: next, warning } : { agent: next };
}
