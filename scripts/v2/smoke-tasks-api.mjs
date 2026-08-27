// SPEC-B B3/B4 smoke: /api/v2/tasks/* route handlers (direct-import,
// NextRequest — smoke-memory-api pattern) + B3 seeds, over a temp DB with
// AGENTOS_MOCK_LLM=1 (deterministic engine, zero network).
// Run: npx tsx scripts/v2/smoke-tasks-api.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// ---- env BEFORE imports (temp DB + temp settings + mock LLM) ----
const stamp = Date.now();
const tmpDb = path.join(os.tmpdir(), `agentos-smoke-tasksapi-${stamp}.db`);
const tmpSettings = path.join(os.tmpdir(), `agentos-smoke-tasksapi-settings-${stamp}.json`);
process.env.AGENTIC_OS_DB = tmpDb;
process.env.AGENTIC_OS_SETTINGS = tmpSettings;
process.env.AGENTOS_MOCK_LLM = "1";

fs.writeFileSync(
  tmpSettings,
  JSON.stringify({
    tasks: {
      timezone: "America/Chicago",
      editingBufferSec: 1,
      planApproval: "always",
      autoApprove: { categories: ["auto-cat"] },
      maxStepsPerRun: 12,
      runTimeoutMin: 30,
      // morningBrief ENABLED so the seed-arms-a-job leg is deterministic;
      // the other three stay default-disabled.
      seeds: { morningBrief: { enabled: true } },
    },
    memory: { ingestEnabled: false },
  }),
  "utf8",
);

const { NextRequest } = await import("next/server");
const { getDb } = await import("../../src/lib/v2/db.ts");
const sched = await import("../../src/lib/v2/scheduler.ts");
const store = await import("../../src/lib/v2/tasks/store.ts");
const seeds = await import("../../src/lib/v2/tasks/seeds.ts");
const { ensureV2 } = await import("../../src/lib/v2/boot.ts");

const tasksRoute = await import("../../src/app/api/v2/tasks/route.ts");
const detailRoute = await import("../../src/app/api/v2/tasks/[id]/route.ts");
const approveRoute = await import("../../src/app/api/v2/tasks/[id]/approve/route.ts");
const runRoute = await import("../../src/app/api/v2/tasks/[id]/run/route.ts");
const chatRoute = await import("../../src/app/api/v2/tasks/[id]/chat/route.ts");
const agentsStripRoute = await import("../../src/app/api/v2/tasks/agents-strip/route.ts");
const recalcRoute = await import("../../src/app/api/v2/tasks/recalc/route.ts");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra).slice(0, 300)}` : ""}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 6000) {
  const until = Date.now() + ms;
  for (;;) {
    if (fn()) return true;
    if (Date.now() > until) return false;
    await sleep(100);
  }
}

const req = (url, init) => new NextRequest(new Request(`http://smoke.local${url}`, init));
const jsonInit = (method, body) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const ctx = (id) => ({ params: Promise.resolve({ id }) });

// Boot (also runs ensureTaskSeeds with the settings above).
ensureV2();
const db = getDb();

console.log("=== SEEDS (B3) ===");
const seedCount1 = seeds.ensureTaskSeeds();
const seedCount2 = seeds.ensureTaskSeeds();
const seedRows = store.listTasks({ source: "seed" });
check("seeds: 4 seed tasks present", seedRows.length === 4, seedRows.length);
check("seeds: double ensureTaskSeeds is idempotent (no duplicates)", seedCount1 === 4 && seedCount2 === 4 && seedRows.length === 4);
check("seeds: every spec_md non-empty", seedRows.every((t) => (t.specMd ?? "").length > 100));
check("seeds: every seed has metadata.seedKey + category", seedRows.every((t) => typeof t.metadata.seedKey === "string" && typeof t.metadata.category === "string"));
check("seeds: every seed has an RRULE schedule + scheduleText", seedRows.every((t) => !!t.schedule && typeof t.metadata.scheduleText === "string"));

