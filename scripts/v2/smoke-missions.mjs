// S17 Missions smoke, offline. No real CLI ever starts: the drivers are fakes, and the
// missions dir is a temp dir.
//   A. brief validation          B. planning (Jarvis picks the team), strict plan parsing
//   C. approve -> parallel seats, hand-off carries the brief, dependency waits
//   D. heard-from, answers, inputs handed on, report, review -> accept -> delivered
//   E. a failed step stops its dependants; the report names what did not finish
//   F. STOP kills running seats     G. the time limit stops seats and reports
//   H. restart recovery marks lost steps, never shows them running
//   I. send back with a note re-plans with the note   J. per-CLI flags and turn caps
//   K. stats are measured           L. routes
// Run: npx tsx scripts/v2/smoke-missions.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-missions-"));
process.env.AGENTIC_OS_MISSIONS_DIR = path.join(tmp, "missions");
process.env.AGENTIC_OS_SETTINGS = path.join(tmp, "settings.json");
process.env.AGENTIC_OS_DB = path.join(tmp, "test.db");
process.env.AGENTIC_OS_AGENTMAIL_DIR = path.join(tmp, "agentmail");
process.env.AGENTIC_OS_NEWSLETTER_DIR = path.join(tmp, "newsletter");
fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, "{}", "utf8");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || extra === undefined ? "" : `  [${String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 300)}]`}`);
  if (!cond) failures++;
};
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 2000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await tick(15); } return false; };

// ── fake drivers ──────────────────────────────────────────────────────────────
const launched = []; // { agent, args, cwd, input, child }
const killed = [];
const prompts = [];
let planReply = null; // string or function(prompt) -> string
let reportReply = "## Report\nAll done.";
function fakeChild() {
  const c = new EventEmitter();
  c.pid = 1000 + launched.length;
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.finish = (code, out) => { if (out) c.stdout.emit("data", Buffer.from(out)); c.emit("close", code); };
  return c;
}
const drivers = {
  complete: async (prompt) => {
    prompts.push(prompt);
    if (prompt.startsWith("You are Jarvis, planning")) return typeof planReply === "function" ? planReply(prompt) : planReply;
    return reportReply;
  },
  launch: (agent, args, opts) => { const child = fakeChild(); launched.push({ agent, args, cwd: opts.cwd, input: opts.input, child }); return child; },
  kill: (child) => { killed.push(child.pid); },
  installed: (a) => a === "claude" || a === "hermes" || a === "codex",
  defaultModel: (a) => (a === "claude" ? "claude-test-model" : undefined),
};

const rt = await import("../../src/lib/v2/missions/runtime.ts");
const store = await import("../../src/lib/v2/missions/store.ts");
rt.__setMissionDriversForTests(drivers);
const throwsWith = async (fn, re) => { try { await fn(); return false; } catch (e) { return re.test(String(e?.message ?? e)); } };
const brief = (over = {}) => ({ name: "Pricing research", objective: "Find three competitors' pricing.", successLooksLike: "A table with sources.", timeLimitMin: 30, maxSteps: 4, ...over });

// ── A. validation ─────────────────────────────────────────────────────────────
check("A1 name required", await throwsWith(() => rt.createMission(brief({ name: "" })), /name is required/));
check("A2 time limit 15 min .. 8 h", await throwsWith(() => rt.createMission(brief({ timeLimitMin: 5 })), /15 minutes to 8 hours/) && await throwsWith(() => rt.createMission(brief({ timeLimitMin: 600 })), /15 minutes to 8 hours/));
check("A3 max steps 1..12", await throwsWith(() => rt.createMission(brief({ maxSteps: 20 })), /1 to 12/));
check("A4 manual crew must be real agents", await throwsWith(() => rt.createMission(brief({ teamMode: "manual", seats: [{ agent: "gpt9" }] })), /unknown agent/));
check("A5 manual crew must be installed", await throwsWith(() => rt.createMission(brief({ teamMode: "manual", seats: [{ agent: "antigravity" }] })), /not installed: antigravity/));
check("A6 bad target date refused", await throwsWith(() => rt.createMission(brief({ targetDate: "next week" })), /YYYY-MM-DD/));

// ── B. planning ───────────────────────────────────────────────────────────────
planReply = JSON.stringify({
  rationale: "Claude researches, Hermes cross-checks, Claude writes it up.",
  guardrails: ["Cite every price."],
  steps: [
    { title: "Research A", seat: "c1", brief: "Find competitor A pricing.", dependsOn: [] },
    { title: "Research B", seat: "c2", brief: "Find competitor B pricing.", dependsOn: [] },
    { title: "Write table", seat: "c1", brief: "Merge into one table.", dependsOn: [0, 1] },
  ],
});
const m1 = await rt.createMission(brief({ targetDate: "2099-01-01" }));
check("B1 Jarvis-picked crew = installed CLIs", m1.seats.map((s) => s.agent).join(",") === "claude,hermes,codex");
check("B2 created in briefing, not approved", m1.stage === "briefing" && m1.planApproved === false);
await until(() => rt.loadMission(m1.id)?.plan);
let x1 = rt.loadMission(m1.id);
check("B3 plan parsed: 3 steps with dependency ids", x1.plan?.steps.length === 3 && x1.plan.steps[2].dependsOn.join(",") === "s1,s2");
check("B4 unused crew dropped when Jarvis picks", x1.seats.map((s) => s.id).join(",") === "c1,c2");
check("B5 our guardrails always added", x1.plan.guardrails.includes("Cite every price.") && x1.plan.guardrails.some((g) => /no shell/.test(g)) && x1.plan.guardrails.some((g) => /50 turns/.test(g)));
check("B6 nothing launched before approval", launched.length === 0);
check("B7 planner prompt carries the brief and the crew", prompts[0].includes("Find three competitors' pricing.") && prompts[0].includes("c3: codex"));
const fakeM = { ...x1, seats: x1.seats, limits: { ...x1.limits, maxSteps: 2 } };
check("B8 non-JSON plan refused", await throwsWith(() => rt.parsePlan("sure, here is a plan", fakeM), /not JSON/));
check("B9 plan naming a missing crew member refused", await throwsWith(() => rt.parsePlan(JSON.stringify({ steps: [{ seat: "c9", brief: "x" }] }), fakeM), /not on the crew/));
check("B10 forward dependency refused", await throwsWith(() => rt.parsePlan(JSON.stringify({ steps: [{ seat: "c1", brief: "x", dependsOn: [1] }, { seat: "c1", brief: "y" }] }), fakeM), /not an earlier step/));
check("B11 too many steps refused", await throwsWith(() => rt.parsePlan(JSON.stringify({ steps: [1, 2, 3].map(() => ({ seat: "c1", brief: "x" })) }), fakeM), /limit is 2/));
check("B12 approve before a plan exists is refused", await (async () => {
  planReply = () => new Promise(() => {}); // planning never returns
  const hang = await rt.createMission(brief({ name: "Hangs" }));
  await tick();
  return throwsWith(() => rt.missionAction(hang.id, "approve"), /no plan waiting/);
})());

// ── C. approve -> run ─────────────────────────────────────────────────────────
x1 = await rt.missionAction(m1.id, "approve");
check("C1 approved: in progress with a deadline", x1.stage === "in-progress" && x1.deadlineAt - x1.launchedAt === 30 * 60_000);
await until(() => launched.length >= 2);
check("C2 independent steps launched in parallel", launched.length === 2 && launched.map((l) => l.agent).join(",") === "claude,hermes");
let ev = rt.readEvents(m1.id);
const hand = ev.filter((e) => e.kind === "handoff");
check("C3 each hand-off records the brief it sent", hand.length === 2 && hand[0].brief.includes("Find competitor A pricing.") && hand[0].brief.includes("Pricing research"));
check("C4 dependant waits, and says for what", ev.some((e) => e.kind === "waiting" && e.stepId === "s3" && /Research A/.test(e.text) && /Research B/.test(e.text)));
check("C5 each seat has its own scratch dir", launched[0].cwd !== launched[1].cwd && launched[0].cwd.includes(path.join(m1.id, "seats", "s1")));

// ── D. finish steps -> report -> review -> accept ─────────────────────────────
launched[0].child.stdout.emit("data", Buffer.from("searching vendor A...\n"));
await tick();
x1 = rt.loadMission(m1.id);
check("D1 last heard comes from real output", x1.plan.steps[0].lastHeardAt > 0 && x1.plan.steps[0].lastLine === "searching vendor A...");
launched[0].child.finish(0, "A costs $10/mo (source: a.example)");
await tick();
x1 = rt.loadMission(m1.id);
check("D2 finished step is done with its answer saved", x1.plan.steps[0].status === "done" && store.readStepOutput(m1.id, "s1", "md").includes("A costs $10/mo"));
check("D3 dependant still waits for the other input", launched.length === 2 && x1.plan.steps[2].status === "waiting");
launched[1].child.finish(0, "B costs $12/mo");
await until(() => launched.length === 3);
const s3 = launched[2];
check("D4 dependant starts once both inputs are done", s3.agent === "claude" && fs.existsSync(path.join(s3.cwd, "inputs", "s1.md")) && fs.readFileSync(path.join(s3.cwd, "inputs", "s2.md"), "utf8").includes("B costs $12/mo"));
check("D5 its brief points at ./inputs", s3.input.includes("./inputs/"));
s3.child.finish(0, "| vendor | price |\n| A | $10 |\n| B | $12 |");
await until(() => rt.loadMission(m1.id).stage === "review");
x1 = rt.loadMission(m1.id);
check("D6 report written, mission waits for review", x1.stage === "review" && x1.result.includes("All done."));
check("D7 report prompt carries the crew's answers", prompts.some((p) => p.startsWith("You are Jarvis, reporting") && p.includes("A costs $10/mo") && p.includes("about 400 words")));
x1 = await rt.missionAction(m1.id, "accept");
check("D8 accept -> delivered", x1.stage === "delivered" && x1.deliveredAt > 0);
ev = rt.readEvents(m1.id).map((e) => e.kind);
check("D9 the timeline is in order", ["created", "planning", "plan-ready", "approved", "handoff", "picked-up", "step-done", "reporting", "report-ready", "review", "accepted"].every((k, i, a) => ev.indexOf(k) >= 0 && (i === 0 || ev.indexOf(k) >= ev.indexOf(a[i - 1]))), ev);

// ── E. failure cascade ────────────────────────────────────────────────────────
planReply = JSON.stringify({ rationale: "r", steps: [{ title: "Fetch", seat: "c1", brief: "fetch" }, { title: "Summarise", seat: "c1", brief: "sum", dependsOn: [0] }, { title: "Side", seat: "c2", brief: "side" }] });
const m2 = await rt.createMission(brief({ name: "Fails", endAction: "deliver" }));
await until(() => rt.loadMission(m2.id)?.plan);
const before2 = launched.length;
await rt.missionAction(m2.id, "approve");
await until(() => launched.length === before2 + 2);
launched[before2].child.finish(1, "boom");
launched[before2 + 1].child.finish(0, "side result");
await until(() => rt.loadMission(m2.id).stage === "delivered");
let x2 = rt.loadMission(m2.id);
check("E1 failed step recorded with its exit code", x2.plan.steps[0].status === "failed" && /code 1/.test(x2.plan.steps[0].error));
check("E2 its dependant is never started", x2.plan.steps[1].status === "stopped" && launched.length === before2 + 2);
check("E3 end action 'deliver' skips review", x2.stage === "delivered");
check("E4 the report prompt names what did not finish", prompts.at(-1).includes("Steps that did not finish") && prompts.at(-1).includes("Summarise"));

// ── F. STOP ───────────────────────────────────────────────────────────────────
planReply = JSON.stringify({ rationale: "r", steps: [{ title: "Long", seat: "c1", brief: "long" }] });
const m3 = await rt.createMission(brief({ name: "Stop me" }));
await until(() => rt.loadMission(m3.id)?.plan);
await rt.missionAction(m3.id, "approve");
await until(() => rt.loadMission(m3.id).plan.steps[0].status === "running");
const pid3 = launched.at(-1).child.pid;
const x3 = await rt.missionAction(m3.id, "stop");
check("F1 STOP kills the running seat", killed.includes(pid3));
check("F2 mission stopped, step stopped by you", x3.stage === "stopped" && x3.plan.steps[0].status === "stopped" && x3.plan.steps[0].error === "stopped by you");
launched.at(-1).child.finish(null, "");
await tick();
check("F3 a late exit does not resurrect it", rt.loadMission(m3.id).stage === "stopped");

// ── G. time limit ─────────────────────────────────────────────────────────────
planReply = JSON.stringify({ rationale: "r", steps: [{ title: "Quick", seat: "c1", brief: "q" }, { title: "Slow", seat: "c2", brief: "s" }] });
const m4 = await rt.createMission(brief({ name: "Timeout" }));
await until(() => rt.loadMission(m4.id)?.plan);
const before4 = launched.length;
await rt.missionAction(m4.id, "approve");
await until(() => launched.length === before4 + 2);
launched[before4].child.finish(0, "quick answer");
await tick();
await rt.__timeUpForTests(m4.id);
await until(() => rt.loadMission(m4.id).stage === "review");
const x4 = rt.loadMission(m4.id);
check("G1 time limit kills the running seat", killed.includes(launched[before4 + 1].child.pid) && x4.plan.steps[1].error === "stopped at the time limit");
check("G2 and reports with what finished", x4.stage === "review" && rt.readEvents(m4.id).some((e) => e.kind === "timeout"));

// ── H. restart recovery ───────────────────────────────────────────────────────
planReply = JSON.stringify({ rationale: "r", steps: [{ title: "Ghost", seat: "c1", brief: "g" }] });
const m5 = await rt.createMission(brief({ name: "Restart" }));
await until(() => rt.loadMission(m5.id)?.plan);
await rt.missionAction(m5.id, "approve");
await until(() => rt.loadMission(m5.id).plan.steps[0].status === "running");
rt.__setMissionDriversForTests(drivers); // a "restart": every live child and timer is forgotten
rt.recoverAfterRestart();
await until(() => rt.loadMission(m5.id).stage !== "in-progress");
const x5 = rt.loadMission(m5.id);
check("H1 a step with no live process is marked lost, not running", x5.plan.steps[0].status === "failed" && /server restarted/.test(x5.plan.steps[0].error));
check("H2 the timeline says so", rt.readEvents(m5.id).some((e) => e.kind === "recovered"));
check("H3 with nothing finished the mission failed honestly", x5.stage === "failed");

// ── I. send back ──────────────────────────────────────────────────────────────
planReply = JSON.stringify({ rationale: "r2", steps: [{ title: "Redo", seat: "c1", brief: "redo" }] });
check("I1 send back needs a note", await throwsWith(() => rt.missionAction(m4.id, "send-back", ""), /note is required/));
await rt.missionAction(m4.id, "send-back", "Include enterprise tiers.");
await until(() => rt.loadMission(m4.id)?.plan && !rt.loadMission(m4.id).working);
const x4b = rt.loadMission(m4.id);
check("I2 sent back to briefing and re-planned", x4b.stage === "briefing" && x4b.plan.steps[0].title === "Redo");
check("I3 the new plan saw the note and the last report", prompts.filter((p) => p.startsWith("You are Jarvis, planning")).at(-1).includes("Include enterprise tiers.") && prompts.filter((p) => p.startsWith("You are Jarvis, planning")).at(-1).includes("previous run's report"));

// ── J. per-CLI flags ──────────────────────────────────────────────────────────
const claudeLaunch = launched.find((l) => l.agent === "claude");
const hermesLaunch = launched.find((l) => l.agent === "hermes");
check("J1 claude: -p, model, max 50 turns, no shell tool, prompt on stdin", claudeLaunch.args.join(" ").includes("--max-turns 50") && claudeLaunch.args.includes("claude-test-model") && !claudeLaunch.args.join(",").includes("Bash") && claudeLaunch.args.includes("Read,Write,Edit,Glob,Grep,WebSearch,WebFetch") && claudeLaunch.input.length > 0);
check("J2 hermes: chat, max 50 turns", hermesLaunch.args[0] === "chat" && hermesLaunch.args.join(" ").includes("--max-turns 50"));
planReply = JSON.stringify({ rationale: "r", steps: [{ title: "Codex", seat: "c1", brief: "c" }] });
const m6 = await rt.createMission(brief({ name: "Codex", teamMode: "manual", seats: [{ agent: "codex", role: "coder" }] }));
await until(() => rt.loadMission(m6.id)?.plan);
await rt.missionAction(m6.id, "approve");
await until(() => launched.at(-1).agent === "codex");
const cx = launched.at(-1);
check("J3 codex: exec in its scratch dir, no turn flag, prompt on stdin", cx.args[0] === "exec" && cx.args.includes(cx.cwd) && !cx.args.includes("--max-turns") && cx.args.at(-1) === "-");
check("J4 the hand-off says codex has no turn cap", rt.readEvents(m6.id).some((e) => e.kind === "handoff" && /no turn cap/.test(e.text)));
await rt.missionAction(m6.id, "stop");

// ── K. stats ──────────────────────────────────────────────────────────────────
const st = rt.missionStats(rt.listMissions());
check("K1 waiting on you = plans to approve + results to review", st.waitingOnYou === rt.listMissions().filter((m) => (m.stage === "briefing" && m.plan && !m.working) || m.stage === "review").length && st.waitingOnYou >= 1);
check("K2 cycle time measured from delivered missions", typeof st.cycleTimeMin === "number");
check("K3 on-time % counts only missions with a target date", st.onTimeOf === 1 && st.onTimePct === 100);
check("K4 agents at work = running steps", st.agentsAtWork === rt.listMissions().reduce((n, m) => n + (m.plan?.steps.filter((s) => s.status === "running").length ?? 0), 0));

// ── L. routes ─────────────────────────────────────────────────────────────────
const list = await import("../../src/app/api/v2/missions/route.ts");
const one = await import("../../src/app/api/v2/missions/[id]/route.ts");
let res = await list.GET();
let j = await res.json();
check("L1 GET list: missions, stats, crew", res.status === 200 && Array.isArray(j.missions) && j.stats && j.crew.find((c) => c.agent === "codex")?.turnCapped === false);
res = await list.POST(new Request("http://x", { method: "POST", body: JSON.stringify({ name: "" }) }));
check("L2 POST with a bad brief is 400", res.status === 400);
const params = (id) => ({ params: Promise.resolve({ id }) });
res = await one.GET(new Request(`http://x/api/v2/missions/${m1.id}`), params(m1.id));
j = await res.json();
check("L3 GET one: mission + timeline", res.status === 200 && j.mission.id === m1.id && j.events.length > 5);
res = await one.GET(new Request(`http://x/api/v2/missions/${m1.id}?step=s1`), params(m1.id));
check("L4 GET a step's answer", (await res.json()).text.includes("A costs $10/mo"));
res = await one.GET(new Request("http://x/api/v2/missions/..%2F..%2Fetc"), params("../../etc"));
check("L5 a path-walking id is refused", res.status === 400);
res = await one.GET(new Request(`http://x/api/v2/missions/${m1.id}?step=../../x`), params(m1.id));
check("L6 a path-walking step is refused", res.status === 400);
res = await one.POST(new Request("http://x", { method: "POST", body: JSON.stringify({ action: "explode" }) }), params(m1.id));
check("L7 unknown action is 400", res.status === 400);

