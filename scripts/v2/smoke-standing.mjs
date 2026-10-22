// S26 Standing orders smoke, offline.
//   A. one list over three sources: scheduled tasks (live or held), agents' schedule
//      triggers (next run from croner), system jobs; task wake-ups are not listed twice
//   B. counts: on the books, live, next one
//   C. task actions through applySchedule: let it run arms the wake job, hold removes it,
//      take it off needs a confirm and keeps the task, run it now enqueues one wake
//   D. agent actions: hold / let run flip the agent; take it off keeps agent.json as a
//      version before removing just that trigger (run it now is not exercised: it would
//      start a real, billed agent run)
//   E. system jobs: hold works, take it off is refused (never exercised: run it now, it
//      would really run the job)
//   F. routes   G. UI wiring
// HOME / USERPROFILE and every store point at a temp dir, so nothing here can touch the
// owner's real files (db.backup, for one, writes under the home dir, not AGENTIC_OS_DB).
// Run: npx tsx scripts/v2/smoke-standing.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-standing-"));
process.env.HOME = tmp;
process.env.USERPROFILE = tmp;
process.env.AGENTIC_OS_SETTINGS = path.join(tmp, "settings.json");
process.env.AGENTIC_OS_DB = path.join(tmp, "test.db");
process.env.AGENTIC_OS_AGENTS_DIR = path.join(tmp, "agents");
process.env.AGENTIC_OS_PRINCIPALS = path.join(tmp, "principals"); // saveAgent can register a principal (isolationGuard)
process.env.AGENTIC_OS_FILE_VERSIONS_DIR = path.join(tmp, "versions");
process.env.AGENTIC_OS_RUNS_DIR = path.join(tmp, "runs");
process.env.AGENTIC_OS_WEBMCP_DIR = path.join(tmp, "webmcp");
process.env.AGENTIC_OS_SKILLS_DIR = path.join(tmp, "skills");
process.env.AGENTIC_OS_AGENTMAIL_DIR = path.join(tmp, "agentmail");
process.env.AGENTIC_OS_NEWSLETTER_DIR = path.join(tmp, "newsletter");
fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, "{}", "utf8");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || extra === undefined ? "" : `  [${String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 300)}]`}`);
  if (!cond) failures++;
};
const errOf = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

const { ensureV2 } = await import("../../src/lib/v2/boot.ts");
ensureV2();
const tasks = await import("../../src/lib/v2/tasks/store.ts");
const rec = await import("../../src/lib/v2/tasks/recurrence.ts");
const sched = await import("../../src/lib/v2/scheduler.ts");
const store = await import("../../src/lib/agentsStore.ts");
const O = await import("../../src/lib/v2/standing/orders.ts");

// Fixtures: one live scheduled task, one agent with a schedule trigger + a manual one.
const t = tasks.createTask({ title: "Weekly pipeline review", descriptionMd: "Review the Deal Desk pipeline and list stalled deals." });
rec.applySchedule(t.id, { schedule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0", isActive: true });
const AID = "agent-standing-0001";
await store.saveAgent({ id: AID, name: "Scout", description: "scouts", permissionMode: "gated", intelligence: "fast", enabled: true, createdAt: 1, updatedAt: 1, tools: { mcp: "none", browser: false }, triggers: [{ type: "manual" }, { type: "schedule", cron: "every 15 minutes" }] });
fs.writeFileSync(path.join(store.agentDir(AID), "system.md"), "You scout job boards for work that fits.\n", "utf8");

// ── A ─────────────────────────────────────────────────────────────────────────
let orders = await O.listStandingOrders();
const byId = (id) => orders.find((o) => o.id === id);
const taskOrder = byId(`task:${t.id}`);
check("A1 a scheduled task is a standing order, live, with its cadence and prompt", taskOrder?.live === true && /Monday|MO/i.test(taskOrder.cadence) && taskOrder.prompt.startsWith("Review the Deal Desk") && taskOrder.nextRunAt > Date.now());
check("A2 the seeded (inactive) scheduled tasks show as held, not hidden", orders.some((o) => o.kind === "task" && !o.live));
const agentOrder = byId(`agent:${AID}:1`);
check("A3 an agent's schedule trigger is listed with a real next run", agentOrder?.live === true && agentOrder.cadence.startsWith("cron */15") && agentOrder.nextRunAt > Date.now() && agentOrder.nextRunAt - Date.now() <= 15 * 60_000 + 1000);
check("A4 its prompt and model come from the agent", agentOrder.prompt.startsWith("You scout") && agentOrder.model === "claude-haiku-4-5");
check("A5 the manual trigger is not a standing order", !byId(`agent:${AID}:0`));
check("A6 system jobs are listed (the nightly backup)", orders.some((o) => o.kind === "system" && o.title === "Nightly DB backup" && o.model === null));
check("A7 task wake-ups are not listed a second time as system jobs", !orders.some((o) => o.kind === "system" && o.deliveredBy.includes("task.wake")));
check("A8 a task with no agent says its model is not recorded", taskOrder.model === null);

// ── B ─────────────────────────────────────────────────────────────────────────
const c = O.orderCounts(orders);
check("B1 on the books / live / next one", c.onTheBooks === orders.length && c.live === orders.filter((o) => o.live).length && c.nextOne && c.nextOne.at === Math.min(...orders.filter((o) => o.live && o.nextRunAt).map((o) => o.nextRunAt)));

// ── C ─────────────────────────────────────────────────────────────────────────
const job = () => sched.listJobs().find((j) => j.id === `task:${t.id}`);
check("C0 the live task has its wake job armed", !!job());
await O.actOnOrder(`task:${t.id}`, "hold");
check("C1 hold: task inactive, wake job removed", tasks.getTask(t.id).isActive === false && !job());
await O.actOnOrder(`task:${t.id}`, "resume");
check("C2 let it run: active again, wake job re-armed", tasks.getTask(t.id).isActive === true && !!job());
const before = sched.listJobs().filter((j) => j.id.startsWith(`task-now:${t.id}`)).length;
await O.actOnOrder(`task:${t.id}`, "run");
check("C3 run it now enqueues exactly one immediate wake", sched.listJobs().filter((j) => j.id.startsWith(`task-now:${t.id}`)).length === before + 1);
check("C4 take it off without confirm is refused (403)", (await errOf(() => O.actOnOrder(`task:${t.id}`, "takeoff")))?.status === 403);
await O.actOnOrder(`task:${t.id}`, "takeoff", true);
check("C5 take it off clears the schedule and keeps the task", tasks.getTask(t.id) !== null && tasks.getTask(t.id).schedule === null && !job());
orders = await O.listStandingOrders();
check("C6 once off the books it is no longer a standing order", !orders.some((o) => o.id === `task:${t.id}`));

// ── D ─────────────────────────────────────────────────────────────────────────
await O.actOnOrder(`agent:${AID}:1`, "hold");
check("D1 hold switches the agent off", (await store.loadAgent(AID)).enabled === false);
await O.actOnOrder(`agent:${AID}:1`, "resume");
check("D2 let it run switches it back on", (await store.loadAgent(AID)).enabled === true);
await O.actOnOrder(`agent:${AID}:1`, "takeoff", true);
const after = await store.loadAgent(AID);
const vdir = path.join(process.env.AGENTIC_OS_FILE_VERSIONS_DIR, `agent_${AID}`, "agent.json");
check("D3 take it off removes only that schedule trigger", after.triggers.length === 1 && after.triggers[0].type === "manual");
check("D4 and kept agent.json as a version first", fs.existsSync(vdir) && fs.readdirSync(vdir).length === 1 && fs.readFileSync(path.join(vdir, fs.readdirSync(vdir)[0]), "utf8").includes("every 15 minutes"));

// ── E ─────────────────────────────────────────────────────────────────────────
const sys = (await O.listStandingOrders()).find((o) => o.kind === "system" && o.title === "Nightly DB backup");
await O.actOnOrder(sys.id, "hold");
check("E1 hold disables the system job", sched.listJobs().find((j) => `job:${j.id}` === sys.id).enabled === 0);
await O.actOnOrder(sys.id, "resume");
check("E2 let it run re-enables it", sched.listJobs().find((j) => `job:${j.id}` === sys.id).enabled === 1);
check("E3 a system job cannot be taken off (409)", (await errOf(() => O.actOnOrder(sys.id, "takeoff", true)))?.status === 409);

// ── F ─────────────────────────────────────────────────────────────────────────
const route = await import("../../src/app/api/v2/standing/route.ts");
let res = await route.GET(); let j = await res.json();
check("F1 GET: orders and counts", res.status === 200 && Array.isArray(j.orders) && typeof j.counts.onTheBooks === "number");
res = await route.POST(new Request("http://x", { method: "POST", body: JSON.stringify({ id: "x", action: "explode" }) }));
check("F2 an unknown action is 400", res.status === 400);
res = await route.POST(new Request("http://x", { method: "POST", body: JSON.stringify({ id: "task:nope", action: "hold" }) }));
check("F3 an unknown order is 404", res.status === 404);

// ── G ─────────────────────────────────────────────────────────────────────────
const ui = fs.readFileSync("src/components/jarvis/StandingOrdersTab.tsx", "utf8");
const hub = fs.readFileSync("src/components/jarvis/JarvisHub.tsx", "utf8");
check("G1 tab registered", /key: "orders", label: "Standing orders"[^\n]*<StandingOrdersTab \/>/.test(hub));
check("G2 all four actions, take-off behind a confirm", ["Run it now", "Hold it", "Let it run", "Take it off"].every((l) => ui.includes(l)) && ui.includes("confirmOff === o.id"));
check("G3 unrecorded model says so", ui.includes("not recorded"));
check("G4 the backup never ran here", !fs.existsSync(path.join(os.homedir(), ".agentic-os", "backups")) || os.homedir() === tmp);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
