// Module runs registry + /api/runs routes, fully offline.
//
// Run: npx tsx scripts/v2/smoke-module-runs.mjs
//
// Rule 19: AGENTIC_OS_RUNS_DIR and AGENTIC_OS_SETTINGS are redirected BEFORE
// any import; nothing here touches ~/.agentic-os. No model, no network: the
// "work" is a promise the test resolves by hand.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-runs-"));
process.env.AGENTIC_OS_RUNS_DIR = dir;
process.env.AGENTIC_OS_SETTINGS = path.join(dir, "settings.json");
fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, JSON.stringify({ memory: { ingestEnabled: false } }), "utf8");

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !extra ? "" : `  [${extra}]`}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deferred = () => { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };

const M = await import("../../src/lib/moduleRuns.ts");

// ---- A. a run is visible the moment it starts, and outlives its caller -----
console.log("-- A: lifecycle --");
const seen = [];
const unsub = M.subscribeModuleRuns((r) => seen.push({ id: r.id, status: r.status, events: r.events.length }));
const d1 = deferred();
const run1 = M.startModuleRun({ module: "content-engine", label: "Generate materials: Launch thread", href: "/content-engine" }, async (ctx) => {
  ctx.log("asking the seat");
  ctx.progress(1, 3);
  const v = await d1.p;
  ctx.log("parsed JSON");
  return { copy: v };
}, { summarize: (r) => ({ copyChars: r.copy.length }) });
const live = M.getModuleRun(run1.id);
check("registered immediately as running", live?.status === "running" && live.module === "content-engine");
check("subscriber saw the start", seen.some((s) => s.id === run1.id && s.status === "running"));
await sleep(5);
check("log + progress recorded while running", M.getModuleRun(run1.id).events.length === 1 && M.getModuleRun(run1.id).progress?.n === 1);
check("listed first while running", M.listModuleRuns()[0]?.id === run1.id && M.runningModuleCount() === 1);
check("a running run cannot be dismissed", M.dismissModuleRun(run1.id) === false);
d1.resolve("hello world");
const out = await run1.promise;
check("caller still gets the real result", out.copy === "hello world");
const done = M.getModuleRun(run1.id);
check("done with summary, not payload", done.status === "done" && done.result?.copyChars === 11 && !("copy" in (done.result ?? {})), JSON.stringify(done.result));
check("events in order", done.events.map((e) => e.text).join("|") === "asking the seat|parsed JSON");

// ---- B. failure is recorded, never an unhandled rejection --------------------
console.log("-- B: failure --");
let unhandled = 0;
const onUnhandled = () => { unhandled++; };
process.on("unhandledRejection", onUnhandled);
const run2 = M.startModuleRun({ module: "deals", label: "Brief: ACME" }, async () => { throw new Error("generator did not return JSON"); });
await sleep(20);
const r2 = M.getModuleRun(run2.id);
check("error status carries the reason", r2.status === "error" && /did not return JSON/.test(r2.error));
check("no unhandled rejection when nobody awaits", unhandled === 0);
let caught = null;
try { await run2.promise; } catch (e) { caught = e.message; }
check("an awaiting caller still sees the throw", /did not return JSON/.test(caught ?? ""));
process.off("unhandledRejection", onUnhandled);
check("finished runs list newest-first after running ones", M.listModuleRuns().map((r) => r.id).join(",") === `${run2.id},${run1.id}`);

// ---- C. dismiss + events cap ---------------------------------------------------
console.log("-- C: dismiss + caps --");
check("dismiss hides a finished run", M.dismissModuleRun(run1.id) === true && !M.listModuleRuns().some((r) => r.id === run1.id));
check("includeDismissed still shows it", M.listModuleRuns({ includeDismissed: true }).some((r) => r.id === run1.id));
const d3 = deferred();
const run3 = M.startModuleRun({ module: "marketing", label: "Plan campaign" }, async (ctx) => { for (let i = 0; i < 100; i++) ctx.log(`line ${i}`); await d3.p; return 1; });
await sleep(5);
const r3 = M.getModuleRun(run3.id);
check("events capped at 40, keeping the newest", r3.events.length === 40 && r3.events[39].text === "line 99" && r3.events[0].text === "line 60");
unsub();

// ---- D. persistence + boot reconciliation --------------------------------------
console.log("-- D: persistence --");
M.persistNow();
const file = JSON.parse(fs.readFileSync(M.runsFile(), "utf8"));
check("file holds running + finished rows", file.runs.some((r) => r.id === run3.id && r.status === "running") && file.runs.some((r) => r.id === run2.id && r.status === "error"));
M.__resetModuleRunsForTests();
const after = M.getModuleRun(run3.id);
check("a run that was running at boot is marked lost, not left spinning", after?.status === "lost" && /server restarted/.test(after.error ?? ""), JSON.stringify(after?.status));
check("finished rows survive the restart", M.getModuleRun(run2.id)?.status === "error");
d3.resolve(1); // let the orphaned promise settle quietly
await sleep(5);

// ---- E. routes ---------------------------------------------------------------
console.log("-- E: routes --");
const list = await import("../../src/app/api/runs/route.ts");
const one = await import("../../src/app/api/runs/[id]/route.ts");
const lj = await (await list.GET(new Request("http://local/api/runs"))).json();
check("GET /api/runs lists module runs", lj.ok && Array.isArray(lj.runs) && lj.runs.some((r) => r.id === run2.id), JSON.stringify(lj).slice(0, 200));
check("GET /api/runs reports whether the agents leg merged", lj.agentsLeg === "merged" || lj.agentsLeg === "skipped");
const gj = await (await one.GET(new Request("http://local/api/runs/x"), { params: Promise.resolve({ id: run2.id }) })).json();
check("GET /api/runs/:id returns the run with events", gj.ok && gj.run.id === run2.id);
const miss = await one.GET(new Request("http://local/api/runs/x"), { params: Promise.resolve({ id: "nope" }) });
check("unknown id is 404", miss.status === 404);
const d4 = deferred();
const run4 = M.startModuleRun({ module: "hire", label: "Pitch" }, async () => d4.p);
const busy = await one.POST(new Request("http://local/api/runs/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "dismiss" }) }), { params: Promise.resolve({ id: run4.id }) });
check("dismissing a live run is refused with 409", busy.status === 409);
d4.resolve(0); await run4.promise;
const okd = await one.POST(new Request("http://local/api/runs/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "dismiss" }) }), { params: Promise.resolve({ id: run4.id }) });
const okj = await okd.json();
check("dismissing a finished run works", okd.ok && okj.run.dismissedAt > 0);

// ---- F. wiring: the routes that were supposed to register runs do -------------
console.log("-- F: wiring --");
const src = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
check("content-engine/generate registers a run", /startModuleRun\(/.test(src("src/app/api/content-engine/generate/route.ts")));
check("content-engine/plan registers a run", /startModuleRun\(/.test(src("src/app/api/content-engine/plan/route.ts")));
check("RunsTray is mounted in the root layout", /<RunsTray\s*\/>/.test(src("src/app/layout.tsx")));
check("agentsRuntime exposes live runs for the tray", /export function listLiveAgentRuns/.test(src("src/lib/agentsRuntime.ts")));
check("no ~/.agentic-os touched", !fs.existsSync(path.join(os.homedir(), ".agentic-os", "module-runs.json")) || fs.statSync(path.join(os.homedir(), ".agentic-os", "module-runs.json")).mtimeMs < Date.now() - 60_000);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
