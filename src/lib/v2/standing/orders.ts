// S26 Standing orders (_design/jarvis-v3-plan.md; NEXORA "Schedule": "Nothing runs
// behind your back"). Every recurring job, from the three places recurring work lives:
//   task    v2 tasks with a schedule (RRULE)        actions via tasks/recurrence.applySchedule
//   agent   an agent's `schedule` (cron) trigger     actions via the agent definition
//   system  v2 scheduler jobs with an rrule that     hold / let run via the scheduler; never
//           are not task wake-ups (backups, ingest)  "taken off" (they are re-created at boot)
// Nothing is invented: a field no source records (a task's model when it has no agent) is
// null and shown as "not recorded". "Take it off" never deletes: a task keeps living with
// no schedule; an agent's trigger is removed only after its agent.json is kept as a version.

import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { Cron } from "croner";
import { rrulestr } from "rrule";
import { listTasks, getTask } from "@/lib/v2/tasks/store";
import { applySchedule, formatScheduleForUser, getTasksTimezone } from "@/lib/v2/tasks/recurrence";
import { enqueueTask, listJobs, runInline, setJobEnabled } from "@/lib/v2/scheduler";
import { listAgents, listRuns, loadAgent, readSystemPrompt, saveAgent, agentDir } from "@/lib/agentsStore";
import { modelFor, startRun } from "@/lib/agentsRuntime";
import { normalizeSchedule } from "@/lib/agentsTriggers";
import { versionsRoot } from "@/lib/v2/files/agentFiles";

export type OrderKind = "task" | "agent" | "system";
export type OrderAction = "run" | "hold" | "resume" | "takeoff";
export interface StandingOrder {
  id: string;
  kind: OrderKind;
  title: string;
  owner: string;
  deliveredBy: string;
  cadence: string;
  prompt: string | null;
  model: string | null;
  live: boolean;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastStatus: "ok" | "error" | null;
  lastResult: string | null;
  runs: number | null;
  runsBasis: string;
  actions: Record<OrderAction, boolean>;
  note?: string;
}

export class OrderError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) || null : null);
const firstLine = (s: string | null | undefined, n = 400) => (s ? s.trim().slice(0, n) : null);

export async function listStandingOrders(): Promise<StandingOrder[]> {
  const out: StandingOrder[] = [];
  const agents = await listAgents();
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const tz = getTasksTimezone();

  // Tasks with a schedule (live or held).
  for (const t of listTasks({})) {
    if (!t.schedule) continue;
    const agent = t.agentId ? agentById.get(t.agentId) : undefined;
    let cadence = t.schedule;
    try { cadence = (t.metadata.scheduleText as string) || formatScheduleForUser(t.schedule, tz); } catch { /* raw rule */ }
    out.push({
      id: `task:${t.id}`, kind: "task", title: t.title, owner: agent?.name ?? "Tasks", deliveredBy: agent ? agent.name : "the task runner",
      cadence, prompt: firstLine(t.descriptionMd) ?? t.title, model: agent ? modelFor(agent.intelligence) : null,
      live: t.isActive, nextRunAt: t.isActive ? ms(t.runAt) : null, lastRunAt: ms(t.lastRunAt),
      lastStatus: t.error ? "error" : t.lastRunAt ? "ok" : null, lastResult: firstLine(t.error ?? t.result, 300),
      runs: t.occurrenceCount, runsBasis: "occurrences so far", actions: { run: true, hold: t.isActive, resume: !t.isActive, takeoff: true },
    });
  }

  // Agents' schedule triggers.
  for (const a of agents) {
    const triggers = a.triggers ?? [];
    const idxs = triggers.map((t, i) => (t.type === "schedule" ? i : -1)).filter((i) => i >= 0);
    if (!idxs.length) continue;
    const runs = await listRuns(a.id, 100);
    const scheduled = runs.filter((r) => r.trigger === "schedule");
    const last = scheduled[0];
    let prompt: string | null = null;
    try { prompt = firstLine(await readSystemPrompt(a.id)); } catch { /* none */ }
    const deployed = !a.lifecycle || a.lifecycle === "deployed";
    for (const i of idxs) {
      const t = triggers[i] as { type: "schedule"; cron: string };
      const expr = normalizeSchedule(t.cron);
      let next: number | null = null;
      try { next = expr ? new Cron(expr).nextRun()?.getTime() ?? null : null; } catch { next = null; }
      const live = a.enabled && deployed && !!expr;
      out.push({
        id: `agent:${a.id}:${i}`, kind: "agent", title: `${a.name}: scheduled run`, owner: a.name, deliveredBy: a.name,
        cadence: expr ? `cron ${expr}${expr !== t.cron ? ` (from "${t.cron}")` : ""}` : `"${t.cron}" (not a schedule croner understands: inert)`,
        prompt, model: modelFor(a.intelligence), live, nextRunAt: live ? next : null,
        lastRunAt: last ? (last.endedAt ?? last.startedAt) : null,
        lastStatus: last ? (last.status === "done" ? "ok" : last.status === "error" ? "error" : null) : null,
        lastResult: last ? firstLine(last.error ?? last.result, 300) : null,
        runs: scheduled.length, runsBasis: "scheduled runs among its last 100 runs",
        actions: { run: a.enabled, hold: a.enabled, resume: !a.enabled, takeoff: true },
        note: "Hold and Let it run switch the whole agent off and on, all of its triggers.",
      });
    }
  }

  // System jobs (recurring, not task wake-ups).
  for (const j of listJobs()) {
    if (!j.rrule || j.kind === "task.wake") continue;
    let cadence = j.rrule;
    try { cadence = rrulestr(j.rrule).toText(); } catch { /* raw rule */ }
    out.push({
      id: `job:${j.id}`, kind: "system", title: j.name, owner: "Agent OS", deliveredBy: `scheduler (${j.kind})`,
      cadence, prompt: null, model: null, live: j.enabled === 1, nextRunAt: j.enabled === 1 ? ms(j.run_at) : null,
      lastRunAt: ms(j.last_run_at), lastStatus: j.last_status === "ok" ? "ok" : j.last_status ? "error" : null,
      lastResult: firstLine(j.last_error ?? j.last_status, 300), runs: null, runsBasis: "the scheduler keeps no run count",
      actions: { run: true, hold: j.enabled === 1, resume: j.enabled !== 1, takeoff: false },
      note: "A system job: hold it instead of taking it off; Agent OS re-creates it at boot.",
    });
  }
  return out.sort((x, y) => (x.nextRunAt ?? Infinity) - (y.nextRunAt ?? Infinity) || x.title.localeCompare(y.title));
}