const mb = seeds.findSeedTask("seed:morning-brief");
check("seeds: morning brief found by seedKey", !!mb);
check("seeds: morning brief schedule is daily 7am", mb?.schedule === "FREQ=DAILY;BYHOUR=7;BYMINUTE=0");
check("seeds: ENABLED seed (morningBrief) isActive", mb?.isActive === true);
check("seeds: enabled seed ARMS a wake job", !!db.prepare("SELECT id FROM jobs WHERE id = ?").get(`task:${mb.id}`));
for (const key of ["seed:eod-wrapup", "seed:sunday-planning", "seed:weekly-retro"]) {
  const t = seeds.findSeedTask(key);
  check(`seeds: DISABLED seed ${key} isActive=false`, t?.isActive === false);
  check(`seeds: disabled seed ${key} has NO armed job`, !db.prepare("SELECT id FROM jobs WHERE id = ?").get(`task:${t.id}`));
}

console.log("=== CREATE + LIST (B4 routes) ===");
let res = await tasksRoute.POST(req("/api/v2/tasks", jsonInit("POST", { title: "review the quarterly numbers", specMd: "smoke main flow xylophone" })));
let j = await res.json();
check("create: 201 + tk-N display id", res.status === 201 && /^tk-\d+$/.test(j.task?.displayId ?? ""), j);
const t1 = j.task;

res = await tasksRoute.POST(req("/api/v2/tasks", jsonInit("POST", { title: "recurring smoke", schedule: "FREQ=MINUTELY;INTERVAL=30" })));
j = await res.json();
check("create: schedule path arms runAt + job", res.status === 201 && !!j.task.schedule && !!j.task.runAt && !!db.prepare("SELECT id FROM jobs WHERE id = ?").get(`task:${j.task.id}`), j);
const tRec = j.task;

res = await tasksRoute.POST(req("/api/v2/tasks", jsonInit("POST", { title: "bad status", status: "Bogus" })));
check("create: invalid status → 400", res.status === 400);

res = await tasksRoute.GET(req("/api/v2/tasks"));
j = await res.json();
check("list: returns all tasks", Array.isArray(j.tasks) && j.tasks.length >= 6, j.tasks?.length);

res = await tasksRoute.GET(req("/api/v2/tasks?q=xylophone"));
j = await res.json();
check("list: FTS q filter finds by spec word", j.tasks?.length === 1 && j.tasks[0].id === t1.id, j.tasks?.length);

res = await tasksRoute.GET(req("/api/v2/tasks?source=seed"));
j = await res.json();
check("list: source=seed filter → 4", j.tasks?.length === 4, j.tasks?.length);

res = await tasksRoute.GET(req(`/api/v2/tasks?status=Todo&q=${encodeURIComponent("quarterly")}`));
j = await res.json();
check("list: status CSV filter composes with q", j.tasks?.length === 1, j.tasks?.length);

console.log("=== DETAIL + PATCH ===");
res = await detailRoute.GET(req(`/api/v2/tasks/${t1.displayId}`), ctx(t1.displayId));
j = await res.json();
check("detail: GET by DISPLAY id resolves", res.status === 200 && j.task?.id === t1.id);
check("detail: events + sessions + subtasks + conversations arrays", Array.isArray(j.events) && Array.isArray(j.sessions) && Array.isArray(j.subtasks) && Array.isArray(j.conversations));

res = await detailRoute.GET(req("/api/v2/tasks/tk-9999"), ctx("tk-9999"));
check("detail: unknown id → 404", res.status === 404);

res = await detailRoute.PATCH(req(`/api/v2/tasks/${t1.id}`, jsonInit("PATCH", { title: "renamed quarterly review", scheduledDate: "2026-09-15" })), ctx(t1.id));
j = await res.json();
check("patch: title + scheduledDate", res.status === 200 && j.task.title === "renamed quarterly review" && j.task.scheduledDate === "2026-09-15", j);

// Legal user transition.
res = await detailRoute.PATCH(req(`/api/v2/tasks/${t1.id}`, jsonInit("PATCH", { status: "Ready" })), ctx(t1.id));
j = await res.json();
check("patch: legal status Todo→Ready (buffer armed)", res.status === 200 && j.task.status === "Ready" && !!j.task.runAt, j);

// Illegal: Working is runtime-owned → 409 with the reason.
res = await detailRoute.PATCH(req(`/api/v2/tasks/${t1.id}`, jsonInit("PATCH", { status: "Working" })), ctx(t1.id));
j = await res.json();
check("patch: status Working → 409", res.status === 409, res.status);
check("patch: 409 body carries the phase-rule reason", typeof j.error === "string" && j.error.includes("runtime-owned"), j);

