// SPEC-B B1 smoke: task model + store + recurrence over a temp DB + temp settings.
// Run: npx tsx scripts/v2/smoke-tasks.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const stamp = Date.now();
const tmpDb = path.join(os.tmpdir(), `agentos-smoke-tasks-${stamp}.db`);
const tmpSettings = path.join(os.tmpdir(), `agentos-smoke-tasks-settings-${stamp}.json`);
process.env.AGENTIC_OS_DB = tmpDb;
process.env.AGENTIC_OS_SETTINGS = tmpSettings;
// 1-second Ready buffer so the buffer-fire test runs fast; fixed tz for determinism.
fs.writeFileSync(
  tmpSettings,
  JSON.stringify({ tasks: { timezone: "America/Chicago", editingBufferSec: 1 } }),
  "utf8",
);

const { ensureDb, getDb, __closeForTests } = await import("../../src/lib/v2/db.ts");
const events = await import("../../src/lib/v2/events.ts");
const sched = await import("../../src/lib/v2/scheduler.ts");
const store = await import("../../src/lib/v2/tasks/store.ts");
const rec = await import("../../src/lib/v2/tasks/recurrence.ts");
const { canTransition } = await import("../../src/lib/v2/tasks/types.ts");

let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
};
const throws = (fn) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ensureDb();
rec.registerTaskWakeHandler();

// ---- migration 020 landed ----
const tables = getDb()
  .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','trigger')")
  .all()
  .map((r) => r.name);
for (const t of [
  "v2_tasks",
  "v2_task_events",
  "v2_task_sessions",
  "v2_conversations",
  "v2_messages",
  "v2_page_task_links",
  "v2_tasks_fts_ai",
]) {
  check(`migration 020 created ${t}`, tables.includes(t));
}

// ---- display-id allocation ----
const t1 = store.createTask({ title: "quantum flux capacitor", descriptionMd: "purple monkeys dance" });
const t2 = store.createTask({ title: "second root" });
check("first root task is tk-1", t1.displayId === "tk-1");
check("second root task is tk-2", t2.displayId === "tk-2");

const burst = [];
for (let i = 0; i < 12; i++) burst.push(store.createTask({ title: `burst ${i}` }));
const ids = new Set(burst.map((t) => t.displayId));
check("burst of 12 creates keeps display ids unique", ids.size === 12);
check(
  "burst ids are sequential tk-N",
  burst.every((t) => /^tk-\d+$/.test(t.displayId)),
);

// ---- subtasks: 2-level max ----
const sub = store.createTask({ title: "child of tk-1", parentId: t1.id });
check("subtask display id is tk-1.1", sub.displayId === "tk-1.1");
const sub2 = store.createTask({ title: "second child", parentId: t1.id });
check("second subtask is tk-1.2", sub2.displayId === "tk-1.2");
check("3rd level (child of tk-1.1) throws", throws(() => store.createTask({ title: "too deep", parentId: sub.id })));
check("parent child_count bumped", store.getTask(t1.id).childCount === 2);

// ---- resolveTaskId both forms ----
check("resolveTaskId uuid form", store.resolveTaskId(t1.id) === t1.id);
check("resolveTaskId display form", store.resolveTaskId("tk-1.1") === sub.id);
check("resolveTaskId miss -> null", store.resolveTaskId("tk-999") === null);

// ---- transition table (types.canTransition, REF verbatim) ----
check("agent Working->Done rejected", canTransition("Working", "Done", "agent") === false);
check("agent Working->Review allowed", canTransition("Working", "Review", "agent") === true);
check("agent ->Waiting allowed", canTransition("Working", "Waiting", "agent") === true);
check("agent Todo->Ready rejected", canTransition("Todo", "Ready", "agent") === false);
check("user ->Done allowed", canTransition("Working", "Done", "user") === true);
check("system ->Working allowed", canTransition("Ready", "Working", "system") === true);
check("same-status no-op allowed for agent", canTransition("Done", "Done", "agent") === true);

