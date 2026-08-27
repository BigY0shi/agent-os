import { RRule } from "rrule";
import { getDb } from "../db";
import { now } from "../ids";
import { emit } from "../events";
import {
  enqueueScheduledTask,
  removeScheduledTask,
  registerJobHandler,
} from "../scheduler";
import { readSettings } from "../../settings";
import { getTask, appendTaskEvent } from "./store";
import { dispatchTaskWake, type WakeOutcome } from "./dispatch";
import type { Task } from "./types";

/**
 * SPEC-B B1 — RRULE recurrence in the USER-LOCAL timezone
 * (settings.tasks.timezone — the single tz source, CONVENTIONS §10).
 *
 * Port of REF apps/webapp/app/utils/schedule-utils.ts computeNextRun /
 * checkShouldDeactivate / getRecurrenceIntervalMinutes / formatScheduleForUser
 * with ONE delta: luxon is not a dependency here, so tz math is done with
 * Intl.DateTimeFormat wall-clock conversion (same BYHOUR day-iteration ≤400
 * days and same no-BYHOUR = relative-interval semantics — do NOT "fix" either).
 *
 * Upstream recurrence-stall fixes preserved (SPEC-B §8.7):
 *  - enqueueScheduledTask has NO idempotency key — every (re)schedule is
 *    remove-then-enqueue on the deterministic `task:<id>` job;
 *  - the queue is touched ONLY from applySchedule / scheduleTask / the wake
 *    handler — never from title/description edits (store.updateTask);
 *  - the wake handler advances the recurrence in a `finally` so the next
 *    occurrence is scheduled even when the fire body fails;
 *  - unparseable schedules WARN LOUDLY and deactivate instead of
 *    silent-skipping (repo lesson: 'natural-language schedules' fix ffea…).
 */

export const DEFAULT_TASKS_TIMEZONE = "America/Chicago";

export function getTasksTimezone(): string {
  const tz = readSettings().tasks?.timezone;
  return typeof tz === "string" && tz.trim() ? tz.trim() : DEFAULT_TASKS_TIMEZONE;
}

/** Trim + strip a leading 'RRULE:' prefix; empty → null. */
export function normalizeSchedule(schedule: string | null | undefined): string | null {
  if (!schedule) return null;
  const s = schedule.trim().replace(/^RRULE:/i, "").trim();
  return s || null;
}

// ---------------------------------------------------------------------------
// Intl-based wall-clock ↔ UTC conversion (luxon replacement)
// ---------------------------------------------------------------------------

interface WallParts {
  y: number;
  mo: number; // 1-12
  d: number;
  h: number;
  mi: number;
  s: number;
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function getDtf(tz: string): Intl.DateTimeFormat {
  let dtf = dtfCache.get(tz);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    dtfCache.set(tz, dtf);
  }
  return dtf;
}

/** The wall-clock reading of a UTC instant in `tz`. Throws on a bad zone. */
function utcToWall(date: Date, tz: string): WallParts {
  const parts: Record<string, string> = {};
  for (const p of getDtf(tz).formatToParts(date)) parts[p.type] = p.value;
  return {
    y: parseInt(parts.year, 10),
    mo: parseInt(parts.month, 10),
    d: parseInt(parts.day, 10),
    h: parseInt(parts.hour, 10) % 24, // some ICU builds render midnight as "24"
    mi: parseInt(parts.minute, 10),
    s: parseInt(parts.second, 10),
  };
}

/** The UTC instant whose wall clock in `tz` reads the given components.
 *  Iterative offset resolution; DST-nonexistent times land on the shifted
 *  instant (same practical behavior as luxon). */
function wallToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  tz: string,
): Date {
  const target = Date.UTC(y, mo - 1, d, h, mi, s);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const w = utcToWall(new Date(guess), tz);
    const wallMs = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
    const diff = target - wallMs;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

// ---------------------------------------------------------------------------
// computeNextRun (REF verbatim-adapt)
// ---------------------------------------------------------------------------

/**
 * Compute the next run for an RRULE string interpreted in the user's local
 * timezone; returns a UTC Date (or null when exhausted/unparseable — the
 * latter is warned loudly, never silent).
 */
export function computeNextRun(
  rruleString: string,
  timezone: string = getTasksTimezone(),
  after: Date = new Date(),
): Date | null {
  const normalized = normalizeSchedule(rruleString);
  if (!normalized) return null;

  let options: ReturnType<typeof RRule.parseString>;
  try {
    options = RRule.parseString(normalized);
  } catch (err) {
    console.warn(
      `[v2/tasks] UNPARSEABLE schedule '${rruleString}' — no wake-up will fire:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }

  try {
    const wall = utcToWall(after, timezone);

    // BYHOUR path: wall-clock day iteration (≤400 days, handles DST + yearly).
    if (options.byhour !== undefined && options.byhour !== null) {
      const hours: number[] = Array.isArray(options.byhour)
        ? options.byhour
        : [options.byhour];
      const minutes: number[] =
        options.byminute !== undefined && options.byminute !== null
          ? Array.isArray(options.byminute)
            ? options.byminute
            : [options.byminute]
          : [0];

      // Naive wall-clock space: dates treated as UTC for pattern matching only.
      const startNaive = Date.UTC(wall.y, wall.mo - 1, wall.d);
      for (let dayOffset = 0; dayOffset < 400; dayOffset++) {
        const dayNaive = new Date(startNaive + dayOffset * 86_400_000);
        const y = dayNaive.getUTCFullYear();
        const mo0 = dayNaive.getUTCMonth();
        const d = dayNaive.getUTCDate();

        // Does this calendar day match the pattern (weekday/monthday/…)?
        // Noon probe avoids DST edges (REF trick).
        const dayRule = new RRule({
          ...options,
          byhour: [12],
          byminute: [0],
          dtstart: new Date(startNaive),
        });
        const hits = dayRule.between(
          new Date(Date.UTC(y, mo0, d, 0, 0, 0)),
          new Date(Date.UTC(y, mo0, d, 23, 59, 59)),
          true,
        );
        if (hits.length === 0) continue;

        const candidates: Date[] = [];
        for (const hour of hours) {
          for (const minute of minutes) {
            const utc = wallToUtc(y, mo0 + 1, d, hour, minute, 0, timezone);
            if (utc.getTime() > after.getTime()) candidates.push(utc);
          }
        }
        if (candidates.length > 0) {
          candidates.sort((a, b) => a.getTime() - b.getTime());
          return candidates[0];
        }
      }
      return null;
    }

    // No BYHOUR = relative-interval task ("in 5 min", "in 1 day") — REF
    // semantics: add the interval to `after`, NOT the pattern boundary.
    const interval = options.interval || 1;
    if (options.freq === RRule.MINUTELY) {
      return new Date(after.getTime() + interval * 60_000);
    }
    if (options.freq === RRule.HOURLY) {
      return new Date(after.getTime() + interval * 3_600_000);
    }
    if (options.freq === RRule.DAILY || options.freq === RRule.WEEKLY) {
      const days = options.freq === RRule.DAILY ? interval : interval * 7;
      // Calendar-day addition in the user's tz (wall h:m:s preserved).
      const dayNaive = new Date(Date.UTC(wall.y, wall.mo - 1, wall.d + days));
      return wallToUtc(
        dayNaive.getUTCFullYear(),
        dayNaive.getUTCMonth() + 1,
        dayNaive.getUTCDate(),
        wall.h,
        wall.mi,
        wall.s,
        timezone,
      );
    }
    // Fallback for other frequencies (REF parity).
    const rule = new RRule({ ...options, dtstart: options.dtstart ?? after });
    return rule.after(after, false);
  } catch (err) {
    console.warn(
      `[v2/tasks] computeNextRun failed for '${rruleString}' (tz ${timezone}):`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/** Next occurrence for a task: schedule-driven, else its pending one-shot runAt. */
export function nextOccurrence(task: Task, after: Date = new Date()): Date | null {
  if (task.schedule) return computeNextRun(task.schedule, getTasksTimezone(), after);
  if (task.runAt && task.runAt > after.toISOString()) return new Date(task.runAt);
  return null;
}

// ---------------------------------------------------------------------------
// Deactivation + formatting helpers (REF verbatim-adapt)
// ---------------------------------------------------------------------------

export function checkShouldDeactivate(
  task: Pick<Task, "occurrenceCount" | "maxOccurrences" | "endDate">,
): boolean {
  if (
    task.maxOccurrences !== null &&
    task.maxOccurrences > 0 &&
    task.occurrenceCount >= task.maxOccurrences
  ) {
    return true;
  }
  if (task.endDate !== null && now() >= task.endDate) return true; // lexical ISO
  return false;
}

/** Effective recurrence interval in minutes (REF verbatim; floor logic is B2's). */
export function getRecurrenceIntervalMinutes(schedule: string): number | null {
  const freqMatch = schedule.match(/FREQ=(\w+)/);
  const intervalMatch = schedule.match(/INTERVAL=(\d+)/);
  const hourMatch = schedule.match(/BYHOUR=([\d,]+)/);

  const freq = freqMatch?.[1];
  const interval = intervalMatch ? parseInt(intervalMatch[1], 10) : 1;

  if (hourMatch) {
    const hours = hourMatch[1]
      .split(",")
      .map(Number)
      .sort((a, b) => a - b);
    if (hours.length >= 2) {
      let minGap = 24;
      for (let i = 1; i < hours.length; i++) {
        minGap = Math.min(minGap, hours[i] - hours[i - 1]);
      }
      minGap = Math.min(minGap, 24 - hours[hours.length - 1] + hours[0]);
      return minGap * 60;
    }
    return 24 * 60;
  }

  if (freq === "MINUTELY") return interval;
  if (freq === "HOURLY") return interval * 60;
  if (freq === "DAILY") return interval * 24 * 60;
  if (freq === "WEEKLY") return interval * 7 * 24 * 60;
  return null;
}

/** Human-readable schedule label (REF verbatim; time rendered without luxon —
 *  BYHOUR is already the wall hour, so no zone conversion is needed). */
export function formatScheduleForUser(schedule: string, _timezone?: string): string {
  const hourMatch = schedule.match(/BYHOUR=(\d+)/);
  const minuteMatch = schedule.match(/BYMINUTE=(\d+)/);
  const dayMatch = schedule.match(/BYDAY=([A-Z,]+)/);
  const freqMatch = schedule.match(/FREQ=(\w+)/);
  const intervalMatch = schedule.match(/INTERVAL=(\d+)/);

  const hour = hourMatch ? parseInt(hourMatch[1], 10) : null;
  const minute = minuteMatch ? parseInt(minuteMatch[1], 10) : 0;
  const days = dayMatch ? dayMatch[1] : null;
  const freq = freqMatch ? freqMatch[1] : "DAILY";
  const interval = intervalMatch ? parseInt(intervalMatch[1], 10) : 1;

  let timeStr = "";
  if (hour !== null) {
    const h12 = ((hour + 11) % 12) + 1;
    const ampm = hour < 12 ? "am" : "pm";
    timeStr = `${h12}:${String(minute).padStart(2, "0")} ${ampm}`;
  }

  let freqStr = "";
  const dayNames: Record<string, string> = {
    MO: "mon",
    TU: "tue",
    WE: "wed",
    TH: "thu",
    FR: "fri",
    SA: "sat",
    SU: "sun",
  };

  if (freq === "DAILY" && days) {
    freqStr = days
      .split(",")
      .map((d) => dayNames[d] || d)
      .join("/");
  } else if (freq === "DAILY") {
    freqStr = interval > 1 ? `every ${interval} days` : "daily";
  } else if (freq === "WEEKLY") {
    freqStr = interval > 1 ? `every ${interval} weeks` : "weekly";
    if (days) {
      freqStr += ` on ${days
        .split(",")
        .map((d) => dayNames[d] || d)
        .join("/")}`;
    }
  } else if (freq === "MINUTELY") {
    freqStr = `every ${interval} min`;
  } else if (freq === "HOURLY") {
    freqStr = interval > 1 ? `every ${interval} hours` : "hourly";
  }

  if (timeStr && freqStr) return `${freqStr} at ${timeStr}`;
  if (timeStr) return `at ${timeStr}`;
  if (freqStr) return freqStr;
  return schedule;
}

// ---------------------------------------------------------------------------
// Schedule application + wake-job management
// ---------------------------------------------------------------------------

function deactivateTask(taskId: string, reason: string): void {
  getDb()
    .prepare("UPDATE v2_tasks SET is_active = 0, run_at = NULL, updated_at = ? WHERE id = ?")
    .run(now(), taskId);
  removeScheduledTask(taskId);
  appendTaskEvent(taskId, "deactivated", "system", { reason });
}

export interface ApplyScheduleInput {
  schedule?: string | null; // RRULE in user-local tz; null clears
  runAt?: string | null; // explicit one-shot UTC ISO; null clears
  maxOccurrences?: number | null;
  endDate?: string | null;
  isActive?: boolean;
}

/**
 * The ONLY sanctioned path for changing a task's scheduling columns — updates
 * schedule/run_at/limits (+ metadata.scheduleText, regenerated or cleared like
 * REF updateScheduledTask) and then remove-then-enqueues the wake job.
 * store.updateTask deliberately cannot reach the queue (stall fix).
 */
export function applySchedule(taskId: string, input: ApplyScheduleInput): Task {
  const db = getDb();
  const task = getTask(taskId);
  if (!task) throw new Error(`task ${taskId} not found`);

  const tz = getTasksTimezone();
  const schedule =
    input.schedule !== undefined ? normalizeSchedule(input.schedule) : task.schedule;
  const isActive = input.isActive !== undefined ? input.isActive : task.isActive;

  // scheduleText regen/clear (REF updateScheduledTask, verbatim-adapt).
  const metadata = { ...task.metadata };
  if (input.schedule !== undefined) {
    if (schedule) metadata.scheduleText = formatScheduleForUser(schedule, tz);
    else delete metadata.scheduleText;
  }

  let runAt: string | null;
  if (input.runAt !== undefined) {
    runAt = input.runAt;
  } else if (input.schedule !== undefined) {
    const next = schedule ? computeNextRun(schedule, tz) : null;
    runAt = next ? next.toISOString() : null;
  } else {
    runAt = task.runAt;
  }

  db.prepare(
    `UPDATE v2_tasks SET schedule = ?, run_at = ?, max_occurrences = ?, end_date = ?,
       is_active = ?, metadata = ?, updated_at = ? WHERE id = ?`,
  ).run(
    schedule,
    runAt,
    input.maxOccurrences !== undefined ? input.maxOccurrences : task.maxOccurrences,
    input.endDate !== undefined ? input.endDate : task.endDate,
    isActive ? 1 : 0,
    JSON.stringify(metadata),
    now(),
    taskId,
  );

  if (schedule && !runAt && isActive) {
    console.warn(
      `[v2/tasks] schedule '${schedule}' for ${task.displayId} yields NO next occurrence — deactivating (not silently skipping)`,
    );
    deactivateTask(taskId, "schedule yields no next occurrence");
    return getTask(taskId)!;
  }

  // Remove-then-enqueue on the deterministic job id (NO idempotency key).
  removeScheduledTask(taskId);
  if (isActive && runAt) {
    const job = enqueueScheduledTask(taskId, { runAt, payload: { expectedRunAt: runAt } });
    db.prepare("UPDATE v2_tasks SET job_id = ? WHERE id = ?").run(job.id, taskId);
  } else {
    db.prepare("UPDATE v2_tasks SET job_id = NULL WHERE id = ?").run(taskId);
  }
  appendTaskEvent(taskId, "rescheduled", "user", { schedule, runAt });
  return getTask(taskId)!;
}

/**
 * (Re)arm the wake job from the task's STORED schedule/runAt — used by boot
 * recovery and by the wake handler after computing the next occurrence.
 * Returns the armed UTC ISO time, or null when nothing is due.
 */
export function scheduleTask(taskOrId: Task | string): string | null {
  const id = typeof taskOrId === "string" ? taskOrId : taskOrId.id;
  const task = getTask(id);
  if (!task) throw new Error(`task ${id} not found`);
  if (!task.isActive) {
    removeScheduledTask(id);
    return null;
  }

  let runAt: string | null = null;
  if (task.schedule) {
    const next = computeNextRun(task.schedule, getTasksTimezone());
    if (!next) {
      console.warn(
        `[v2/tasks] schedule '${task.schedule}' for ${task.displayId} yields no next occurrence — deactivating`,
      );
      deactivateTask(id, "schedule exhausted or unparseable");
      return null;
    }
    runAt = next.toISOString();
  } else if (task.runAt) {
    runAt = task.runAt;
  }
  if (!runAt) {
    removeScheduledTask(id);
    return null;
  }

  const db = getDb();
  removeScheduledTask(id);
  const job = enqueueScheduledTask(id, { runAt, payload: { expectedRunAt: runAt } });
  db.prepare("UPDATE v2_tasks SET run_at = ?, job_id = ?, updated_at = ? WHERE id = ?").run(
    runAt,
    job.id,
    now(),
    id,
  );
  return runAt;
}

// ---------------------------------------------------------------------------
// task.wake handler (B1 THIN version — B2's engine replaces the body)
// ---------------------------------------------------------------------------

/** Recurrence bookkeeping after a fire. Runs in `finally` — the next
 *  occurrence is scheduled even when the fire body failed (stall fix). */
function advanceAfterFire(taskId: string): void {
  const db = getDb();
  const task = getTask(taskId);
  if (!task) return;
  const ts = now();

  if (task.schedule && task.isActive) {
    db.prepare(
      "UPDATE v2_tasks SET occurrence_count = occurrence_count + 1, last_run_at = ?, updated_at = ? WHERE id = ?",
    ).run(ts, ts, taskId);
    const fresh = getTask(taskId)!;

    if (checkShouldDeactivate(fresh)) {
      deactivateTask(taskId, `max occurrences (${fresh.occurrenceCount}/${fresh.maxOccurrences}) or end date reached`);
      return;
    }
    const next = computeNextRun(fresh.schedule!, getTasksTimezone());
    if (!next) {
      console.warn(
        `[v2/tasks] recurring ${fresh.displayId} has no next occurrence — deactivating`,
      );
      deactivateTask(taskId, "schedule exhausted");
      return;
    }
    if (fresh.endDate && next.toISOString() > fresh.endDate) {
      deactivateTask(taskId, "next occurrence past endDate");
      return;
    }
    const runAt = next.toISOString();
    removeScheduledTask(taskId);
    const job = enqueueScheduledTask(taskId, { runAt, payload: { expectedRunAt: runAt } });
    db.prepare("UPDATE v2_tasks SET run_at = ?, job_id = ? WHERE id = ?").run(
      runAt,
      job.id,
      taskId,
    );
    appendTaskEvent(taskId, "rescheduled", "system", {
      runAt,
      occurrence: fresh.occurrenceCount,
    });
  } else {
    // One-shot wake (Ready editing buffer or explicit runAt): fires once.
    db.prepare(
      "UPDATE v2_tasks SET run_at = NULL, job_id = NULL, last_run_at = ?, updated_at = ? WHERE id = ?",
    ).run(ts, ts, taskId);
  }
}

/**
 * Register the 'task.wake' job handler — B2's staleness-guarded
 * claim → plan → execute pipeline (tasks/dispatch.ts), keeping B1's
 * `finally { advanceAfterFire }` shape. The dispatcher marks
 * `outcome.advance` BEFORE risky work on every claimed fire, so a failing
 * run body still schedules the next occurrence (upstream stall fix), while
 * stale no-op wakes leave the recurrence untouched (REF parity — whoever
 * moved the schedule enqueued the fresh wake).
 */
export function registerTaskWakeHandler(): void {
  registerJobHandler("task.wake", async (payload) => {
    const taskId = String(payload.taskId ?? "");
    const task = taskId ? getTask(taskId) : null;
    if (!task) {
      console.warn(`[v2/tasks] task.wake for unknown task '${taskId}' — ignoring`);
      return;
    }
    const outcome: WakeOutcome = { advance: false };
    try {
      appendTaskEvent(taskId, "woke", "system", {
        displayId: task.displayId,
        status: task.status,
        scheduled: !!task.schedule,
        immediate: payload.immediate === true,
      });
      emit(
        "task.wake",
        { taskId, displayId: task.displayId, status: task.status, schedule: task.schedule },
        "tasks",
      );
      await dispatchTaskWake(task, payload, outcome);
    } finally {
      if (outcome.advance) advanceAfterFire(taskId);
    }
  });
}