// Park it back to Todo so the buffer doesn't fire mid-smoke.
res = await detailRoute.PATCH(req(`/api/v2/tasks/${t1.id}`, jsonInit("PATCH", { status: "Todo" })), ctx(t1.id));
j = await res.json();
check("patch: back to Todo clears pending buffer", res.status === 200 && j.task.status === "Todo" && j.task.runAt === null, j);

// Title edit mid-pending-fire must NOT touch the recurring task's queue (B3.4).
const jobBefore = db.prepare("SELECT run_at FROM jobs WHERE id = ?").get(`task:${tRec.id}`);
res = await detailRoute.PATCH(req(`/api/v2/tasks/${tRec.id}`, jsonInit("PATCH", { title: "recurring smoke (renamed)" })), ctx(tRec.id));
const jobAfter = db.prepare("SELECT run_at FROM jobs WHERE id = ?").get(`task:${tRec.id}`);
check("patch: title edit leaves the pending wake untouched (queue-blind)", res.status === 200 && jobBefore?.run_at === jobAfter?.run_at, { jobBefore, jobAfter });

// isActive toggle re-derives runAt from the stored schedule (seed-toggle path).
res = await detailRoute.PATCH(req(`/api/v2/tasks/${tRec.id}`, jsonInit("PATCH", { isActive: false })), ctx(tRec.id));
j = await res.json();
check("patch: isActive=false disarms the job", res.status === 200 && !db.prepare("SELECT id FROM jobs WHERE id = ?").get(`task:${tRec.id}`), j);
res = await detailRoute.PATCH(req(`/api/v2/tasks/${tRec.id}`, jsonInit("PATCH", { isActive: true })), ctx(tRec.id));
j = await res.json();
check("patch: isActive=true re-arms from the STORED schedule", res.status === 200 && j.task.isActive === true && !!j.task.runAt && !!db.prepare("SELECT id FROM jobs WHERE id = ?").get(`task:${tRec.id}`), j);

console.log("=== APPROVE FLOW (create → run → Waiting → approve → Review) ===");
res = await tasksRoute.POST(req("/api/v2/tasks", jsonInit("POST", { title: "approve flow task", specMd: "smoke approve flow" })));
const tFlow = (await res.json()).task;

res = await runRoute.POST(req(`/api/v2/tasks/${tFlow.id}/run`, { method: "POST" }), ctx(tFlow.id));
check("run: POST /run → 202", res.status === 202);
await sched.tickOnce();
await waitFor(() => store.getTask(tFlow.id)?.planStatus === "drafted");
let tf = store.getTask(tFlow.id);
check("run: plan drafted + parked Waiting", tf.planStatus === "drafted" && tf.status === "Waiting", tf.status);

// Approve on a non-drafted task → 409.
res = await approveRoute.POST(req(`/api/v2/tasks/${t1.id}/approve`, jsonInit("POST", {})), ctx(t1.id));
check("approve: non-drafted plan → 409", res.status === 409);

res = await approveRoute.POST(req(`/api/v2/tasks/${tFlow.id}/approve`, jsonInit("POST", { note: "ship it" })), ctx(tFlow.id));
j = await res.json();
check("approve: 200 + planStatus approved + status untouched", res.status === 200 && j.task.planStatus === "approved" && j.task.status === "Waiting", j);
await sched.tickOnce();
await waitFor(() => store.getTask(tFlow.id)?.status === "Review");
tf = store.getTask(tFlow.id);
check("approve: end-to-end reaches Review with a result", tf.status === "Review" && !!tf.result, tf.status);

// Reject variant.
res = await tasksRoute.POST(req("/api/v2/tasks", jsonInit("POST", { title: "reject flow task" })));
const tRej = (await res.json()).task;
await runRoute.POST(req(`/api/v2/tasks/${tRej.id}/run`, { method: "POST" }), ctx(tRej.id));
await sched.tickOnce();
await waitFor(() => store.getTask(tRej.id)?.planStatus === "drafted");
res = await approveRoute.POST(req(`/api/v2/tasks/${tRej.id}/approve`, jsonInit("POST", { action: "reject", reason: "wrong angle" })), ctx(tRej.id));
j = await res.json();
check("reject: 200 + plan cleared to none", res.status === 200 && j.task.planStatus === "none" && j.task.planMd === null, j);

