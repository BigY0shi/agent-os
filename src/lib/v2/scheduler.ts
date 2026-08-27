import { rrulestr } from "rrule";
import { getDb } from "./db";
import { uuid, now } from "./ids";
import { emit } from "./events";
import { readSettings } from "../settings";

/**
 * F2 RRULE scheduler over the `jobs` table (CONVENTIONS §2 is the contract).
 * Handlers are registered by kind at boot — jobs carry NO closures, so they
 * survive DB rehydration. Missed-while-down jobs fire once on boot (run_at in
 * the past), repeats are never backfilled.
 */

export type JobHandler = (payload: Record<string, unknown>, job: JobRow) => Promise<void> | void;

export interface JobRow {
  id: string;
  kind: string;
  name: string;
  payload: string;
  rrule: string | null;
  run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  enabled: number;
  created_at: string;
}

interface SchedulerState {
  handlers: Map<string, JobHandler>;
  timer: ReturnType<typeof setInterval> | null;
  ticking: boolean;
  debounce: Map<string, ReturnType<typeof setTimeout>>;
}

declare global {
  // eslint-disable-next-line no-var
  var __agentosV2Scheduler: SchedulerState | undefined;
}

function state(): SchedulerState {
  if (!globalThis.__agentosV2Scheduler) {
    globalThis.__agentosV2Scheduler = { handlers: new Map(), timer: null, ticking: false, debounce: new Map() };
  }
  return globalThis.__agentosV2Scheduler;
}

export function registerJobHandler(kind: string, fn: JobHandler): void {
  state().handlers.set(kind, fn);
}

function nextFromRrule(rule: string, after: Date): string | null {
  const parsed = rrulestr(rule.startsWith("RRULE:") || rule.includes("\n") ? rule : `RRULE:${rule}`);
  const next = parsed.after(after, false);
  return next ? next.toISOString() : null;
}

export interface ScheduleJobInput {
  id?: string; // deterministic ids allowed (upsert); default uuid
  kind: string;
  name: string;
  rrule?: string;
  runAt?: string; // ISO; one-shot
  payload?: Record<string, unknown>;
  enabled?: boolean;
}

export function scheduleJob(input: ScheduleJobInput): JobRow {
  if (!input.rrule && !input.runAt) {
    throw new Error("scheduleJob: provide rrule or runAt");
  }
  const id = input.id ?? uuid();
  const runAt = input.runAt ?? (input.rrule ? nextFromRrule(input.rrule, new Date()) : null);
  const db = getDb();
  db.prepare(
    `INSERT INTO jobs(id, kind, name, payload, rrule, run_at, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       kind=excluded.kind, name=excluded.name, payload=excluded.payload,
       rrule=excluded.rrule, run_at=excluded.run_at, enabled=excluded.enabled`,
  ).run(
    id,
    input.kind,
    input.name,
    JSON.stringify(input.payload ?? {}),
    input.rrule ?? null,
    runAt,
    input.enabled === false ? 0 : 1,
    now(),
  );
  return db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow;
}

export function removeJob(id: string): void {
  getDb().prepare("DELETE FROM jobs WHERE id = ?").run(id);
}

