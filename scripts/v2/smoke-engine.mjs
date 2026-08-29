// SPEC-B B2 smoke: execution engine (plan approval + dispatcher) over a temp DB.
// Mock path (AGENTOS_MOCK_LLM=1) always runs; ONE live run happens when an
// Ollama provider is reachable. Run: npx tsx scripts/v2/smoke-engine.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// ---- env BEFORE imports (temp DB + temp settings + mock LLM) ----
const stamp = Date.now();
const tmpDb = path.join(os.tmpdir(), `agentos-smoke-engine-${stamp}.db`);
const tmpSettings = path.join(os.tmpdir(), `agentos-smoke-engine-settings-${stamp}.json`);
process.env.AGENTIC_OS_DB = tmpDb;
process.env.AGENTIC_OS_SETTINGS = tmpSettings;
process.env.AGENTOS_MOCK_LLM = "1";

const baseSettings = {
  tasks: {
    timezone: "America/Chicago",
    editingBufferSec: 1, // fast buffer fires
    planApproval: "always",
    maxStepsPerRun: 5, // small cap for the step-cap leg
    runTimeoutMin: 30,
    autoApprove: { categories: ["auto-cat"] },
  },
  memory: { ingestEnabled: false }, // rows land PENDING, worker stays quiet (offline)
};
const writeSettings = (obj) => fs.writeFileSync(tmpSettings, JSON.stringify(obj), "utf8");
writeSettings(baseSettings);

// Mirror Next's .env loading for OLLAMA_API_KEY (live-leg probe)
for (const envFile of [".env.local", ".env"]) {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), envFile), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {}
}

const { ensureDb, getDb } = await import("../../src/lib/v2/db.ts");
const sched = await import("../../src/lib/v2/scheduler.ts");
const store = await import("../../src/lib/v2/tasks/store.ts");
const rec = await import("../../src/lib/v2/tasks/recurrence.ts");
const engine = await import("../../src/lib/v2/tasks/engine.ts");
const dispatch = await import("../../src/lib/v2/tasks/dispatch.ts");