// ---- store-level status enforcement ----
store.changeTaskStatus(t2.id, "Working", "system");
check("illegal transition throws in store", throws(() => store.changeTaskStatus(t2.id, "Done", "agent")));
const t2AfterReview = store.changeTaskStatus(t2.id, "Review", "agent");
check("agent Working->Review lands", t2AfterReview.status === "Review");
const t2Done = store.changeTaskStatus(t2.id, "Done", "user");
check("user Review->Done lands + completed_at set", t2Done.status === "Done" && !!t2Done.completedAt);
const t2Reopened = store.reopenTask(t2.id);
check("reopen -> Todo clears completed_at", t2Reopened.status === "Todo" && t2Reopened.completedAt === null);

// ---- parent auto-Done (Review sibling blocks) ----
store.changeTaskStatus(sub2.id, "Working", "system");
store.changeTaskStatus(sub2.id, "Review", "agent");
store.completeTask(sub.id); // sibling sub2 is Review = still active
check("parent NOT auto-Done while sibling in Review", store.getTask(t1.id).status !== "Done");
store.completeTask(sub2.id);
check("parent auto-Done once all children Done", store.getTask(t1.id).status === "Done");

// ---- task_events per mutation ----
const t1Events = store.listTaskEvents(t1.id);
const kinds = t1Events.map((e) => e.kind);
check("task_events: created logged", kinds.includes("created"));
check("task_events: status_change logged", kinds.includes("status_change"));
store.updateTask(t2.id, { title: "second root renamed" });
check(
  "task_events: updated logged with fields",
  store.listTaskEvents(t2.id).some((e) => e.kind === "updated" && e.detail.fields?.includes("title")),
);

// ---- listTasks filters ----
const roots = store.listTasks({ parent: null });
check("listTasks parent:null = roots only", roots.every((t) => t.parentId === null) && roots.length >= 14);
const kids = store.listTasks({ parent: t1.id });
check("listTasks parent filter", kids.length === 2);
const dones = store.listTasks({ status: ["Done"] });
check("listTasks status filter", dones.some((t) => t.id === t1.id) && dones.every((t) => t.status === "Done"));

// ---- FTS ----
check("FTS finds by title word", store.listTasks({ q: "capacitor" }).some((t) => t.id === t1.id));
check("FTS finds by body word", store.listTasks({ q: "monkeys" }).some((t) => t.id === t1.id));
check("FTS miss returns empty", store.listTasks({ q: "zebrafish" }).length === 0);
store.updateTask(t1.id, { title: "renamed flux thing" });
check("FTS follows title update", store.listTasks({ q: "renamed" }).some((t) => t.id === t1.id));
check("FTS porter stemming (dancing→dance)", store.listTasks({ q: "dancing" }).some((t) => t.id === t1.id));

// ---- conversations policy ----
const convA = store.getOrCreateTaskConversation(t2.id);
const convB = store.getOrCreateTaskConversation(t2.id);
check("one-shot conversation is shared", convA.id === convB.id && convA.source === "task");
const run1 = store.createRunConversation(t2.id, 1);
const run2 = store.createRunConversation(t2.id, 2);
check("recurring runs get fresh conversations", run1.id !== run2.id && run2.runNo === 2);
store.appendMessage(convA.id, { role: "user", content: "hello" });
store.appendMessage(convA.id, { role: "assistant", content: "hi", userType: "system", ephemeral: true });
check("messages round-trip", store.listMessages(convA.id).length === 2);
check(
  "ephemeral filter works",
  store.listMessages(convA.id, { includeEphemeral: false }).length === 1,
);

// ---- sessions ----
const sess = store.addTaskSession(t2.id, { kind: "coding", agent: "claude", prompt: "do it" });
check("session starts 'starting' with null ref", sess.status === "starting" && sess.sessionRef === null);
const sessUpd = store.updateTaskSession(sess.id, { sessionRef: "abc-123", status: "running" });
check("session update lands", sessUpd.sessionRef === "abc-123" && sessUpd.status === "running");
check("listTaskSessions", store.listTaskSessions(t2.id).length === 1);

