import { getDb } from "../db";
import { now } from "../ids";
import { emit } from "../events";
import { readSettings } from "../../settings";
import {
  getTask,
  deleteTask,
  changeTaskStatus,
  appendTaskEvent,
} from "./store";
import { runTask } from "./engine";
import { removeTaskItemFromPages } from "../pages/store";
import type { Task } from "./types";
import type { AttentionFlagPayload } from "../eventTypes";

/**
 * SPEC-B B2.7 — wake-up dispatcher (REF jobs/task/scheduled-task.logic.ts,
 * verbatim-adapt control flow). One handler kind ('task.wake') serves BOTH the
 * scheduled wakes (deterministic `task:<id>` jobs) and the immediate runs
 * (`task-now:*` jobs carrying payload.immediate) — REF's two queues folded
 * onto F2's single jobs table.
 *
 * Branch table (scheduled wakes):
 *   staleness      — inactive, run_at NULL, run_at >1 s future, or an
 *                    expectedRunAt nonce mismatch → no-op (whoever moved the
 *                    schedule enqueued a fresh wake). NO recurrence advance.
 *   buffer expiry  — Ready + no schedule: editing buffer over. Empty
 *                    scratchpad task (source 'daily') → GC via exile-delete
 *                    (node strip from pages lands with B5); else clear run_at
 *                    and run.
 *   fire-override  — Todo|Waiting + schedule: the schedule beats the
 *                    lifecycle; execute with whatever info is available.
 *   normal fire    — Ready + schedule.
 *   stuck-Working  — previous occurrence crashed mid-run; recover by running.
 *   stuck-Review   — recurring only: previous occurrence parked in Review;
 *                    auto-loop.
 * Every claimed fire sets outcome.advance BEFORE the risky work so the
 * recurrence advances in the caller's `finally` even when the run body fails
 * (upstream stall fix).
 */

export interface WakeOutcome {
  /** True when recurrence.advanceAfterFire must run for this wake. */
  advance: boolean;
}

function isTaskEmpty(task: Task): boolean {
  const title = task.title.trim();
  const untitled = title === "" || title === "Untitled task";
  if (!untitled) return false;
  return !(task.descriptionMd?.trim() || task.specMd?.trim() || task.planMd?.trim());
}

