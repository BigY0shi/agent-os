// S18 Mission Control cockpit smoke, offline.
//   A. /api/v2/home/pulse from temp stores: host measured, checks present, runs counted
//      over a STATED window, success rate and average from real runs, missions counted
//      by stage, seat load from running mission steps, agents from the status feed
//   B. honesty: with no runs the success rate is null (not 0 or 100); processes are only
//      sampled when asked (?processes=1); a failing source lands in `errors`, the rest
//      still answers
//   C. the sampler: CPU for unsampled processes is -1 ("not measured"), filtered out of
//      the CPU list, and its scope is stated
//   D. the page: three views, telemetry first, the scratchpad LAST in the cockpit view,
//      nothing random or invented in the components
// fetch is stubbed (no local service is probed); every store is a temp dir.
// Run: npx tsx scripts/v2/smoke-home-cockpit.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-cockpit-"));
process.env.AGENTIC_OS_SETTINGS = path.join(tmp, "settings.json");
process.env.AGENTIC_OS_DB = path.join(tmp, "test.db");
process.env.AGENTIC_OS_RUNS_DIR = path.join(tmp, "runs");
process.env.AGENTIC_OS_AGENTS_DIR = path.join(tmp, "agents");
process.env.AGENTIC_OS_MISSIONS_DIR = path.join(tmp, "missions");
process.env.AGENTIC_OS_SKILLS_DIR = path.join(tmp, "skills");
process.env.AGENTIC_OS_WEBMCP_DIR = path.join(tmp, "webmcp");
process.env.AGENTIC_OS_AGENTMAIL_DIR = path.join(tmp, "agentmail");
process.env.AGENTIC_OS_NEWSLETTER_DIR = path.join(tmp, "newsletter");
fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, "{}", "utf8");
globalThis.fetch = async () => { throw new Error("fetch failed"); }; // no service answers

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || extra === undefined ? "" : `  [${String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 300)}]`}`);
  if (!cond) failures++;
};
const read = (f) => fs.readFileSync(f, "utf8");

const route = await import("../../src/app/api/v2/home/pulse/route.ts");
const get = async (qs = "") => { const r = await route.GET(new Request(`http://x/api/v2/home/pulse${qs}`)); return { status: r.status, j: await r.json() }; };

// ── A/B: empty stores ─────────────────────────────────────────────────────────
let { status, j } = await get();
check("A1 pulse answers 200", status === 200, j);
check("A2 host measured now", j.host && j.host.cpu.cores > 0 && j.host.memory.totalBytes > 0 && j.host.disks.length >= 1);
check("A3 checks present with a status word", j.checks && typeof j.checks.clear === "number" && ["optimal", "strain", "needs-a-look"].includes(j.checks.status));
check("A4 the runs window is stated", /last 50 finished/.test(j.runs.window));
check("B1 no runs -> success rate and average are null, not invented", j.runs.total === 0 && j.runs.successRate === null && j.runs.avgMs === null && j.runs.spark.length === 0);
check("B2 processes are not sampled unless asked", !("processes" in j));
check("B3 missions all zero on an empty store", Object.values(j.missions).every((v) => v === 0));

// ── A: seeded runs ────────────────────────────────────────────────────────────
const runs = await import("../../src/lib/moduleRuns.ts");
const done = (ms) => runs.startModuleRun({ module: "deals", label: "ok" }, () => new Promise((r) => setTimeout(() => r("x"), ms))).promise;
await Promise.all([done(5), done(10), done(15)]);
await runs.startModuleRun({ module: "hire", label: "bad" }, async () => { throw new Error("boom"); }).promise.catch(() => {});
let release;
runs.startModuleRun({ module: "marketing", label: "long" }, () => new Promise((r) => { release = r; }));
({ j } = await get());
check("A5 runs counted: 4 finished, 1 running", j.runs.total === 5 && j.runs.finished === 4 && j.runs.running === 1, j.runs);
check("A6 success rate from real outcomes (3 of 4)", j.runs.successRate === 75 && j.runs.succeeded === 3 && j.runs.failed === 1);
check("A7 average is a measured duration", typeof j.runs.avgMs === "number" && j.runs.avgMs >= 0);
check("A8 spark is oldest -> newest outcomes", j.runs.spark.length === 4 && j.runs.spark.filter((v) => v === 1).length === 3 && j.runs.spark.includes(0));
check("A9 running work grouped by module", j.runs.byModule.some((m) => m.module === "marketing" && m.running === 1));
release("done");

