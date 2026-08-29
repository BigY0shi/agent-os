import {
  listAgents, listRuns, saveRunMeta, appendRunEvent, readRunEvents,
  readApprovals, writeApprovals,
} from "./agentsStore";
import { emit } from "./v2/events";
import type { AttentionFlagPayload } from "./v2/eventTypes";

/**
 * Boot recovery for agent runs — the Agents-side twin of SPEC-B's
 * recoverStuckTasks().
 *
 * A run's liveness lives in the in-memory RUNS map: the pending-approval
 * promises, the streaming input queue, the SDK session. None of it survives a
 * restart, but the run's meta.json does — so a run killed mid-flight stays
 * `running` or `waiting` with endedAt:null forever, and the UI shows a spinner
 * for a process that no longer exists.
 *
 * The test is not a heuristic. This runs during boot, before any run can start,
 * so RUNS is necessarily empty: every meta still claiming running/waiting is
 * stranded by definition. No timeout window, no false positives.
 *
 * approvals.json gets the same treatment. Every card in it points at a promise
 * in the dead process's memory, so answering one could only ever hit the stale
 * path. Clearing the file at boot is what makes the UI's "that run is gone"
 * notice a rarity instead of the everyday case.
 */
export async function recoverStrandedRuns(): Promise<number> {
  let recovered = 0;
  try {
    for (const agent of await listAgents()) {
      for (const meta of await listRuns(agent.id, 200)) {
        if (meta.status !== "running" && meta.status !== "waiting") continue;
        try {
          const wasWaiting = meta.status === "waiting";
          const events = await readRunEvents(agent.id, meta.id).catch(() => []);
          const seq = events.reduce((m, e) => Math.max(m, e.seq), -1) + 1;

          meta.status = "error";
          meta.endedAt = Date.now();
          meta.error = wasWaiting
            ? "stranded by a server restart while waiting for your approval"
            : "stranded by a server restart while running";
          await saveRunMeta(meta);
          await appendRunEvent(agent.id, meta.id, {
            seq, ts: Date.now(), kind: "error", detail: meta.error,
          });

          const flag: AttentionFlagPayload = {
            kind: "agent.run.stranded",
            severity: "warn",
            title: `Run was cut short by a restart: ${agent.name}`,
            route: `/agents?agent=${agent.id}&run=${meta.id}`,
            dedupeKey: `agent-run-stranded-${meta.id}`,
            agentId: agent.id,
            runId: meta.id,
            wasWaiting,
          };
          emit("attention.flag", flag as unknown as Record<string, unknown>, "agents");
          recovered++;
        } catch (err) {
          console.warn(`[agents] boot recovery failed for run ${meta.id}:`, err);
        }
      }
    }

    const stale = (await readApprovals()).length;
    if (stale > 0) await writeApprovals([]);

    if (recovered > 0 || stale > 0) {
      console.warn(
        `[agents] boot recovery: ${recovered} stranded run(s) → error, ${stale} dead approval card(s) cleared`,
      );
    }
  } catch (err) {
    // Recovery is best-effort. A broken sweep must not take the server down.
    console.error("[agents] boot recovery failed:", err);
  }
  return recovered;
}