// ---- computeNextRun: tz + DST + relative semantics ----
// America/Chicago DST ends 2026-11-01 (CDT -05:00 -> CST -06:00).
const beforeDst = rec.computeNextRun(
  "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
  "America/Chicago",
  new Date("2026-10-30T20:00:00.000Z"),
);
check("9am Chicago before DST end = 14:00Z", beforeDst?.toISOString() === "2026-10-31T14:00:00.000Z");
const afterDst = rec.computeNextRun(
  "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
  "America/Chicago",
  new Date("2026-10-31T20:00:00.000Z"),
);
check("9am Chicago after DST end = 15:00Z", afterDst?.toISOString() === "2026-11-01T15:00:00.000Z");
const rel = rec.computeNextRun(
  "FREQ=MINUTELY;INTERVAL=5",
  "America/Chicago",
  new Date("2026-08-27T12:00:00.000Z"),
);
check("no-BYHOUR = relative interval (+5 min exactly)", rel?.toISOString() === "2026-08-27T12:05:00.000Z");
const weekly = rec.computeNextRun(
  "FREQ=WEEKLY;BYDAY=MO;BYHOUR=8;BYMINUTE=30",
  "America/Chicago",
  new Date("2026-08-27T12:00:00.000Z"), // a Thursday
);
check("weekly BYDAY=MO lands on Monday 8:30 Chicago", weekly?.toISOString() === "2026-08-31T13:30:00.000Z");
check("unparseable schedule -> null (loud warn above)", rec.computeNextRun("GARBAGE=YES", "America/Chicago") === null);
check(
  "formatScheduleForUser",
  rec.formatScheduleForUser("FREQ=DAILY;BYDAY=MO,WE,FR;BYHOUR=9;BYMINUTE=30") === "mon/wed/fri at 9:30 am",
);

// ---- recurring task schedules a job + wake handler reschedules ----
const recur = store.createTask({ title: "recurring smoke" });
rec.applySchedule(recur.id, { schedule: "FREQ=MINUTELY;INTERVAL=5" });
let recurTask = store.getTask(recur.id);
check("applySchedule sets run_at + scheduleText", !!recurTask.runAt && recurTask.metadata.scheduleText === "every 5 min");
let job = sched.listJobs().find((j) => j.id === `task:${recur.id}`);
check("recurring task has a jobs-table row", !!job && job.enabled === 1);

// Force due, then tick — handler must log 'woke', advance occurrence, reschedule.
const past = new Date(Date.now() - 1000).toISOString();
getDb().prepare("UPDATE jobs SET run_at = ? WHERE id = ?").run(past, `task:${recur.id}`);
getDb().prepare("UPDATE v2_tasks SET run_at = ? WHERE id = ?").run(past, recur.id);
await sched.tickOnce();
recurTask = store.getTask(recur.id);
job = sched.listJobs().find((j) => j.id === `task:${recur.id}`);
check("wake logged 'woke' event row", store.listTaskEvents(recur.id).some((e) => e.kind === "woke"));
check("occurrence_count incremented", recurTask.occurrenceCount === 1);
check("recurring rescheduled: run_at back in the future", recurTask.runAt > new Date().toISOString());
check(
  "job row survived the one-shot completion (self-reschedule respected)",
  !!job && job.enabled === 1 && job.run_at > new Date().toISOString(),
);
check("task.wake bus event emitted", events.recent({ type: "task.wake" }).length >= 1);
check(
  "rescheduled activity row appended",
  store.listTaskEvents(recur.id).some((e) => e.kind === "rescheduled"),
);

// ---- maxOccurrences deactivation ----
rec.applySchedule(recur.id, { maxOccurrences: 2 });
getDb().prepare("UPDATE jobs SET run_at = ? WHERE id = ?").run(past, `task:${recur.id}`);
await sched.tickOnce();
recurTask = store.getTask(recur.id);
check(
  "maxOccurrences reached -> deactivated (is_active 0, run_at null, job gone)",
  recurTask.occurrenceCount === 2 &&
    !recurTask.isActive &&
    recurTask.runAt === null &&
    !sched.listJobs().some((j) => j.id === `task:${recur.id}` && j.enabled === 1),
);