export async function dispatchTaskWake(
  task: Task,
  payload: Record<string, unknown>,
  outcome: WakeOutcome,
): Promise<void> {
  const taskId = task.id;

  // ---- Immediate runs (approve / chat-unblock / manual run-now) -------------
  // Bypass the run_at staleness guard — these are not schedule fires. The
  // expectedUpdatedAt claim guard inside runTask covers their staleness.
  if (payload.immediate === true) {
    // Manual run-now on a task that also has a pending scheduled wake simply
    // runs now; the pending `task:<id>` job stays armed (fire-override
    // semantics: the user's intent overrides the wait, not the schedule).
    outcome.advance = !task.schedule; // one-shot bookkeeping only, never an occurrence bump
    await runTask(taskId, {
      immediate: true,
      expectedUpdatedAt:
        typeof payload.expectedUpdatedAt === "string" ? payload.expectedUpdatedAt : undefined,
    });
    return;
  }

  // ---- Staleness guard (REF: nextRunAt null or >1 s future → no-op) ---------
  if (!task.isActive) {
    appendTaskEvent(taskId, "wake_stale", "system", { reason: "task inactive" });
    return;
  }
  if (!task.runAt) {
    console.warn(`[v2/tasks] wake for ${task.displayId} with no run_at — stale, no-op`);
    appendTaskEvent(taskId, "wake_stale", "system", { reason: "no run_at" });
    return;
  }
  if (new Date(task.runAt).getTime() > Date.now() + 1000) {
    console.warn(
      `[v2/tasks] wake for ${task.displayId} but run_at is in the future (${task.runAt}) — stale, no-op`,
    );
    appendTaskEvent(taskId, "wake_stale", "system", { reason: "run_at in future", runAt: task.runAt });
    return;
  }
  // Belt-and-suspenders nonce: the enqueue site stamped the run_at it armed.
  if (
    typeof payload.expectedRunAt === "string" &&
    payload.expectedRunAt !== task.runAt
  ) {
    console.warn(
      `[v2/tasks] wake for ${task.displayId} carries stale nonce (armed for ${payload.expectedRunAt}, task now at ${task.runAt}) — no-op`,
    );
    appendTaskEvent(taskId, "wake_stale", "system", {
      reason: "expectedRunAt nonce mismatch",
      expectedRunAt: payload.expectedRunAt,
      runAt: task.runAt,
    });
    return;
  }

  // ---- Buffer expiry (Ready, no schedule) -----------------------------------
  if (task.status === "Ready" && !task.schedule) {
    const gcEnabled = readSettings().tasks?.emptyTaskGc !== false;
    if (task.source === "daily" && gcEnabled && isTaskEmpty(task)) {
      console.log(`[v2/tasks] auto-exiling empty scratchpad task ${task.displayId} at buffer expiry`);
      // B5: strip the bound taskItem node from any page BEFORE the row goes
      // (deleteTask cascades the link rows, so strip while they still exist).
      try {
        removeTaskItemFromPages(taskId);
      } catch (err) {
        console.warn(`[v2/tasks] node strip failed for ${task.displayId} (exile continues):`, err);
      }
      const res = deleteTask(taskId);
      emit("task.gc", { taskId, displayId: task.displayId, exiledTo: res.exiledTo }, "tasks");
      return; // task is gone — no advance
    }
    outcome.advance = true; // clears run_at/job + stamps last_run_at in finally
    getDb().prepare("UPDATE v2_tasks SET run_at = NULL, updated_at = ? WHERE id = ?").run(now(), taskId);
    appendTaskEvent(taskId, "buffer_expired", "system", {});
    await runTask(taskId, {});
    return;
  }

  // ---- Fire-override (Todo|Waiting + schedule) ------------------------------
  if ((task.status === "Todo" || task.status === "Waiting") && task.schedule) {
    outcome.advance = true;
    appendTaskEvent(taskId, "fire_override", "system", { from: task.status });
    await runTask(taskId, {});
    return;
  }

  // ---- Scheduled one-shot fire (explicit runAt, no RRULE) -------------------
  // A due run_at on a Todo/Waiting task without a schedule means the user
  // explicitly armed a one-shot (applySchedule {runAt}) — fire it. (Plain
  // backlog Todo tasks never have run_at, so they still no-op.)
  if ((task.status === "Todo" || task.status === "Waiting") && !task.schedule) {
    outcome.advance = true; // one-shot bookkeeping: clears run_at + stamps last_run_at
    appendTaskEvent(taskId, "oneshot_fire", "system", { from: task.status });
    await runTask(taskId, {});
    return;
  }

  // ---- Normal fire + stuck recovery -----------------------------------------
  const isNormalFire = task.status === "Ready" && !!task.schedule;
  const isStuckWorking = task.status === "Working";
  const isStuckReview = task.status === "Review" && !!task.schedule;

  if (isNormalFire || isStuckWorking || isStuckReview) {
    if (isStuckWorking) {
      console.warn(
        `[v2/tasks] wake fired while ${task.displayId} still Working — assuming previous occurrence crashed, recovering`,
      );
      appendTaskEvent(taskId, "stuck_recovery", "system", { from: "Working" });
    }
    if (isStuckReview) {
      console.warn(
        `[v2/tasks] wake fired while ${task.displayId} in Review — recurring task auto-recovering for next occurrence`,
      );
      appendTaskEvent(taskId, "stuck_recovery", "system", { from: "Review" });
    }
    outcome.advance = true;
    await runTask(taskId, {});
    return;
  }

  console.log(
    `[v2/tasks] wake for ${task.displayId} in unexpected state (status=${task.status}) — no-op`,
  );
  appendTaskEvent(taskId, "wake_stale", "system", { reason: `unexpected status ${task.status}` });
}

// ---------------------------------------------------------------------------
// Boot-time stuck recovery
// ---------------------------------------------------------------------------

/**
 * A task stuck Working past the run-timeout threshold at boot means the
 * previous process died mid-run (deploy, crash, machine sleep). Scheduled
 * tasks self-heal on their next wake (stuck-Working branch above); parked
 * one-shots never would — so park them Waiting + raise an attention flag.
 * Returns the number of tasks recovered.
 */
export function recoverStuckTasks(): number {
  const t = readSettings().tasks ?? {};
  const timeoutMin =
    typeof t.runTimeoutMin === "number" && t.runTimeoutMin > 0 ? t.runTimeoutMin : 30;
  const cutoff = new Date(Date.now() - (timeoutMin + 5) * 60_000).toISOString();

  const rows = getDb()
    .prepare(
      "SELECT id FROM v2_tasks WHERE status = 'Working' AND updated_at < ? AND is_active = 1",
    )
    .all(cutoff) as { id: string }[];

  let recovered = 0;
  for (const r of rows) {
    const task = getTask(r.id);
    if (!task) continue;
    try {
      changeTaskStatus(task.id, "Waiting", "system");
      appendTaskEvent(task.id, "stuck_recovery", "system", {
        from: "Working",
        at: "boot",
        stuckSince: task.updatedAt,
      });
      const flag: AttentionFlagPayload = {
        kind: "task.stuck",
        severity: "warn",
        title: `Task was stuck mid-run: ${task.title || task.displayId}`,
        route: `/tasks?focus=${task.displayId}`,
        dedupeKey: `task-stuck-${task.id}`,
        taskId: task.id,
        displayId: task.displayId,
      };
      emit("attention.flag", flag as unknown as Record<string, unknown>, "tasks");
      recovered++;
    } catch (err) {
      console.warn(`[v2/tasks] boot stuck-recovery failed for ${task.displayId}:`, err);
    }
  }
  if (recovered > 0) {
    console.warn(`[v2/tasks] boot recovery parked ${recovered} stuck Working task(s) to Waiting`);
  }
  return recovered;
}