// ── M. UI ─────────────────────────────────────────────────────────────────────
const hub = fs.readFileSync("src/components/jarvis/JarvisHub.tsx", "utf8");
const ui = fs.readFileSync("src/components/jarvis/MissionsTab.tsx", "utf8");
check("M1 Missions tab registered in Jarvis", /key: "goals", label: "Missions"[^\n]*<MissionsTab \/>/.test(hub));
check("M2 the timeline heading and the brief each seat was sent", ui.includes("What happened, in order") && ui.includes("The brief it was sent"));
check("M3 a running step shows LIVE and last heard from its output", ui.includes("LIVE") && ui.includes("Last heard {ago(s.lastHeardAt ?? s.startedAt, now)}"));
check("M4 the desk offers approve, send back, accept and stop", ["\"approve\"", "\"send-back\"", "\"accept\"", "\"stop\""].every((a) => ui.includes(`act(${a})`)));
check("M5 stats come from the API, not the page", ui.includes("stats.waitingOnYou") && ui.includes("stats.cycleTimeMin") && !/Math\.random/.test(ui));
check("M6 the wizard says nothing runs before approval", ui.includes("nothing runs until you approve the plan"));
check("M7 polling pauses while the tab is hidden", ui.includes("document.hidden"));
// S23 board
check("M8 Desk / Board views, remembered per browser", ui.includes('localStorage.getItem("agentos.missions.view")') && ui.includes('view === "board"'));
check("M9 waiting-on-you includes the agents' approval queue, answerable in place", ui.includes('api<{ approvals: Approval[] }>("/api/agents/approvals")') && ui.includes('decide(a, { decision: "allow" })') && ui.includes('decide(a, { answer: reply[a.id] })'));
check("M10 the ring has four states with real counts, and says what blocked means", ["In flight", "Review", "Blocked", "Delivered"].every((l) => ui.includes(`label: "${l}"`)) && ui.includes("failed, stopped, or a plan that could not be made"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