// ── A: seeded missions ────────────────────────────────────────────────────────
const store = await import("../../src/lib/v2/missions/store.ts");
const base = { name: "n", objective: "o", successLooksLike: "s", priority: "normal", teamMode: "manual", limits: { timeLimitMin: 30, maxSteps: 3, reportLength: "brief" }, endAction: "review", planApproved: true, createdAt: Date.now() };
store.saveMission({ ...base, id: store.newMissionId(), stage: "briefing", planApproved: false, seats: [] });
store.saveMission({ ...base, id: store.newMissionId(), stage: "review", seats: [] });
store.saveMission({ ...base, id: store.newMissionId(), stage: "stopped", seats: [] });
// An in-progress mission with a running step that has a live child must not be
// "recovered" as lost: register a fake child in the runtime registry first.
const rt = await import("../../src/lib/v2/missions/runtime.ts");
const running = { ...base, id: store.newMissionId(), stage: "in-progress", seats: [{ id: "c1", agent: "claude", role: "r" }, { id: "c2", agent: "hermes", role: "r" }], deadlineAt: Date.now() + 3_600_000,
  plan: { rationale: "", guardrails: [], plannedAt: Date.now(), steps: [
    { id: "s1", title: "a", seatId: "c1", brief: "b", dependsOn: [], status: "running", startedAt: Date.now() },
    { id: "s2", title: "b", seatId: "c2", brief: "b", dependsOn: [], status: "running", startedAt: Date.now() },
  ] } };
store.saveMission(running);
globalThis.__agentosMissions.children.set(`${running.id}:s1`, {});
globalThis.__agentosMissions.children.set(`${running.id}:s2`, {});
({ j } = await get());
check("A10 missions counted by stage", j.missions.queued === 1 && j.missions.running === 1 && j.missions.review === 1 && j.missions.parked === 1, j.missions);
check("A11 waiting on you = plans + results", j.missions.waitingOnYou === 1);
check("A12 seat load = running mission steps per CLI", j.seatLoad.find((s) => s.agent === "claude")?.running === 1 && j.seatLoad.find((s) => s.agent === "hermes")?.running === 1);
check("A13 agents come from the status feed (none configured here)", Array.isArray(j.agents) && j.agents.length === 0);
check("B4 no source errored on a healthy temp setup", Object.keys(j.errors).length === 0, j.errors);

// ── B: a broken source is reported, the rest still answers ────────────────────
const bad = store.newMissionId();
fs.mkdirSync(path.join(process.env.AGENTIC_OS_MISSIONS_DIR, bad), { recursive: true });
fs.writeFileSync(path.join(process.env.AGENTIC_OS_MISSIONS_DIR, bad, "mission.json"), "{broken", "utf8");
({ status, j } = await get());
check("B5 one unreadable mission never hides the others", status === 200 && j.missions.running === 1);

// ── C: the sampler ────────────────────────────────────────────────────────────
const hh = read("src/lib/hostHealth.ts");
check("C1 unsampled CPU is -1 and filtered out of the CPU list", hh.includes("cpu = -1 marks \"not measured\", never 0") && hh.includes("rows.filter((r) => r.cpuPercent >= 0)"));
check("C2 the CPU scope is stated in the payload", hh.includes("cpuScope:"));
check("C3 samples are cached so a poll cannot stack scans", hh.includes("Date.now() - topCache.at < 5000"));
const pulseSrc = read("src/app/api/v2/home/pulse/route.ts");
check("C4 processes only on ?processes=1", pulseSrc.includes('get("processes") === "1"'));

// ── D: the page ───────────────────────────────────────────────────────────────
const ov = read("src/components/Overview.tsx");
const cockpitBlock = ov.slice(ov.indexOf('view === "cockpit"'), ov.indexOf('view === "pulse"'));
check("D1 three views", ["\"cockpit\"", "\"pulse\"", "\"scratchpad\""].every((v) => ov.includes(`[${v},`)));
check("D2 cockpit: telemetry first, scratchpad last", cockpitBlock.indexOf("<CockpitBand />") < cockpitBlock.indexOf("<AttentionHero />") && cockpitBlock.indexOf("<HomeGrid />") < cockpitBlock.indexOf("<ScratchpadSlot />"));
check("D3 view choice survives a blocked storage", (ov.match(/try \{/g) || []).length >= 2);
const ck = read("src/components/v2/home/Cockpit.tsx");
check("D4 nothing random or invented in the cockpit", !/Math\.random/.test(ck) && ck.includes("Counted over {pulse.runs.window}"));
check("D5 unknown is shown as unknown", ck.includes('"unknown"') && ck.includes("not measured"));
check("D6 polling pauses while hidden", ck.includes("document.hidden"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
