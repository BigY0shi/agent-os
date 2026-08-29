// SPEC-D G2.4/G2.7/G2.8 smoke: sync driver + rules + scheduling glue over the
// `_test` fixture — 3 fixture activities (one pre-filter-rejected with a named
// reason), watermark respected on the second run (0 new), state merged ONLY by
// returned keys, activity.created on the REAL bus, ingest enqueued with the
// EXACT label 'integration:_test' + sourceURL, getActiveRuleTexts seam,
// scheduler job registered/fired via tickOnce/removed on deactivate, overlap
// guard, sync-failure soft path + sync.failed event. Offline (ingestEnabled
// false keeps queue rows PENDING — no LLM, no embedder needed beyond the
// best-effort label embed warn).
// Run: npx tsx scripts/v2/smoke-int-sync.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const stamp = Date.now();
const tmpDb = path.join(os.tmpdir(), `agentos-smoke-intsync-${stamp}.db`);
process.env.AGENTIC_OS_DB = tmpDb;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-intsync-"));
const settingsFile = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_SETTINGS = settingsFile;
process.env.AGENTIC_OS_KEY = path.join(settingsDir, "agentos.key");
// Point the embedder at a dead port so the best-effort label embed fails fast.
process.env.OLLAMA_URL = "http://127.0.0.1:1";
fs.writeFileSync(
  settingsFile,
  JSON.stringify({
    tasks: { timezone: "America/Chicago" },
    memory: { ingestEnabled: false },
  }),
);

const { ensureDb, getDb, __closeForTests } = await import("../../src/lib/v2/db.ts");
const runtime = await import("../../src/lib/v2/integrations/runtime.ts");
const store = await import("../../src/lib/v2/integrations/store.ts");
const sync = await import("../../src/lib/v2/integrations/sync.ts");
const rules = await import("../../src/lib/v2/integrations/rules.ts");
const schedule = await import("../../src/lib/v2/integrations/schedule.ts");
const { on } = await import("../../src/lib/v2/events.ts");
const { tickOnce } = await import("../../src/lib/v2/scheduler.ts");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  if (!cond) failures++;
};

ensureDb();

const created = [];
on("activity.created", (e) => created.push(e));
const syncFailed = [];
on("sync.failed", (e) => syncFailed.push(e));

// ---------------------------------------------------------------------------
// A. Connect + rules (G2.7)
// ---------------------------------------------------------------------------
const account = await runtime.setupAccount("_test", { fields: { token: "tok-sync" } });
const rule = rules.createAccountRule(account.id, {
  name: "no junk",
  text: "Ignore junk mail entirely",
  preFilter: { exclude: ["junk"] },
});
check("rule created with pre-filter (source = account id)", rule.preFilter?.exclude?.[0] === "junk");
const texts = rules.getActiveRuleTexts(account.id);
check("getActiveRuleTexts returns the formatted rule", texts?.includes("no junk: Ignore junk mail entirely"));
check("rule row lives in SPEC-A ingestion_rules with source=accountId", getDb().prepare("SELECT source FROM ingestion_rules WHERE id = ?").get(rule.id)?.source === account.id);

// ---------------------------------------------------------------------------
// B. First sync: 2 accepted + 1 rejected + watermark + events + ingest (G2.4)
// ---------------------------------------------------------------------------
const run1 = await sync.runAccountSync(account.id, "manual");
check("first sync ok, 2 accepted", run1.ok === true && run1.activitiesCount === 2);
check("1 activity pre-filter-rejected", run1.rejectedCount === 1);
check("watermark state persisted", run1.state?.cursor === "3");

const activities = store.listActivities(account.id);
check("3 activity rows total", activities.length === 3);
const rejected = activities.find((a) => a.rejectionReason);
check("rejected row names the rule + pattern", rejected?.ingestStatus === "rejected" && rejected.rejectionReason.includes("no junk") && rejected.rejectionReason.includes("junk"));
const accepted = activities.filter((a) => !a.rejectionReason);
check("accepted rows marked 'ingested' (queued)", accepted.every((a) => a.ingestStatus === "ingested"));
check("accepted rows carry sourceURL", accepted.every((a) => a.sourceUrl?.startsWith("https://example.com/")));

check("activity.created emitted for ACCEPTED only (2)", created.length === 2 && created.every((e) => e.payload.slug === "_test" && e.payload.accountId === account.id));

// Ingest seam: queue rows with the EXACT taint label + sourceURL metadata.
const qRows = getDb().prepare("SELECT * FROM ingestion_queue ORDER BY created_at").all();
check("2 ingestion_queue rows enqueued", qRows.length === 2);
check("queue source is integration:_test", qRows.every((r) => r.source === "integration:_test"));
const qData = qRows.map((r) => JSON.parse(r.data));
check("queue metadata carries sourceURL + untrusted marker", qData.every((d) => d.metadata?.sourceURL?.startsWith("https://example.com/") && d.metadata?.untrusted === true));
const label = getDb().prepare("SELECT id FROM labels WHERE name = 'integration:_test'").get();
check("label 'integration:_test' created (§9.4 taint shape EXACT)", !!label);
check("queue rows carry the label id", qRows.every((r) => JSON.parse(r.label_ids ?? "[]").includes(label?.id)));
check("queue rows stay PENDING offline (ingestEnabled false)", qRows.every((r) => r.status === "PENDING"));