let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
};
const throwsSync = (fn) => {
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

const db = getDb();
const eventsOf = (taskId) => store.listTaskEvents(taskId, 200);
const kindsOf = (taskId) => eventsOf(taskId).map((e) => e.kind);
const busEvents = (type) =>
  db
    .prepare("SELECT payload FROM events WHERE type = ? ORDER BY id")
    .all(type)
    .map((r) => JSON.parse(r.payload));
const msgsOf = (taskId) => {
  const convs = store.listTaskConversations(taskId);
  return convs.flatMap((c) => store.listMessages(c.id));
};
const runNow = async (taskId, immediate = true) => {
  const t = store.getTask(taskId);
  sched.enqueueTask(taskId, immediate ? { immediate: true, expectedUpdatedAt: t.updatedAt } : {});
  await sched.tickOnce();
};

console.log("=== MOCK PATH (AGENTOS_MOCK_LLM=1) ===");

// ---------------------------------------------------------------------------
// 1. Main flow: create → enqueue → plan drafted → Waiting + flag → approve →
//    execute → Review → ingest queue row
// ---------------------------------------------------------------------------
const main = store.createTask({ title: "summarize the release notes", specMd: "mock main flow" });
await runNow(main.id);

let t = store.getTask(main.id);
check("main: plan drafted", t.planStatus === "drafted" && !!t.planMd);
check("main: status Waiting after draft", t.status === "Waiting");
check("main: plan_drafted event logged", kindsOf(main.id).includes("plan_drafted"));

const planFlags = busEvents("attention.flag").filter((p) => p.kind === "task.plan-approval");
const mainFlag = planFlags.find((p) => p.taskId === main.id);
check("main: attention.flag task.plan-approval emitted", !!mainFlag);
check("main: flag dedupeKey correct", mainFlag?.dedupeKey === `task-plan-${main.id}`);
check("main: flag route correct", mainFlag?.route === `/tasks?focus=${t.displayId}`);
check(
  "main: flag payload has severity/title (CONVENTIONS §5)",
  mainFlag?.severity === "warn" && typeof mainFlag?.title === "string",
);

engine.approvePlan(main.id, { note: "looks good" });
t = store.getTask(main.id);
check("main: approvePlan -> planStatus approved, status untouched", t.planStatus === "approved" && t.status === "Waiting");
await sched.tickOnce();

t = store.getTask(main.id);
check("main: status Review after execution", t.status === "Review");
check("main: result summary set", !!t.result && t.result.length > 10);
const mainKinds = kindsOf(main.id);
check("main: step_started events logged", mainKinds.filter((k) => k === "step_started").length >= 2);
check("main: step_ok events logged", mainKinds.filter((k) => k === "step_ok").length >= 2);
check("main: run_ok logged", mainKinds.includes("run_ok"));

const mainMsgs = msgsOf(main.id);
check("main: conversation has messages", mainMsgs.length >= 4);
check("main: ephemeral trigger persisted", mainMsgs.some((m) => m.ephemeral && m.content.includes(t.displayId)));
check("main: plan message present", mainMsgs.some((m) => m.content.startsWith("Plan drafted")));
check("main: step messages streamed", mainMsgs.some((m) => m.content.startsWith("Step 1/")));
check("main: summary message present", mainMsgs.some((m) => m.content.startsWith("Run complete")));
check("main: approval note appended as user turn", mainMsgs.some((m) => m.role === "user" && m.content === "looks good"));

const ingestRows = db
  .prepare("SELECT source, session_id FROM ingestion_queue WHERE source = 'task'")
  .all();
check("main: ingestion_queue row with source 'task'", ingestRows.length === 1);
check("main: ingest sessionId is task-<uuid>", ingestRows[0]?.session_id === `task-${main.id}`);

// ---------------------------------------------------------------------------
// 2. rejectPlan path
// ---------------------------------------------------------------------------
const rej = store.createTask({ title: "task to reject" });
await runNow(rej.id);
check("reject: drafted first", store.getTask(rej.id).planStatus === "drafted");
engine.rejectPlan(rej.id, "wrong approach");
t = store.getTask(rej.id);
check("reject: planStatus back to none + planMd cleared", t.planStatus === "none" && t.planMd === null);
check("reject: planSteps removed from metadata", t.metadata.planSteps === undefined);
check("reject: plan_rejected event", kindsOf(rej.id).includes("plan_rejected"));
check("reject: approvePlan now throws", throwsSync(() => engine.approvePlan(rej.id)));
check(
  "reject: rejection message appended",
  msgsOf(rej.id).some((m) => m.content.includes("wrong approach")),
);

// ---------------------------------------------------------------------------
// 3. Staleness guard: mutate the task's schedule state after arming the wake
// ---------------------------------------------------------------------------
const stale1 = store.createTask({ title: "stale future", status: "Ready" }); // 1s buffer armed
db.prepare("UPDATE v2_tasks SET run_at = ? WHERE id = ?").run(
  new Date(Date.now() + 3600_000).toISOString(),
  stale1.id,
);
await sleep(1200);
await sched.tickOnce();
t = store.getTask(stale1.id);
check("stale(future run_at): wake no-ops, task untouched", t.status === "Ready" && t.planStatus === "none");
check(
  "stale(future run_at): wake_stale logged with reason",
  eventsOf(stale1.id).some((e) => e.kind === "wake_stale" && e.detail.reason === "run_at in future"),
);

const stale2 = store.createTask({ title: "stale nonce", status: "Ready" });
// Simulate a duplicate/late fire: run_at moved to a DIFFERENT past instant.
db.prepare("UPDATE v2_tasks SET run_at = ? WHERE id = ?").run(
  new Date(Date.now() - 5000).toISOString(),
  stale2.id,
);
await sleep(1200);
await sched.tickOnce();
t = store.getTask(stale2.id);
check("stale(nonce mismatch): wake no-ops", t.planStatus === "none");
check(
  "stale(nonce mismatch): wake_stale logged",
  eventsOf(stale2.id).some((e) => e.kind === "wake_stale" && e.detail.reason === "expectedRunAt nonce mismatch"),
);

// ---------------------------------------------------------------------------
// 4. Fire-override: Todo + schedule fires -> executes + recurrence advances
// ---------------------------------------------------------------------------
const fo = store.createTask({ title: "fire override task" });
rec.applySchedule(fo.id, { schedule: "FREQ=MINUTELY;INTERVAL=5" });
t = store.getTask(fo.id);
check("fire-override setup: Todo + schedule + armed wake", t.status === "Todo" && !!t.schedule && !!t.runAt);
// Force the pending wake due NOW (task.run_at, job run_at, and nonce in sync).
const past = new Date(Date.now() - 2000).toISOString();
db.prepare("UPDATE v2_tasks SET run_at = ? WHERE id = ?").run(past, fo.id);
db.prepare("UPDATE jobs SET run_at = ?, payload = ? WHERE id = ?").run(
  past,
  JSON.stringify({ taskId: fo.id, expectedRunAt: past }),
  `task:${fo.id}`,
);
await sched.tickOnce();
t = store.getTask(fo.id);
check("fire-override: branch taken", kindsOf(fo.id).includes("fire_override"));
check("fire-override: plan drafted -> Waiting (planApproval=always)", t.status === "Waiting" && t.planStatus === "drafted");
check("fire-override: recurrence advanced (occurrence=1)", t.occurrenceCount === 1);
check("fire-override: next wake re-armed in the future", !!t.runAt && t.runAt > new Date().toISOString());
check(
  "fire-override: task:<id> job re-enqueued",
  !!db.prepare("SELECT id FROM jobs WHERE id = ?").get(`task:${fo.id}`),
);

// ---------------------------------------------------------------------------
// 5. Stuck recovery at boot: Working + old updated_at -> Waiting + flag
// ---------------------------------------------------------------------------
const stuck = store.createTask({ title: "stuck run" });
store.changeTaskStatus(stuck.id, "Working", "system");
db.prepare("UPDATE v2_tasks SET updated_at = ? WHERE id = ?").run(
  new Date(Date.now() - 2 * 3600_000).toISOString(),
  stuck.id,
);
const recovered = dispatch.recoverStuckTasks();
t = store.getTask(stuck.id);
check("stuck: recoverStuckTasks recovered 1", recovered === 1);
check("stuck: status flipped to Waiting", t.status === "Waiting");
const stuckFlag = busEvents("attention.flag").find((p) => p.kind === "task.stuck" && p.taskId === stuck.id);
check("stuck: attention.flag task.stuck emitted with dedupeKey", stuckFlag?.dedupeKey === `task-stuck-${stuck.id}`);
check("stuck: second recovery pass is a no-op", dispatch.recoverStuckTasks() === 0);

// ---------------------------------------------------------------------------
// 6. Step cap enforced (mock 20-step plan, maxStepsPerRun=5)
// ---------------------------------------------------------------------------
const many = store.createTask({ title: "big plan", specMd: "MOCK_MANY_STEPS" });
await runNow(many.id);
engine.approvePlan(many.id);
await sched.tickOnce();
t = store.getTask(many.id);
const manyStarted = kindsOf(many.id).filter((k) => k === "step_started").length;
check("step-cap: only maxStepsPerRun steps ran", manyStarted === 5);
check("step-cap: step_cap_enforced event logged", kindsOf(many.id).includes("step_cap_enforced"));
check("step-cap: task still reaches Review", t.status === "Review");

// ---------------------------------------------------------------------------
// 7. Blocker path: mock returns blocked -> Waiting + task.blocked flag + question
// ---------------------------------------------------------------------------
const blk = store.createTask({ title: "blocked task", specMd: "MOCK_BLOCKER" });
await runNow(blk.id);
engine.approvePlan(blk.id);
await sched.tickOnce();
t = store.getTask(blk.id);
check("blocker: status Waiting", t.status === "Waiting");
check("blocker: run_blocked event", kindsOf(blk.id).includes("run_blocked"));
const blkFlag = busEvents("attention.flag").find((p) => p.kind === "task.blocked" && p.taskId === blk.id);
check("blocker: attention.flag task.blocked emitted", !!blkFlag);
check("blocker: ONE tight question in the flag payload", typeof blkFlag?.question === "string" && blkFlag.question.includes("?"));
check(
  "blocker: question streamed to the conversation",
  msgsOf(blk.id).some((m) => m.content.startsWith("Blocked at step")),
);
// chat-reply auto-unblock (checkWaitingTaskReply port)
const blkConv = store.listTaskConversations(blk.id)[0];
const unblocked = engine.checkWaitingTaskReply(blkConv.id);
t = store.getTask(blk.id);
check("blocker: checkWaitingTaskReply flips Waiting -> Ready", unblocked === 1 && t.status === "Ready");

// ---------------------------------------------------------------------------
// 8. Exec step through the capability slot (non-strict gate)
// ---------------------------------------------------------------------------
const ex = store.createTask({ title: "exec task", specMd: "MOCK_EXEC" });
await runNow(ex.id);
engine.approvePlan(ex.id);
await sched.tickOnce();
t = store.getTask(ex.id);
check("exec: reaches Review", t.status === "Review");
check(
  "exec: slot output streamed to conversation",
  msgsOf(ex.id).some((m) => m.content.includes("mock-exec-ok")),
);

// ---------------------------------------------------------------------------
// 9. Auto-approve by category (settings.tasks.autoApprove.categories)
// ---------------------------------------------------------------------------
const auto = store.createTask({ title: "auto approved task", metadata: { category: "auto-cat" } });
await runNow(auto.id);
t = store.getTask(auto.id);
check("auto-approve: single wake goes straight to Review", t.status === "Review");
check("auto-approve: planStatus approved", t.planStatus === "approved");
check(
  "auto-approve: plan_approved event marked auto",
  eventsOf(auto.id).some((e) => e.kind === "plan_approved" && e.detail.auto === true),
);

// ---------------------------------------------------------------------------
// 10. Buffer GC: empty daily task exiled at buffer expiry
// ---------------------------------------------------------------------------
const gc = store.createTask({ title: "Untitled task", status: "Ready", source: "daily" });
await sleep(1200);
await sched.tickOnce();
check("buffer-GC: empty daily task removed", store.getTask(gc.id) === null);
const gcEvent = busEvents("task.gc").find((p) => p.taskId === gc.id);
check("buffer-GC: task.gc event names the exile bundle", typeof gcEvent?.exiledTo === "string" && gcEvent.exiledTo.length > 0);
check("buffer-GC: exile bundle exists on disk", gcEvent && fs.existsSync(gcEvent.exiledTo));

// A titled daily task survives the buffer and RUNS instead.
const keep = store.createTask({ title: "real daily task", status: "Ready", source: "daily" });
await sleep(1200);
await sched.tickOnce();
t = store.getTask(keep.id);
check("buffer-fire: titled daily task survives + drafts a plan", !!t && t.planStatus === "drafted" && t.status === "Waiting");
check("buffer-fire: buffer_expired event logged", kindsOf(keep.id).includes("buffer_expired"));

// ---------------------------------------------------------------------------
// LIVE leg (ONE run) — only when an Ollama provider is reachable
// ---------------------------------------------------------------------------
console.log("=== LIVE PATH (probe) ===");
let provider = null;
let modelLow = "";
let modelMedium = "";
if (process.env.OLLAMA_API_KEY) {
  provider = "ollama-cloud";
  modelLow = process.env.SMOKE_MODEL_LOW || "kimi-k2.6:cloud";
  modelMedium = process.env.SMOKE_MODEL_MEDIUM || "glm-5.2:cloud";
} else {
  try {
    const tags = await (
      await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(3000) })
    ).json();
    const names = (tags.models ?? []).map((m) => m.name);
    const preferred = names.find((n) => !/embed/i.test(n));
    if (preferred) {
      provider = "ollama-local";
      modelLow = modelMedium = preferred;
    }
  } catch {}
}