export function setJobEnabled(id: string, enabled: boolean): void {
  getDb().prepare("UPDATE jobs SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
}

export function listJobs(): JobRow[] {
  return getDb().prepare("SELECT * FROM jobs ORDER BY created_at").all() as JobRow[];
}

/** Run one registered handler inline (debounce path + tests). Errors captured, never thrown. */
export async function runInline(kind: string, payload: Record<string, unknown> = {}): Promise<boolean> {
  const fn = state().handlers.get(kind);
  if (!fn) {
    emit("job.failed", { kind, error: `no handler registered for kind '${kind}'` }, "scheduler");
    return false;
  }
  try {
    await fn(payload, {
      id: `inline:${kind}`, kind, name: kind, payload: JSON.stringify(payload),
      rrule: null, run_at: null, last_run_at: null, last_status: null,
      last_error: null, enabled: 1, created_at: now(),
    });
    return true;
  } catch (err) {
    emit("job.failed", { kind, error: String(err) }, "scheduler");
    return false;
  }
}

/** One scheduler pass. Exported for tests (smoke-scheduler.mjs). */
export async function tickOnce(): Promise<number> {
  const s = state();
  if (s.ticking) return 0;
  s.ticking = true;
  let fired = 0;
  try {
    const db = getDb();
    const due = db
      .prepare("SELECT * FROM jobs WHERE enabled = 1 AND run_at IS NOT NULL AND run_at <= ?")
      .all(now()) as JobRow[];
    for (const job of due) {
      const handler = s.handlers.get(job.kind);
      let status = "ok";
      let error: string | null = null;
      if (!handler) {
        status = "skipped";
        error = `no handler registered for kind '${job.kind}'`;
      } else {
        try {
          await handler(safeParse(job.payload), job);
          emit("job.fired", { id: job.id, kind: job.kind, name: job.name }, "scheduler");
        } catch (err) {
          status = "error";
          error = String(err);
          emit("job.failed", { id: job.id, kind: job.kind, name: job.name, error }, "scheduler");
        }
      }
      // A handler may remove or reschedule ITS OWN job (task.wake recurrence
      // does remove-then-enqueue on the same deterministic id — SPEC-B stall
      // fix). Respect what the handler left behind instead of clobbering it.
      const afterRow = db
        .prepare("SELECT run_at, rrule FROM jobs WHERE id = ?")
        .get(job.id) as { run_at: string | null; rrule: string | null } | undefined;
      if (!afterRow) {
        fired++;
        continue; // handler removed the job — nothing to update
      }
      if (afterRow.run_at !== job.run_at || afterRow.rrule !== job.rrule) {
        // Self-rescheduled: keep its run_at/enabled, record bookkeeping only.
        db.prepare(
          "UPDATE jobs SET last_run_at = ?, last_status = ?, last_error = ? WHERE id = ?",
        ).run(now(), status, error, job.id);
        fired++;
        continue;
      }

      // Recompute next fire AFTER the run — repeats advance from now (no backfill).
      let nextRunAt: string | null = null;
      let enabled = job.enabled;
      if (job.rrule) {
        try {
          nextRunAt = nextFromRrule(job.rrule, new Date());
        } catch (err) {
          status = "error";
          error = `bad rrule: ${String(err)}`;
        }
        if (!nextRunAt) enabled = 0; // rule exhausted (UNTIL/COUNT)
      } else {
        enabled = 0; // one-shot completed
      }
      db.prepare(
        "UPDATE jobs SET run_at = ?, last_run_at = ?, last_status = ?, last_error = ?, enabled = ? WHERE id = ?",
      ).run(nextRunAt, now(), status, error, enabled, job.id);
      fired++;
    }
  } finally {
    s.ticking = false;
  }
  return fired;
}

/** Idempotent boot: starts the tick interval. Call from instrumentation register(). */
export function ensureV2Scheduler(): void {
  const s = state();
  if (s.timer) return;
  const tickSeconds = readSettings().scheduler?.tickSeconds ?? 30;
  s.timer = setInterval(() => {
    void tickOnce().catch((err) => console.error("[v2/scheduler] tick failed:", err));
  }, Math.max(5, tickSeconds) * 1000);
  if (typeof s.timer === "object" && "unref" in s.timer) s.timer.unref();
  // Missed-while-down jobs fire once shortly after boot.
  setTimeout(() => {
    void tickOnce().catch((err) => console.error("[v2/scheduler] boot tick failed:", err));
  }, 3000).unref?.();
}

// ---------------------------------------------------------------------------
// CONVENTIONS §2 compatibility surface
// ---------------------------------------------------------------------------

/** Cron (5-field) → RRULE conversion for SPEC-D/F consumers. Throws loudly on
 *  unsupported shapes — no silent misparse (memory: cron scheduler failure). */
export function cronToRrule(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`cronToRrule: expected 5 fields, got '${cron}'`);
  const [min, hour, dom, mon, dow] = parts;
  const DOW = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  if (mon !== "*") throw new Error(`cronToRrule: month field unsupported: '${cron}'`);

  const stepMatch = min.match(/^\*\/(\d+)$/);
  if (stepMatch && hour === "*" && dom === "*" && dow === "*") {
    return `FREQ=MINUTELY;INTERVAL=${stepMatch[1]}`;
  }
  const hourStep = hour.match(/^\*\/(\d+)$/);
  if (/^\d+$/.test(min) && hourStep && dom === "*" && dow === "*") {
    return `FREQ=HOURLY;INTERVAL=${hourStep[1]};BYMINUTE=${min}`;
  }
  if (/^\d+$/.test(min) && hour === "*" && dom === "*" && dow === "*") {
    return `FREQ=HOURLY;BYMINUTE=${min}`;
  }
  if (/^\d+$/.test(min) && /^\d+$/.test(hour)) {
    if (dom === "*" && dow === "*") return `FREQ=DAILY;BYHOUR=${hour};BYMINUTE=${min}`;
    if (dom === "*" && /^\d+$/.test(dow)) {
      const d = parseInt(dow, 10) % 7;
      return `FREQ=WEEKLY;BYDAY=${DOW[d]};BYHOUR=${hour};BYMINUTE=${min}`;
    }
    if (/^\d+$/.test(dom) && dow === "*") {
      return `FREQ=MONTHLY;BYMONTHDAY=${dom};BYHOUR=${hour};BYMINUTE=${min}`;
    }
  }
  throw new Error(`cronToRrule: unsupported cron shape: '${cron}'`);
}

/** SPEC-D/F: register a recurring job by cron string + handler kind. */
export function registerCron(id: string, cron: string, handlerKind: string, payload?: Record<string, unknown>): JobRow {
  return scheduleJob({ id, kind: handlerKind, name: id, rrule: cronToRrule(cron), payload });
}

// SPEC-B task-engine wrappers (kind 'task.wake', deterministic ids).
export function enqueueScheduledTask(taskId: string, opts: { runAt?: string; rrule?: string; payload?: Record<string, unknown> }): JobRow {
  return scheduleJob({
    id: `task:${taskId}`,
    kind: "task.wake",
    name: `task ${taskId}`,
    runAt: opts.runAt,
    rrule: opts.rrule,
    payload: { taskId, ...(opts.payload ?? {}) },
  });
}

export function removeScheduledTask(taskId: string): void {
  removeJob(`task:${taskId}`);
}

export function enqueueTask(taskId: string, payload?: Record<string, unknown>): JobRow {
  return scheduleJob({
    id: `task-now:${taskId}:${Date.now()}`,
    kind: "task.wake",
    name: `task ${taskId} (immediate)`,
    runAt: now(),
    payload: { taskId, ...(payload ?? {}) },
  });
}

export function cancelTaskJob(taskId: string): void {
  removeScheduledTask(taskId);
}

/** Debounced inline handler run (e.g. @jarvis mention processing). */
export function enqueueDebounced(key: string, delayMs: number, kind: string, payload: Record<string, unknown> = {}): void {
  const s = state();
  const existing = s.debounce.get(key);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    s.debounce.delete(key);
    void runInline(kind, payload);
  }, delayMs);
  t.unref?.();
  s.debounce.set(key, t);
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
