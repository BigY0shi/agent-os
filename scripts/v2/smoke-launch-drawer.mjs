// Pre-launch drawer contract (roadmap S3), fully offline.
//
// Run: npx tsx scripts/v2/smoke-launch-drawer.mjs
//
// Covers lib/launchOptions.ts (module declarations, defaults, STRICT parse:
// unknown fields are errors, resolve order body > settings > defaults), the
// settings.launch.<module> store (rule 16), the guardrail helpers the routes
// honour (timeout, instructions, no-external-scripts reviewer), and that all
// four routes (Content Engine generate/plan, Agent Kanban plan/build) validate
// the launch object BEFORE any model call and without registering a run.
//
// Rule 19: AGENTIC_OS_SETTINGS and AGENTIC_OS_RUNS_DIR are redirected before
// any import. No route here is ever called with a VALID launch: a valid one
// would reach a model (or Ollama on 127.0.0.1) and this gate is offline.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-launch-"));
process.env.AGENTIC_OS_RUNS_DIR = dir;
process.env.AGENTIC_OS_SETTINGS = path.join(dir, "settings.json");
fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, JSON.stringify({
  memory: { ingestEnabled: false },
  launch: { "content-engine": { agent: "codex", skills: ["better-agent"], guardrails: { timeoutMin: 7, noFallback: true }, instructions: "short posts" } },
}), "utf8");
const realSettings = path.join(os.homedir(), ".agentic-os", "settings.json");
const realMtime = fs.existsSync(realSettings) ? fs.statSync(realSettings).mtimeMs : null;

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !extra ? "" : `  [${extra}]`}`);
  if (!cond) failures++;
};
const src = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

const L = await import("../../src/lib/launchOptions.ts");
const S = await import("../../src/lib/settings.ts");
const O = await import("../../src/lib/localOllama.ts");
const M = await import("../../src/lib/moduleRuns.ts");

// ---- A. declarations + defaults --------------------------------------------------
console.log("-- A: shape --");
check("two launch modules: content-engine, agent-kanban", L.LAUNCH_MODULES.join(",") === "content-engine,agent-kanban");
for (const m of L.LAUNCH_MODULES) {
  const def = L.LAUNCH_MODULE_DEFS[m];
  const d = L.defaultLaunchOptions(m);
  check(`${m}: seats declared, first is the default`, def.seats.length >= 2 && d.agent === def.seats[0].id);
  check(`${m}: every guardrail has kind + default and is in the defaults`, def.guardrails.length >= 1 && def.guardrails.every((g) => (g.kind === "number" || g.kind === "boolean") && g.default !== undefined && d.guardrails[g.key] === g.default));
  check(`${m}: defaults carry no skills and empty instructions`, Array.isArray(d.skills) && d.skills.length === 0 && d.instructions === "");
  check(`${m}: declares timeoutMin (every route honours it)`, def.guardrails.some((g) => g.key === "timeoutMin" && g.kind === "number"));
}
check("content-engine seats: rotation + claude + codex + kimi", L.LAUNCH_MODULE_DEFS["content-engine"].seats.map((s) => s.id).join(",") === "rotation,claude,codex,kimi");
check("content-engine guardrail noFallback is boolean", L.LAUNCH_MODULE_DEFS["content-engine"].guardrails.some((g) => g.key === "noFallback" && g.kind === "boolean"));
check("agent-kanban seats: local first, then the CLI agents", L.LAUNCH_MODULE_DEFS["agent-kanban"].seats[0].id === "local" && L.LAUNCH_MODULE_DEFS["agent-kanban"].seats.some((s) => s.id === "hermes"));
check("agent-kanban guardrails: maxCards (1..6) + noExternalScripts", L.LAUNCH_MODULE_DEFS["agent-kanban"].guardrails.some((g) => g.key === "maxCards" && g.min === 1 && g.max === 6) && L.LAUNCH_MODULE_DEFS["agent-kanban"].guardrails.some((g) => g.key === "noExternalScripts" && g.kind === "boolean"));

// ---- B. strict parse -------------------------------------------------------------
console.log("-- B: parse --");
const ok = L.parseLaunchOptions("content-engine", { agent: "kimi", skills: ["better-agent", "better-agent"], guardrails: { timeoutMin: 3, noFallback: true }, instructions: "  be terse  " });
check("a valid object parses, skills deduped, instructions trimmed", ok.ok && ok.value.agent === "kimi" && ok.value.skills.length === 1 && ok.value.guardrails.timeoutMin === 3 && ok.value.guardrails.noFallback === true && ok.value.instructions === "be terse", JSON.stringify(ok));
const partial = L.parseLaunchOptions("agent-kanban", { agent: "codex" });
check("a partial object fills the rest from defaults", partial.ok && partial.value.guardrails.maxCards === 5 && partial.value.guardrails.timeoutMin === 4 && partial.value.skills.length === 0);
const bad = (m, raw, re) => { const r = L.parseLaunchOptions(m, raw); return !r.ok && re.test(r.error) ? true : JSON.stringify(r); };
check("unknown top-level field is REJECTED by name", bad("content-engine", { agent: "claude", maxSteps: 3 }, /unknown launch option "maxSteps"/) === true, String(bad("content-engine", { agent: "claude", maxSteps: 3 }, /x/)));
check("unknown guardrail is REJECTED by name", bad("content-engine", { guardrails: { noNetwork: true } }, /unknown guardrail "noNetwork"/) === true);
check("a guardrail another module declares is still unknown here", bad("content-engine", { guardrails: { maxCards: 3 } }, /unknown guardrail "maxCards"/) === true);
check("wrong type for a number guardrail", bad("agent-kanban", { guardrails: { timeoutMin: "5" } }, /must be a number/) === true);
check("wrong type for a boolean guardrail", bad("agent-kanban", { guardrails: { noExternalScripts: "yes" } }, /must be true or false/) === true);
check("out-of-range number", bad("agent-kanban", { guardrails: { maxCards: 9 } }, /between 1 and 6/) === true);
check("a seat the module does not have", bad("content-engine", { agent: "gemini" }, /not a seat/) === true);
check("a seat from the OTHER module is refused", bad("content-engine", { agent: "local" }, /not a seat/) === true);
check("a skill name that is not a name", bad("agent-kanban", { skills: ["../etc"] }, /not a skill name/) === true);
check("too many skills", bad("agent-kanban", { skills: Array.from({ length: 9 }, (_, i) => `s${i}`) }, /at most 8/) === true);
check("instructions over the cap", bad("agent-kanban", { instructions: "x".repeat(L.MAX_INSTRUCTIONS_CHARS + 1) }, /at most/) === true);
check("non-object launch is rejected", bad("agent-kanban", "codex", /must be an object/) === true && bad("agent-kanban", [1], /must be an object/) === true);
check("unknown module is rejected", (() => { const r = L.parseLaunchOptions("deals", { agent: "claude" }); return !r.ok && /unknown launch module/.test(r.error); })());

// ---- C. resolve order: body > settings > defaults ---------------------------------
console.log("-- C: resolve --");
const stored = { agent: "codex", guardrails: { timeoutMin: 7 } };
const r1 = L.resolveLaunchOptions("content-engine", { agent: "kimi" }, stored);
check("body wins when present", r1.ok && r1.source === "body" && r1.value.agent === "kimi" && r1.value.guardrails.timeoutMin === 5);
const r2 = L.resolveLaunchOptions("content-engine", { agent: "kimi", nope: 1 }, stored);
check("a bad body is an error even with good settings behind it", !r2.ok && /nope/.test(r2.error));
const r3 = L.resolveLaunchOptions("content-engine", undefined, stored);
check("settings apply when the body has no launch", r3.ok && r3.source === "settings" && r3.value.agent === "codex" && r3.value.guardrails.timeoutMin === 7);
const r4 = L.resolveLaunchOptions("content-engine", undefined, { agent: "codex", guardrails: { retired: true } });
check("a stale stored value falls back to defaults, and says so", r4.ok && r4.source === "defaults" && r4.value.agent === "rotation");
const r5 = L.resolveLaunchOptions("agent-kanban", undefined, undefined);
check("nothing stored -> defaults", r5.ok && r5.source === "defaults" && r5.value.agent === "local");

// ---- D. the settings store (rule 16) ---------------------------------------------
console.log("-- D: settings --");
check("DEFAULT_SETTINGS.launch has both modules at their defaults", S.DEFAULT_SETTINGS.launch?.["content-engine"]?.agent === "rotation" && S.DEFAULT_SETTINGS.launch?.["agent-kanban"]?.agent === "local");
const rs = S.readSettings();
check("readSettings merges the stored content-engine launch over the defaults", rs.launch["content-engine"].agent === "codex" && rs.launch["content-engine"].guardrails.timeoutMin === 7 && rs.launch["content-engine"].guardrails.noFallback === true && rs.launch["agent-kanban"].agent === "local", JSON.stringify(rs.launch));
const written = S.writeSettings({ launch: { "agent-kanban": { agent: "hermes", skills: ["a", "b"], guardrails: { timeoutMin: 2, maxCards: 3, noExternalScripts: true }, instructions: "" } } });
check("writeSettings round-trips a module's launch", written.launch["agent-kanban"].agent === "hermes" && written.launch["agent-kanban"].guardrails.maxCards === 3 && written.launch["content-engine"].agent === "codex");
const written2 = S.writeSettings({ launch: { "agent-kanban": { skills: ["c"] } } });
check("skills arrays are replaced wholesale, not merged", written2.launch["agent-kanban"].skills.join(",") === "c" && written2.launch["agent-kanban"].agent === "hermes");
check("the temp settings file holds it (not ~/.agentic-os)", JSON.parse(fs.readFileSync(process.env.AGENTIC_OS_SETTINGS, "utf8")).launch["agent-kanban"].agent === "hermes");

// ---- E. helpers the routes honour --------------------------------------------------
console.log("-- E: helpers --");
check("launchTimeoutMs: minutes -> ms, fallback when absent", L.launchTimeoutMs(ok.value) === 180_000 && L.launchTimeoutMs({ ...ok.value, guardrails: {} }, 99) === 99);
check("withInstructions appends the operator block, no-op when empty", /OPERATOR INSTRUCTIONS FOR THIS RUN[\s\S]*be terse$/.test(L.withInstructions("P", ok.value)) && L.withInstructions("P", L.defaultLaunchOptions("agent-kanban")) === "P");
const desc = L.describeLaunch("agent-kanban", { agent: "codex", skills: ["a", "b"], guardrails: { timeoutMin: 4, maxCards: 2, noExternalScripts: true }, instructions: "x" });
check("describeLaunch names the seat, skills, changed guardrails, instructions", /^codex · 2 skills · maxCards 2 · no external scripts · instructions$/.test(desc), desc);
check("describeLaunch of defaults is just the seat", L.describeLaunch("content-engine", L.defaultLaunchOptions("content-engine")) === "rotation");
const ext = ['<script src="https://cdn.x/a.js"></script>', "<script src='//cdn.x/a.js'>", '<link rel="stylesheet" href="https://f.com/a.css">', '<link href="https://f.com/a.css" rel="stylesheet">', '<style>@import url("https://fonts.googleapis.com/css");</style>'];
const inl = ['<script>alert(1)</script>', '<script src="data:text/javascript,1"></script>', '<link rel="icon" href="https://x/f.ico">', '<style>body{background:url(https://x/y.png)}</style>', '<a href="https://x">x</a>'];
check("hasExternalScripts flags remote script/stylesheet/@import", ext.every(O.hasExternalScripts));
check("hasExternalScripts leaves inline, data:, icons, images and links alone", inl.every((h) => !O.hasExternalScripts(h)));

// ---- F. routes validate BEFORE any model call, offline ------------------------------
console.log("-- F: routes --");
const post = async (mod, body) => {
  const res = await mod.POST(new Request("http://local/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { status: res.status, j: await res.json() };
};
const cePlan = await import("../../src/app/api/content-engine/plan/route.ts");
const ceGen = await import("../../src/app/api/content-engine/generate/route.ts");
const kbPlan = await import("../../src/app/api/agent-kanban/plan/route.ts");
const kbBuild = await import("../../src/app/api/agent-kanban/build/route.ts");
let r;
r = await post(cePlan, { goals: "grow", channels: ["x"], launch: { agent: "claude", bogus: 1 } });
check("content-engine/plan: unknown launch field -> 400 naming it", r.status === 400 && /launch: unknown launch option "bogus"/.test(r.j.error), JSON.stringify(r));
r = await post(cePlan, { goals: "grow", channels: ["x"], launch: { guardrails: { noNetwork: true } } });
check("content-engine/plan: unknown guardrail -> 400", r.status === 400 && /noNetwork/.test(r.j.error));
r = await post(ceGen, { id: "nope", launch: { agent: "kimi", guardrails: { timeoutMin: 99 } } });
check("content-engine/generate: out-of-range guardrail -> 400 before the item lookup", r.status === 400 && /between 1 and 15/.test(r.j.error), JSON.stringify(r));
r = await post(ceGen, { id: "nope", launch: { agent: "local" } });
check("content-engine/generate: a kanban seat is refused", r.status === 400 && /not a seat/.test(r.j.error));
r = await post(kbPlan, { goal: "toys", launch: { agent: "gemini" } });
check("agent-kanban/plan: unknown seat -> 400", r.status === 400 && /not a seat/.test(r.j.error), JSON.stringify(r));
r = await post(kbPlan, { goal: "toys", agent: "cli:gemini" });
check("agent-kanban/plan: legacy agent field still validated", r.status === 400 && /not wired/.test(r.j.error));
r = await post(kbPlan, { goal: "toys", launch: { guardrails: { maxCards: 9 } } });
check("agent-kanban/plan: maxCards out of range -> 400", r.status === 400 && /maxCards/.test(r.j.error));
r = await post(kbBuild, { id: "c1", title: "t", launch: { skills: ["Bad Name"] } });
check("agent-kanban/build: bad skill name -> 400", r.status === 400 && /not a skill name/.test(r.j.error ?? r.j.note), JSON.stringify(r));
r = await post(kbBuild, { id: "c1", title: "t", launch: { instructions: 5 } });
check("agent-kanban/build: instructions must be a string", r.status === 400 && /instructions/.test(r.j.error ?? r.j.note));
check("no rejected launch registered a run", M.listModuleRuns({ includeDismissed: true }).length === 0, String(M.listModuleRuns({ includeDismissed: true }).length));

// ---- G. wiring: the drawer and the routes honour what they declare -----------------
console.log("-- G: wiring --");
const gen = src("src/app/api/content-engine/generate/route.ts"), pln = src("src/app/api/content-engine/plan/route.ts");
const kp = src("src/app/api/agent-kanban/plan/route.ts"), kb = src("src/app/api/agent-kanban/build/route.ts");
check("generate honours seat, timeout, noFallback, skills, instructions", /seatForItem\(id\) : \(L\.agent/.test(gen) && /launchTimeoutMs\(L\)/.test(gen) && /noFallback: L\.guardrails\.noFallback === true/.test(gen) && /withSkills\(withInstructions\(/.test(gen) && /L\.skills\)/.test(gen));
check("plan honours seat, timeout, noFallback, skills, instructions", /L\.agent === "rotation" \? "claude"/.test(pln) && /launchTimeoutMs\(L, 300_000\)/.test(pln) && /noFallback: L\.guardrails\.noFallback === true/.test(pln) && /withSkills\(withInstructions\(/.test(pln));
check("kanban plan honours maxCards in the prompt AND the slice", /planSys\(maxCards\)/.test(kp) && /\.slice\(0, maxCards\)/.test(kp) && /launchTimeoutMs\(L, 180_000\)/.test(kp));
check("kanban build honours noExternalScripts in the brief AND the reviewer", /builderSys\(noExternal\)/.test(kb) && /noExternal && hasExternalScripts\(html!\)/.test(kb) && /verdict: "rejected"/.test(kb));
check("kanban routes inject run skills for the local seat too", /skillBlock\(MODULE, undefined, L\.skills\)/.test(kp) && /skillBlock\(MODULE, undefined, L\.skills\)/.test(kb));
check("every route resolves launch from body > settings", [gen, pln, kp, kb].every((t) => /resolveLaunchOptions\(MODULE, /.test(t) && /readSettings\(\)\.launch\?\.\[MODULE\]/.test(t)));
const drawer = src("src/components/RunLaunchDrawer.tsx");
check("RunLaunchDrawer renders the declared seats, guardrails, skills from /api/skills, instructions", /def\.seats\.map/.test(drawer) && /def\.guardrails\.map/.test(drawer) && /fetch\("\/api\/skills"/.test(drawer) && /MAX_INSTRUCTIONS_CHARS/.test(drawer));
check("RunLaunchDrawer persists to settings.launch.<module> on Launch, then hands the same object over", /save\(\{ launch: \{ \[module\]: opts \} \}/.test(drawer) && /await onLaunch\(opts\)/.test(drawer));
check("RunLaunchDrawer is locked while that module's run is in flight (prop OR /api/runs probe)", /const locked = busy \|\| !!inFlight \|\| launching/.test(drawer) && /<fieldset disabled=\{locked\}/.test(drawer) && /fetch\("\/api\/runs\?limit=40"/.test(drawer) && /x\.module === module && x\.status === "running"/.test(drawer));
check("RunLaunchDrawer offers no mid-run control: the in-flight state points at Stop in the tray", /Stop it from the runs tray/.test(drawer) && !/action: "stop"/.test(drawer));
const cev = src("src/components/ContentEngineView.tsx"), akb = src("src/components/AgentKanban.tsx");
check("Content Engine plan + generate open the drawer and send launch in the body", (cev.match(/<RunLaunchDrawer/g) || []).length === 2 && /perWeek, weeks, launch \}/.test(cev) && /id: item\.id, launch \}/.test(cev));
check("Agent Kanban plan + run open the drawer and send launch in the body", /<RunLaunchDrawer/.test(akb) && /goal: g, launch \}/.test(akb) && /goal, launch \}/.test(akb) && !/agent: builderAgent/.test(akb));
check("Agent Kanban halts the team loop when a build was stopped", /res\.stopped/.test(akb) && /break;/.test(akb));
check("Deal Desk is untouched (S4 owns it)", !/RunLaunchDrawer/.test(src("src/components/DealDesk.tsx")));
check("settings.ts declares launch in Settings and DEFAULT_SETTINGS", /launch: Partial<Record<LaunchModule, LaunchOptions>>;/.test(src("src/lib/settings.ts")) && /launch: \{ "content-engine": defaultLaunchOptions\("content-engine"\)/.test(src("src/lib/settings.ts")));
check("real ~/.agentic-os/settings.json untouched", realMtime === null || fs.statSync(realSettings).mtimeMs === realMtime);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