// ---- one-shot runAt fires once ----
const oneShot = store.createTask({ title: "one shot smoke" });
rec.applySchedule(oneShot.id, { runAt: past });
await sched.tickOnce();
const oneShotAfter = store.getTask(oneShot.id);
const wokeCount = () => store.listTaskEvents(oneShot.id).filter((e) => e.kind === "woke").length;
check("one-shot fired once + run_at cleared", wokeCount() === 1 && oneShotAfter.runAt === null);
await sched.tickOnce();
check("one-shot does NOT fire twice", wokeCount() === 1);

// ---- Ready editing buffer (1s in smoke settings) ----
const buffered = store.createTask({ title: "buffered ready task", status: "Ready" });
const bufTask = store.getTask(buffered.id);
check("Ready create arms buffer (run_at set + job exists)",
  !!bufTask.runAt && sched.listJobs().some((j) => j.id === `task:${buffered.id}`));
await sleep(1200);
await sched.tickOnce();
check(
  "buffer expiry wakes the task",
  store.listTaskEvents(buffered.id).some((e) => e.kind === "woke"),
);
// Park rule: Waiting clears a pending wake for non-scheduled tasks.
const parked = store.createTask({ title: "park me", status: "Ready" });
store.changeTaskStatus(parked.id, "Waiting", "agent");
check(
  "Waiting parks: run_at cleared + job removed",
  store.getTask(parked.id).runAt === null &&
    !sched.listJobs().some((j) => j.id === `task:${parked.id}`),
);

// ---- due-window filter ----
const dueSoon = store.createTask({ title: "due window probe" });
rec.applySchedule(dueSoon.id, { runAt: new Date(Date.now() + 60_000).toISOString() });
const windowHits = store.listTasks({
  dueAfter: new Date(Date.now() - 1000).toISOString(),
  dueBefore: new Date(Date.now() + 120_000).toISOString(),
});
check("listTasks due-window filter", windowHits.some((t) => t.id === dueSoon.id));

// ---- exile-delete ----
const victim = store.createTask({ title: "doomed epic" });
const victimChild = store.createTask({ title: "doomed child", parentId: victim.id });
const vConv = store.getOrCreateTaskConversation(victim.id);
store.appendMessage(vConv.id, { role: "user", content: "save me" });
const exile = store.deleteTask(victim.id);
check("exile bundle file exists", fs.existsSync(exile.exiledTo) && fs.statSync(exile.exiledTo).size > 0);
const bundle = JSON.parse(fs.readFileSync(exile.exiledTo, "utf8"));
check(
  "bundle carries task + subtask + conversation + messages",
  bundle.task.id === victim.id &&
    bundle.subtasks.length === 1 &&
    bundle.conversations.length === 1 &&
    bundle.messages.length === 1,
);
check("rows removed after exile (cascade)",
  store.getTask(victim.id) === null && store.getTask(victimChild.id) === null);
check(
  "conversation cascade-removed",
  getDb().prepare("SELECT COUNT(*) c FROM v2_conversations WHERE task_id = ?").get(victim.id).c === 0,
);
check("FTS rows removed on delete", store.listTasks({ q: "doomed" }).length === 0);
check("task.deleted bus event", events.recent({ type: "task.deleted" }).length >= 1);

// ---- bus events ----
check("task.created events on the bus", events.recent({ type: "task.created", limit: 50 }).length >= 5);
check("task.status events on the bus", events.recent({ type: "task.status", limit: 50 }).length >= 5);

__closeForTests();
try {
  fs.rmSync(tmpDb, { force: true });
  fs.rmSync(tmpDb + "-wal", { force: true });
  fs.rmSync(tmpDb + "-shm", { force: true });
  fs.rmSync(tmpSettings, { force: true });
} catch {}

console.log(failures === 0 ? "\nsmoke-tasks: ALL PASS" : `\nsmoke-tasks: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