export function orderCounts(orders: StandingOrder[]) {
  const live = orders.filter((o) => o.live);
  const next = live.filter((o) => o.nextRunAt).sort((a, b) => a.nextRunAt! - b.nextRunAt!)[0] ?? null;
  return { onTheBooks: orders.length, live: live.length, nextOne: next ? { title: next.title, at: next.nextRunAt } : null };
}

export async function actOnOrder(id: string, action: OrderAction, confirm = false): Promise<void> {
  const order = (await listStandingOrders()).find((o) => o.id === id);
  if (!order) throw new OrderError("no such standing order", 404);
  if (!order.actions[action]) throw new OrderError(`"${action}" is not available for this order${order.note ? `: ${order.note}` : ""}`, 409);
  if (action === "takeoff" && !confirm) throw new OrderError("taking an order off needs a confirm", 403);

  if (order.kind === "task") {
    const taskId = id.slice("task:".length);
    if (!getTask(taskId)) throw new OrderError("the task is gone", 404);
    if (action === "run") { enqueueTask(taskId, { reason: "standing-orders run now" }); return; }
    if (action === "hold") { applySchedule(taskId, { isActive: false }); return; }
    if (action === "resume") { applySchedule(taskId, { isActive: true }); return; }
    applySchedule(taskId, { schedule: null, runAt: null, isActive: false }); // the task stays; only its schedule goes
    return;
  }
  if (order.kind === "agent") {
    const [, agentId, idxRaw] = id.split(":");
    const def = await loadAgent(agentId);
    if (!def) throw new OrderError("the agent is gone", 404);
    if (action === "run") {
      const t = def.triggers[Number(idxRaw)] as { cron?: string } | undefined;
      const res = await startRun(def, "schedule", `Scheduled run (${t?.cron ?? "schedule"}), started by hand from Standing orders. Carry out your standing instructions.`);
      if ("error" in res) throw new OrderError(res.error, 409);
      return;
    }
    if (action === "hold" || action === "resume") { await saveAgent({ ...def, enabled: action === "resume", updatedAt: Date.now() }); return; }
    // takeoff: keep agent.json as a version first, then drop just this trigger.
    const src = path.join(agentDir(agentId), "agent.json");
    const vdir = path.join(versionsRoot(), `agent_${agentId}`, "agent.json");
    mkdirSync(vdir, { recursive: true });
    copyFileSync(src, path.join(vdir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`));
    const idx = Number(idxRaw);
    if (def.triggers[idx]?.type !== "schedule") throw new OrderError("that schedule is no longer on the agent", 409);
    await saveAgent({ ...def, triggers: def.triggers.filter((_, i) => i !== idx), updatedAt: Date.now() });
    return;
  }
  // system
  const jobId = id.slice("job:".length);
  const job = listJobs().find((j) => j.id === jobId);
  if (!job) throw new OrderError("the job is gone", 404);
  if (action === "run") {
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(job.payload || "{}"); } catch { /* empty */ }
    const ok = await runInline(job.kind, payload);
    if (!ok) throw new OrderError(`no handler is registered for ${job.kind} in this process`, 409);
    return;
  }
  setJobEnabled(jobId, action === "resume");
}
