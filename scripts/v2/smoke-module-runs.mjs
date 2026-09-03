// Module runs registry + /api/runs routes + STOP (roadmap S3), fully offline.
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

// ---- G. STOP (roadmap S3): the one mid-run control ------------------------------
console.log("-- G: stop --");
const postRun = (id, action) => one.POST(new Request("http://local/api/runs/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) }), { params: Promise.resolve({ id }) });

// G1: work that honours ctx.signal (the way cliComplete -> runner.ts killTree does)
let sawAbort = false;
const g1 = M.startModuleRun({ module: "content-engine", label: "Generate: stoppable" }, (ctx) => new Promise((_, reject) => {
  ctx.signal.addEventListener("abort", () => { sawAbort = true; reject(ctx.signal.reason ?? new Error("aborted")); }, { once: true });
}));
await sleep(5);
const g1live = M.getModuleRun(g1.id);
check("ctx.signal is a live AbortSignal on a running run", g1live.status === "running" && sawAbort === false);
check("stopModuleRun on a running run returns true", M.stopModuleRun(g1.id, "owner") === true);
check("the signal fired (the child would be killed)", sawAbort === true);
const g1r = M.getModuleRun(g1.id);
check("status is 'stopped' with who and when", g1r.status === "stopped" && g1r.stoppedBy === "owner" && g1r.endedAt > 0 && /stopped by owner/.test(g1r.error ?? ""), JSON.stringify({ s: g1r.status, by: g1r.stoppedBy, e: g1r.error }));
check("a STOP event is in the run log", g1r.events.some((e) => /STOP pressed by owner/.test(e.text)));
let g1err = null; try { await g1.promise; } catch (e) { g1err = e; }
check("the promise rejects AbortError-like", !!g1err && g1err.name === "AbortError" && /stopped/.test(g1err.message), String(g1err));
check("a stopped run is never 'done' or 'error'", M.getModuleRun(g1.id).status === "stopped");
check("stopping it again is refused", M.stopModuleRun(g1.id) === false);
check("dismiss is allowed after stop", M.dismissModuleRun(g1.id) === true);

// G2: work that IGNORES the signal and resolves later: still 'stopped', caller still gets the abort
const g2d = deferred();
const g2 = M.startModuleRun({ module: "agent-kanban", label: "Build: ignores signal" }, async () => g2d.p, { summarize: (r) => r });
check("stop works without the work listening", M.stopModuleRun(g2.id, "owner") === true);
g2d.resolve({ html: "<div/>" });
let g2err = null; try { await g2.promise; } catch (e) { g2err = e; }
const g2r = M.getModuleRun(g2.id);
check("a late result cannot flip 'stopped' to 'done'", g2r.status === "stopped" && g2r.result === undefined && g2err?.name === "AbortError", JSON.stringify(g2r.status));

// G3: only a running run can be stopped
check("a finished run cannot be stopped", M.stopModuleRun(run2.id) === false && M.getModuleRun(run2.id).status === "error");
check("an unknown id cannot be stopped", M.stopModuleRun("nope") === false);
check("stopped runs count as finished (not running)", M.runningModuleCount() === 0);

// G4: the route
const g4 = M.startModuleRun({ module: "content-engine", label: "Plan: via route" }, (ctx) => new Promise((_, reject) => {
  ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true });
}));
const stopRes = await postRun(g4.id, "stop");
const stopJ = await stopRes.json();
check("POST /api/runs/:id {action:'stop'} on a running run -> 200 + stopped", stopRes.status === 200 && stopJ.ok === true && stopJ.run.status === "stopped" && stopJ.run.stoppedBy === "owner", JSON.stringify(stopJ).slice(0, 160));
check("POST stop on an already-stopped run -> 409", (await postRun(g4.id, "stop")).status === 409);
check("POST stop on an unknown run -> 404", (await postRun("nope", "stop")).status === 404);
check("dismiss after stop works via the route", (await postRun(g4.id, "dismiss")).status === 200);
const g4d = deferred();
const g4b = M.startModuleRun({ module: "hire", label: "still running" }, async () => g4d.p);
check("dismiss on a running run still says STOP first", (await postRun(g4b.id, "dismiss")).status === 409);
check("POST stop on a finished (error) run -> 409", (await postRun(run2.id, "stop")).status === 409);
g4d.resolve(1); await g4b.promise;

// G5: 'stopped' survives a restart as 'stopped', not 'lost'
M.persistNow();
M.__resetModuleRunsForTests();
check("stopped survives a restart as stopped, never lost", M.getModuleRun(g4.id)?.status === "stopped" && M.getModuleRun(g4.id)?.stoppedBy === "owner", JSON.stringify(M.getModuleRun(g4.id)?.status));

// ---- F. wiring: the routes that were supposed to register runs do -------------
console.log("-- F: wiring --");
const src = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
// STOP reaches the child: the signal path exists end to end (S3).
check("runner.ts kills the child tree on abort", /addEventListener\("abort", onAbort/.test(src("src/lib/runner.ts")) && /killTree\(child\)/.test(src("src/lib/runner.ts")));
check("cliComplete forwards opts.signal to run()", /signal: opts\?\.signal/.test(src("src/lib/loopEngine.ts")));
check("seatComplete / kimiComplete take the signal", /export async function seatComplete\([^)]*opts\?: SeatOpts/.test(src("src/lib/brainstorm.ts")) && /AbortSignal\.any/.test(src("src/lib/brainstorm.ts")));
check("multiModelComplete never falls back after a STOP", /opts\.signal\?\.aborted\) throw e/.test(src("src/lib/contentEngine.ts")));
check("localChat forwards the signal to fetch", /signal: opts\.signal/.test(src("src/lib/localOllama.ts")));
for (const p of ["src/app/api/content-engine/generate/route.ts", "src/app/api/content-engine/plan/route.ts", "src/app/api/agent-kanban/plan/route.ts", "src/app/api/agent-kanban/build/route.ts"]) {
  check(`${p.split("/").slice(3, 5).join("/")} registers a run AND passes ctx.signal`, /startModuleRun\(/.test(src(p)) && /signal: ctx\.signal/.test(src(p)));
}
check("/api/runs/:id handles action 'stop'", /action === "stop"/.test(src("src/app/api/runs/[id]/route.ts")) && /stopModuleRun\(/.test(src("src/app/api/runs/[id]/route.ts")));
check("RunsTray shows STOP on running runs and 'stopped' as its own status", /action: "stop"/.test(src("src/components/RunsTray.tsx")) && /"stopped"/.test(src("src/components/RunsTray.tsx")) && /stopped by/.test(src("src/components/RunsTray.tsx")));
check("RunsTray never labels a stopped run 'done'", !/stopped \? "done"/.test(src("src/components/RunsTray.tsx")));
check("content-engine/generate registers a run", /startModuleRun\(/.test(src("src/app/api/content-engine/generate/route.ts")));
check("content-engine/plan registers a run", /startModuleRun\(/.test(src("src/app/api/content-engine/plan/route.ts")));
check("RunsTray is mounted in the root layout", /<RunsTray\s*\/>/.test(src("src/app/layout.tsx")));
check("agentsRuntime exposes live runs for the tray", /export function listLiveAgentRuns/.test(src("src/lib/agentsRuntime.ts")));
check("no ~/.agentic-os touched", !fs.existsSync(path.join(os.homedir(), ".agentic-os", "module-runs.json")) || fs.statSync(path.join(os.homedir(), ".agentic-os", "module-runs.json")).mtimeMs < Date.now() - 60_000);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