console.log("=== CHAT + WAITING-REPLY HOOK ===");
// Blocked task (mock): approve its plan, execution blocks → Waiting.
res = await tasksRoute.POST(req("/api/v2/tasks", jsonInit("POST", { title: "blocked chat task", specMd: "MOCK_BLOCKER" })));
const tBlk = (await res.json()).task;
await runRoute.POST(req(`/api/v2/tasks/${tBlk.id}/run`, { method: "POST" }), ctx(tBlk.id));
await sched.tickOnce();
await waitFor(() => store.getTask(tBlk.id)?.planStatus === "drafted");
await approveRoute.POST(req(`/api/v2/tasks/${tBlk.id}/approve`, jsonInit("POST", {})), ctx(tBlk.id));
await sched.tickOnce();
await waitFor(() => store.getTask(tBlk.id)?.status === "Waiting" && store.getTask(tBlk.id)?.planStatus === "approved");
check("chat setup: task blocked → Waiting", store.getTask(tBlk.id)?.status === "Waiting");

res = await chatRoute.GET(req(`/api/v2/tasks/${tBlk.id}/chat`), ctx(tBlk.id));
j = await res.json();
check("chat: GET returns conversation + messages", res.status === 200 && typeof j.conversationId === "string" && Array.isArray(j.messages) && j.messages.length > 0, j.messages?.length);
check("chat: ephemeral trigger turns hidden", !j.messages.some((m) => m.content === `Work on the task ${tBlk.displayId}.`));

res = await chatRoute.POST(req(`/api/v2/tasks/${tBlk.id}/chat`, jsonInit("POST", { text: "take option A" })), ctx(tBlk.id));
j = await res.json();
check("chat: POST appends the user turn", res.status === 200 && j.message?.content === "take option A", j);
check("chat: checkWaitingTaskReply fired (Waiting → Ready)", j.unblocked === 1 && store.getTask(tBlk.id)?.status === "Ready", j.unblocked);

res = await chatRoute.POST(req(`/api/v2/tasks/${tBlk.id}/chat`, jsonInit("POST", {})), ctx(tBlk.id));
check("chat: empty text → 400", res.status === 400);

// B6 (chunk 4): the chat POST ingests the exchange into Memory V2 — wait for
// the queue row so the fire-and-forget ingest settles before process exit.
const chatIngestRow = () =>
  db.prepare("SELECT COUNT(*) c FROM ingestion_queue WHERE source = 'task' AND data LIKE '%take option A%'").get().c;
await waitFor(() => chatIngestRow() === 1, 8000);
check("chat: B6 ingest row queued (source 'task', exchange body)", chatIngestRow() === 1, chatIngestRow());

console.log("=== RUN GUARDS + DELETE (exile) ===");
res = await runRoute.POST(req("/api/v2/tasks/tk-9999/run", { method: "POST" }), ctx("tk-9999"));
check("run: unknown → 404", res.status === 404);
store.changeTaskStatus(tRej.id, "Done", "user");
res = await runRoute.POST(req(`/api/v2/tasks/${tRej.id}/run`, { method: "POST" }), ctx(tRej.id));
check("run: Done task → 409", res.status === 409);

res = await detailRoute.DELETE(req(`/api/v2/tasks/${t1.id}`, { method: "DELETE" }), ctx(t1.id));
j = await res.json();
check("delete: exiles with bundle path", res.status === 200 && j.ok === true && typeof j.exiledTo === "string", j);
check("delete: bundle exists on disk", fs.existsSync(j.exiledTo));
res = await detailRoute.GET(req(`/api/v2/tasks/${t1.id}`), ctx(t1.id));
check("delete: task gone → 404", res.status === 404);

console.log("=== AGENTS STRIP + RECALC ===");
res = await agentsStripRoute.GET();
j = await res.json();
const BANDS = ["running", "idle", "waiting", "error", "offline"];
check("agents-strip: 200 + agents array", res.status === 200 && Array.isArray(j.agents));
check("agents-strip: every band in the CONVENTIONS palette set", (j.agents ?? []).every((a) => BANDS.includes(a.band)), j.agents?.map((a) => a.band));

res = await recalcRoute.POST();
j = await res.json();
check("recalc: recomputes active schedules", res.status === 200 && typeof j.recalculated === "number" && j.recalculated >= 2, j);

// ---------------------------------------------------------------------------
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