const runRow1 = store.latestSyncRun(account.id);
check("sync_run row ok=1 count=2 trigger manual", runRow1.ok === true && runRow1.activitiesCount === 2 && runRow1.trigger === "manual");

// ---------------------------------------------------------------------------
// C. Second sync: watermark → 0 new; state merge keeps foreign keys
// ---------------------------------------------------------------------------
store.mergeAccountState(account.id, { unrelated: "keep-me" });
const run2 = await sync.runAccountSync(account.id, "manual");
check("second sync emits 0 (watermark respected)", run2.ok === true && run2.activitiesCount === 0 && run2.rejectedCount === 0);
check("no new activity rows", store.listActivities(account.id).length === 3);
const stateAfter = store.getAccountState(account.id);
check("state merged ONLY by returned keys (cursor kept, unrelated kept)", stateAfter.cursor === "3" && stateAfter.unrelated === "keep-me");

// ---------------------------------------------------------------------------
// D. Sync failure: soft + run row error + sync.failed event
// ---------------------------------------------------------------------------
const failAccount = await runtime.setupAccount("_test", { fields: { token: "sync-fail" } });
const runFail = await sync.runAccountSync(failAccount.id, "manual");
check("connector sync throw → SOFT {ok:false, error}", runFail.ok === false && runFail.error.includes("exploded"));
const failRow = store.latestSyncRun(failAccount.id);
check("failed sync_run row records the error", failRow.ok === false && failRow.error.includes("exploded"));
check("sync.failed emitted", syncFailed.length === 1 && syncFailed[0].payload.accountId === failAccount.id);

// ---------------------------------------------------------------------------
// E. Scheduling glue (G2.8) — registered, fires via tickOnce, overlap guard,
//    removed on deactivate
// ---------------------------------------------------------------------------
schedule.ensureIntegrationSync();
const jobId = schedule.syncJobId(account.id);
let job = getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
check("sync job registered (deterministic id, cron→RRULE honored)", !!job && job.kind === "integration.sync" && job.rrule === "FREQ=MINUTELY;INTERVAL=15");

// Force the job due, fire it through the REAL scheduler.
const runsBefore = store.listSyncRuns(account.id).length;
getDb().prepare("UPDATE jobs SET run_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), jobId);
await tickOnce();
const runsAfterFire = store.listSyncRuns(account.id);
check("tick fired a 'schedule'-trigger sync run", runsAfterFire.length === runsBefore + 1 && runsAfterFire[0].trigger === "schedule");
job = getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
check("job rescheduled to the next RRULE occurrence", !!job?.run_at && new Date(job.run_at).getTime() > Date.now() - 1000);

// Overlap guard: mark in-flight, force due, tick → skipped (no new run row).
globalThis.__agentosIntSyncInFlight.add(account.id);
getDb().prepare("UPDATE jobs SET run_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), jobId);
await tickOnce();
check("overlap guard skips a fire while in flight", store.listSyncRuns(account.id).length === runsAfterFire.length);
globalThis.__agentosIntSyncInFlight.delete(account.id);

// Master kill switch gates SCHEDULED fires only.
fs.writeFileSync(settingsFile, JSON.stringify({ tasks: { timezone: "America/Chicago" }, memory: { ingestEnabled: false }, integrations: { syncEnabled: false } }));
getDb().prepare("UPDATE jobs SET run_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), jobId);
await tickOnce();
check("syncEnabled=false skips scheduled fires", store.listSyncRuns(account.id).length === runsAfterFire.length);
const manualStill = await sync.runAccountSync(account.id, "manual");
check("manual sync still runs under the kill switch", manualStill.ok === true);
fs.writeFileSync(settingsFile, JSON.stringify({ tasks: { timezone: "America/Chicago" }, memory: { ingestEnabled: false } }));

// autoActivityRead=false unregisters.
store.patchAccountSettings(account.id, { autoActivityRead: false });
schedule.ensureAccountSyncJob(store.getAccount(account.id));
check("autoActivityRead=false removes the job", !getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(jobId));
store.patchAccountSettings(account.id, { autoActivityRead: true });
schedule.ensureAccountSyncJob(store.getAccount(account.id));
check("re-enabling re-registers", !!getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(jobId));

// Deactivate → job removed (G2.8 unregister-on-deactivate).
store.setAccountActive(account.id, false);
schedule.ensureAccountSyncJob(store.getAccount(account.id));
check("deactivated account → job removed", !getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(jobId));

// A stale job whose account vanished cleans itself up on fire.
const ghost = schedule.syncJobId(failAccount.id);
store.setAccountActive(failAccount.id, false);
getDb().prepare("UPDATE jobs SET run_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), ghost);
await tickOnce();
check("fire on a deactivated account self-removes the job", !getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(ghost));

// ---------------------------------------------------------------------------
try {
  const queue = await import("../../src/lib/v2/memory/queue.ts");
  queue.stopMemoryQueue?.();
} catch {}
try {
  const sched = globalThis.__agentosV2Scheduler;
  if (sched?.timer) clearInterval(sched.timer);
} catch {}
await new Promise((r) => setTimeout(r, 250));
__closeForTests();
for (const f of [tmpDb, tmpDb + "-wal", tmpDb + "-shm"]) {
  try { fs.rmSync(f, { force: true }); } catch {}
}
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