if (!provider) {
  console.log("SKIP  no Ollama provider reachable (no OLLAMA_API_KEY, no local model) — live run skipped.");
} else {
  console.log(`      provider=${provider} modelLow=${modelLow} modelMedium=${modelMedium}`);
  writeSettings({
    ...baseSettings,
    memory: { ingestEnabled: false, provider, modelLow, modelMedium },
  });
  delete process.env.AGENTOS_MOCK_LLM; // real modelCall path

  const live = store.createTask({
    title: "write a haiku about SQLite in the task notes",
    specMd: "Compose one haiku (5-7-5) about SQLite and present it as the task result.",
  });
  try {
    await runNow(live.id);
    t = store.getTask(live.id);
    check("live: plan drafted by real modelCall", t.planStatus === "drafted" && !!t.planMd);
    check("live: parked Waiting for approval", t.status === "Waiting");
    if (t.planStatus === "drafted") {
      engine.approvePlan(live.id);
      await sched.tickOnce();
      t = store.getTask(live.id);
      check("live: end-to-end reaches Review", t.status === "Review");
      check("live: real result summary present", !!t.result && t.result.length > 20);
      console.log("      live result tail:", (t.result ?? "").slice(0, 200).replace(/\n/g, " | "));
    }
  } catch (err) {
    check(`live: run threw (${String(err).slice(0, 200)})`, false);
  }
  process.env.AGENTOS_MOCK_LLM = "1";
}

// ---------------------------------------------------------------------------
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
