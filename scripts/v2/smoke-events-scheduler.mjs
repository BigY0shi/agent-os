// F2 smoke: event bus + scheduler over a temp DB.
// Run: npx tsx scripts/v2/smoke-events-scheduler.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmp = path.join(os.tmpdir(), `agentos-smoke-f2-${Date.now()}.db`);
process.env.AGENTIC_OS_DB = tmp;

const { __closeForTests } = await import("../../src/lib/v2/db.ts");
const events = await import("../../src/lib/v2/events.ts");
const sched = await import("../../src/lib/v2/scheduler.ts");

let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
};

// ---- events ----
let heard = 0;
const off = events.on("test.ping", () => heard++);
let star = 0;
events.on("*", () => star++);

events.emit("test.ping", { n: 1 }, "smoke");
events.emit("test.ping", { n: 2 }, "smoke");
events.emit("test.other", { n: 3 }, "smoke");

check("typed listener fired twice", heard === 2);
check("wildcard listener fired 3x", star === 3);
off();
events.emit("test.ping", { n: 4 }, "smoke");
check("unsubscribe works", heard === 2);

const rec = events.recent({ limit: 10 });
check("recent newest-first", rec[0].payload.n === 4 && rec.length === 4);
check("recent type filter", events.recent({ type: "test.other" }).length === 1);
check("recent types[] filter", events.recent({ types: ["test.ping", "test.other"] }).length === 4);
check("payload round-trips as object", typeof rec[0].payload === "object");

// ---- scheduler: one-shot ----
let ran = [];
sched.registerJobHandler("test.oneshot", (payload) => { ran.push(payload.tag); });
sched.scheduleJob({ kind: "test.oneshot", name: "one", runAt: new Date(Date.now() - 1000).toISOString(), payload: { tag: "a" } });
let fired = await sched.tickOnce();
check("one-shot fired via tickOnce", fired === 1 && ran.includes("a"));

const jobs1 = sched.listJobs();
const oneshot = jobs1.find((j) => j.kind === "test.oneshot");
check("one-shot disabled after run", oneshot.enabled === 0 && oneshot.last_status === "ok");

// ---- scheduler: recurring advances run_at ----
sched.registerJobHandler("test.minutely", () => { ran.push("m"); });
const rec1 = sched.scheduleJob({ id: "recur-1", kind: "test.minutely", name: "minutely", rrule: "FREQ=MINUTELY" });
// force due now
const { getDb } = await import("../../src/lib/v2/db.ts");
getDb().prepare("UPDATE jobs SET run_at = ? WHERE id = 'recur-1'").run(new Date(Date.now() - 500).toISOString());
await sched.tickOnce();
const rec2 = sched.listJobs().find((j) => j.id === "recur-1");
check("recurring ran", ran.includes("m"));
check("recurring still enabled", rec2.enabled === 1);
check("recurring run_at advanced into future", rec2.run_at > new Date().toISOString());

// ---- error capture ----
sched.registerJobHandler("test.boom", () => { throw new Error("kaboom"); });
sched.scheduleJob({ kind: "test.boom", name: "boom", runAt: new Date(Date.now() - 1000).toISOString() });
await sched.tickOnce();
const boom = sched.listJobs().find((j) => j.kind === "test.boom");
check("handler error captured, not thrown", boom.last_status === "error" && boom.last_error.includes("kaboom"));
check("job.failed event emitted", events.recent({ type: "job.failed" }).length >= 1);

// ---- missing handler = skipped ----
sched.scheduleJob({ kind: "test.nohandler", name: "orphan", runAt: new Date(Date.now() - 1000).toISOString() });
await sched.tickOnce();
const orphan = sched.listJobs().find((j) => j.kind === "test.nohandler");
check("missing handler -> skipped", orphan.last_status === "skipped");

// ---- cronToRrule ----
check("cron */5 * * * *", sched.cronToRrule("*/5 * * * *") === "FREQ=MINUTELY;INTERVAL=5");
check("cron 0 7 * * *", sched.cronToRrule("0 7 * * *") === "FREQ=DAILY;BYHOUR=7;BYMINUTE=0");
check("cron 30 8 * * 1", sched.cronToRrule("30 8 * * 1") === "FREQ=WEEKLY;BYDAY=MO;BYHOUR=8;BYMINUTE=30");
check("cron 0 8 1 * *", sched.cronToRrule("0 8 1 * *") === "FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=8;BYMINUTE=0");
let cronThrew = false;
try { sched.cronToRrule("weird"); } catch { cronThrew = true; }
check("bad cron throws loudly", cronThrew);

// ---- task wrappers ----
sched.registerJobHandler("task.wake", () => {});
sched.enqueueScheduledTask("tk-1", { rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0" });
check("enqueueScheduledTask upserts deterministic id", sched.listJobs().some((j) => j.id === "task:tk-1"));
sched.removeScheduledTask("tk-1");
check("removeScheduledTask deletes", !sched.listJobs().some((j) => j.id === "task:tk-1"));

// ---- debounce ----
let debounced = 0;
sched.registerJobHandler("test.debounce", () => { debounced++; });
sched.enqueueDebounced("k1", 50, "test.debounce");
sched.enqueueDebounced("k1", 50, "test.debounce");
sched.enqueueDebounced("k1", 50, "test.debounce");
await new Promise((r) => setTimeout(r, 150));
check("debounce collapses 3 calls to 1", debounced === 1);

__closeForTests();
try { fs.rmSync(tmp); fs.rmSync(tmp + "-wal", { force: true }); fs.rmSync(tmp + "-shm", { force: true }); } catch {}

console.log(failures === 0 ? "\nsmoke-events-scheduler: ALL PASS" : `\nsmoke-events-scheduler: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
