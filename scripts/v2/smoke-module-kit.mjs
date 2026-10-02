// S14 per-module Skills & Workflows smoke (_design/jarvis-v3-plan.md), offline.
//   A. the registry's readsSkills claim matches the code (source scan)
//   B. URL -> module resolution (Jarvis tabs are their own modules)
//   C. workflows store: seeds, create, validation, fill, activation, retire/restore,
//      a corrupt file is an error (never silently replaced)
//   D. skills: create in a temp dir, refuse overwrite, module-only block
//   E. module kit: toggles change exactly one list; unknown names are 404s
//   F. routes: /api/skills, /api/modules/kit, /api/workflows(+/:id, /:id/run guards)
//   G. wiring: cliComplete applies module skills; Jarvis reads its own; the pop-up
//      is mounted on every page; Jarvis's module_kit tool is gated
// No CLI is ever spawned: the run route's success path needs a real agent and is
// left to the owner's live check; its guards are tested here.
// Run: npx tsx scripts/v2/smoke-module-kit.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-modkit-"));
process.env.AGENTIC_OS_SETTINGS = path.join(tmp, "settings.json");
process.env.AGENTIC_OS_DB = path.join(tmp, "test.db");
process.env.AGENTIC_OS_SKILLS_DIR = path.join(tmp, "skills");
process.env.AGENTIC_OS_WORKFLOWS_DIR = path.join(tmp, "workflows");
process.env.AGENTIC_OS_WEBMCP_DIR = path.join(tmp, "webmcp");
process.env.AGENTIC_OS_AGENTMAIL_DIR = path.join(tmp, "agentmail");
process.env.AGENTIC_OS_NEWSLETTER_DIR = path.join(tmp, "newsletter");
process.env.AGENTOS_MOCK_LLM = "1";
fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, JSON.stringify({ memory: { ingestEnabled: false } }), "utf8");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || extra === undefined ? "" : `  [${String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 260)}]`}`);
  if (!cond) failures++;
};
const read = (f) => fs.readFileSync(f, "utf8");

const reg = await import("../../src/lib/moduleRegistry.ts");
const wfs = await import("../../src/lib/workflows.ts");
const ps = await import("../../src/lib/platformSkills.ts");
const kitLib = await import("../../src/lib/moduleKit.ts");
const { readSettings } = await import("../../src/lib/settings.ts");

// ── A. registry honesty: a module is "wired" iff code passes its key to skills ──
{
  const keys = new Set();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.tsx?$/.test(e.name)) continue;
      // Code only: a withSkills(...) inside a comment is documentation, not wiring
      // (browser/skillSeed.ts describes one it never makes).
      const src = read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const moduleConst = src.match(/const MODULE = "([a-z-]+)"/)?.[1];
      for (const m of src.matchAll(/withSkills\(/g)) {
        const seg = src.slice(m.index, m.index + 400);
        const lit = seg.match(/withSkills\([\s\S]*?,\s*"([a-z-]+)"/);
        if (lit) keys.add(lit[1]);
        else if (moduleConst && /withSkills\([\s\S]*?,\s*MODULE\b/.test(seg)) keys.add(moduleConst);
      }
      for (const m of src.matchAll(/cliComplete\(/g)) {
        const seg = src.slice(m.index, src.indexOf(");", m.index) + 2);
        const lit = seg.match(/module: "([a-z-]+)"/);
        if (lit) keys.add(lit[1]);
      }
      for (const m of src.matchAll(/moduleSkillBlock\("([a-z-]+)"/g)) keys.add(m[1]);
    }
  };
  walk("src");
  keys.delete("x"); // doc examples
  const wired = new Set(reg.SKILL_WIRED);
  const claimedNotInCode = [...wired].filter((k) => !keys.has(k));
  const inCodeNotClaimed = [...keys].filter((k) => !wired.has(k) && reg.getModule(k));
  check("every module marked readsSkills passes its key to a skills call in code", claimedNotInCode.length === 0, claimedNotInCode);
  check("no module reads skills in code without being marked", inCodeNotClaimed.length === 0, inCodeNotClaimed);
  check("every wired key is a real module", [...wired].every((k) => reg.getModule(k)), [...wired].filter((k) => !reg.getModule(k)));
  check("browser is NOT marked (it only mentions withSkills in a comment)", !wired.has("browser"));
}

// ── B. URL -> module ────────────────────────────────────────────────────────────
check("/ is Mission Control", reg.moduleForPath("/")?.id === "mission-control");
check("/deals is Deal Desk", reg.moduleForPath("/deals")?.id === "deals");
check("/deals/anything still Deal Desk", reg.moduleForPath("/deals/x")?.id === "deals");
check("/jarvis is Jarvis", reg.moduleForPath("/jarvis")?.id === "jarvis");
check("/jarvis?tab=oracle is the Oracle", reg.moduleForPath("/jarvis", "?tab=oracle")?.id === "oracle");
check("/jarvis?tab=radar is News Radar", reg.moduleForPath("/jarvis", "?tab=radar")?.id === "news-radar");
check("/jarvis?tab=sessions stays Jarvis", reg.moduleForPath("/jarvis", "?tab=sessions")?.id === "jarvis");
check("unknown route resolves to nothing (no pop-up)", reg.moduleForPath("/nope") === null);
check("the sidebar's modules are all registered", ["room", "deals", "hire", "marketing", "content-engine", "agent-kanban", "tasks", "memory", "terminal"].every((id) => reg.getModule(id)));

// ── C. workflows store ──────────────────────────────────────────────────────────
check("fresh store shows the three starters", wfs.listWorkflows().map((w) => w.id).join() === "summarize,draft-reply,research-brief");
check("starters are not written to disk until something changes", !fs.existsSync(path.join(process.env.AGENTIC_OS_WORKFLOWS_DIR, "workflows.json")));
const w1 = wfs.createWorkflow({ name: "Plan the day", prompt: "Plan my day around {{input}}", inputLabel: "Meetings", agent: "claude" });
check("create returns a slug id", w1.id === "plan-the-day");
check("create persists (and the starters with it)", wfs.listWorkflows().length === 4 && fs.existsSync(path.join(process.env.AGENTIC_OS_WORKFLOWS_DIR, "workflows.json")));
check("a duplicate name gets a numbered id", wfs.createWorkflow({ name: "Plan the day", prompt: "again" }).id === "plan-the-day-2");
const bad = (fn) => { try { fn(); return null; } catch (e) { return e; } };
check("missing prompt is a 400 WorkflowError", bad(() => wfs.createWorkflow({ name: "x" }))?.status === 400);
check("an agent id with spaces is refused", /agent must be/.test(bad(() => wfs.createWorkflow({ name: "y", prompt: "p", agent: "rm -rf" }))?.message ?? ""));
check("fill replaces {{input}}", wfs.fillPrompt(w1, "standup at 9") === "Plan my day around standup at 9");
check("fill refuses a required input that is empty", /needs: Meetings/.test(bad(() => wfs.fillPrompt(w1, "  "))?.message ?? ""));
check("fill appends input when the template has no placeholder", wfs.fillPrompt({ ...w1, prompt: "Go", inputLabel: undefined }, "extra").endsWith("Input:\nextra"));
wfs.setWorkflowActive("summarize", "deals", true);
wfs.setWorkflowActive("draft-reply", "*", true);
check("activation per module and everywhere", JSON.stringify(wfs.activeWorkflowIds("deals")) === JSON.stringify({ here: ["summarize"], global: ["draft-reply"] }));
check("another module is untouched", wfs.activeWorkflowIds("hire").here.length === 0);
wfs.setWorkflowActive("summarize", "deals", false);
check("switching off empties and drops the module entry", !("deals" in wfs.workflowActivation().modules));
wfs.setWorkflowActive("plan-the-day", "hire", true);
wfs.retireWorkflow("plan-the-day");
check("retire moves it out of the live list", !wfs.getWorkflow("plan-the-day") && wfs.listRetiredWorkflows().some((w) => w.id === "plan-the-day"));
check("retire clears its activations", !wfs.workflowActivation().modules.hire);
check("restore brings it back", wfs.restoreWorkflow("plan-the-day").id === "plan-the-day" && !!wfs.getWorkflow("plan-the-day"));
check("unknown workflow is a 404", bad(() => wfs.updateWorkflow("nope", { name: "z" }))?.status === 404);
{
  const f = path.join(process.env.AGENTIC_OS_WORKFLOWS_DIR, "workflows.json");
  const good = read(f);
  fs.writeFileSync(f, "{ not json");
  check("a corrupt workflows.json is an error, not an empty store", /unreadable/.test(bad(() => wfs.listWorkflows())?.message ?? ""));
  check("...and it is not overwritten by a failed read", read(f) === "{ not json");
  fs.writeFileSync(f, good);
}

// ── D. skills ──────────────────────────────────────────────────────────────────
check("SKILLS_DIR honours the smoke redirect", ps.SKILLS_DIR === process.env.AGENTIC_OS_SKILLS_DIR);
const sk = ps.createSkill({ name: "brand-voice", description: "Write like the owner", body: "Plain words. No em dashes." });
check("create writes SKILL.md with frontmatter", sk.name === "brand-voice" && read(path.join(ps.SKILLS_DIR, "brand-voice", "SKILL.md")).startsWith("---\nname: brand-voice\ndescription: Write like the owner\n---\n\nPlain words."));
check("listInstalledSkills sees it", ps.listInstalledSkills().some((s) => s.name === "brand-voice" && s.description === "Write like the owner"));
check("create refuses to overwrite (409)", bad(() => ps.createSkill({ name: "brand-voice", description: "d", body: "b" }))?.status === 409);
check("a bad name is a 400", bad(() => ps.createSkill({ name: "Brand Voice", description: "d", body: "b" }))?.status === 400);
check("a description newline cannot break the frontmatter", ps.createSkill({ name: "two-lines", description: "a\nname: evil", body: "b" }).description === "a name: evil");
ps.createSkill({ name: "deal-closer", description: "Close deals", body: "Ask for the next step." });

// ── E. module kit ──────────────────────────────────────────────────────────────
const before = JSON.stringify(readSettings().skills.modules.hire ?? []);
let kit = kitLib.setKitItem({ module: "deals", kind: "skill", name: "deal-closer", active: true });
check("switching a skill on for deals lands in settings.skills.modules.deals", readSettings().skills.modules.deals.includes("deal-closer"));
check("...and reports it activeHere", kit.skills.find((s) => s.name === "deal-closer")?.activeHere === true);
check("...without touching another module's list", JSON.stringify(readSettings().skills.modules.hire ?? []) === before);
kit = kitLib.setKitItem({ module: "deals", kind: "skill", name: "brand-voice", active: true, scope: "global" });
check("global scope writes settings.skills.global", readSettings().skills.global.includes("brand-voice") && kit.skills.find((s) => s.name === "brand-voice")?.activeGlobal === true);
kitLib.setKitItem({ module: "deals", kind: "skill", name: "deal-closer", active: false });
check("switching off removes only that name", !readSettings().skills.modules.deals.includes("deal-closer"));
check("an uninstalled skill is a 404", bad(() => kitLib.setKitItem({ module: "deals", kind: "skill", name: "ghost", active: true }))?.status === 404);
check("an unknown module is a 404", bad(() => kitLib.getModuleKit("nowhere"))?.status === 404);
kit = kitLib.setKitItem({ module: "oracle", kind: "workflow", name: "research-brief", active: true });
check("workflow toggles go through the same door", kit.workflows.find((w) => w.id === "research-brief")?.activeHere === true);
check("the kit reports whether the module reads skills", kitLib.getModuleKit("deals").module.readsSkills === true && kitLib.getModuleKit("terminal").module.readsSkills === false);
kitLib.setKitItem({ module: "jarvis", kind: "skill", name: "deal-closer", active: true });
const block = ps.moduleSkillBlock("jarvis");
check("moduleSkillBlock carries only the module's own skills, with bodies", block.includes("Ask for the next step.") && !block.includes("Plain words.") && block.startsWith('<module_skills module="jarvis">'));
check("moduleSkillBlock is empty for a module with none", ps.moduleSkillBlock("terminal") === "");

// ── F. routes ──────────────────────────────────────────────────────────────────
const skillsRoute = await import("../../src/app/api/skills/route.ts");
const kitRoute = await import("../../src/app/api/modules/kit/route.ts");
const wfRoute = await import("../../src/app/api/workflows/route.ts");
const wfIdRoute = await import("../../src/app/api/workflows/[id]/route.ts");
const runRoute = await import("../../src/app/api/workflows/[id]/run/route.ts");
const J = (url, method = "GET", body) => new Request(`http://x${url}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id) => ({ params: Promise.resolve({ id }) });
let r = await skillsRoute.GET();
let j = await r.json();
check("GET /api/skills -> { installed, active } (the launch drawer's contract)", Array.isArray(j.installed) && j.installed.length >= 3 && Array.isArray(j.active.global));
r = await skillsRoute.POST(J("/api/skills", "POST", { name: "from-route", description: "d", body: "b" }));
check("POST /api/skills creates (201)", r.status === 201);
r = await skillsRoute.POST(J("/api/skills", "POST", { name: "from-route", description: "d", body: "b" }));
check("POST /api/skills again is 409", r.status === 409);
r = await kitRoute.GET(J("/api/modules/kit"));
check("GET kit without module is 400", r.status === 400);
r = await kitRoute.GET(J("/api/modules/kit?module=hire"));
j = await r.json();
check("GET kit for hire lists skills and workflows", r.status === 200 && j.module.id === "hire" && j.skills.length > 0 && j.workflows.length > 0);
r = await kitRoute.POST(J("/api/modules/kit", "POST", { module: "hire", kind: "workflow", name: "summarize", active: true }));
j = await r.json();
check("POST kit toggles and returns the refreshed kit", r.status === 200 && j.workflows.find((w) => w.id === "summarize").activeHere === true);
r = await kitRoute.POST(J("/api/modules/kit", "POST", { module: "hire", kind: "bogus", name: "summarize", active: true }));
check("POST kit with a bad kind is 400", r.status === 400);
r = await wfRoute.POST(J("/api/workflows", "POST", { name: "Route made", prompt: "Say {{input}}", inputLabel: "What" }));
j = await r.json();
check("POST /api/workflows creates (201)", r.status === 201 && j.workflow.id === "route-made");
r = await wfIdRoute.DELETE(J("/api/workflows/route-made", "DELETE"), ctx("route-made"));
check("DELETE retires, never destroys", r.status === 200 && wfs.listRetiredWorkflows().some((w) => w.id === "route-made"));
r = await wfIdRoute.PATCH(J("/api/workflows/route-made", "PATCH", { restore: true }), ctx("route-made"));
check("PATCH {restore:true} brings it back", r.status === 200 && !!wfs.getWorkflow("route-made"));
r = await runRoute.POST(J("/api/workflows/nope/run", "POST", {}), ctx("nope"));
check("run of an unknown workflow is 404", r.status === 404);
r = await runRoute.POST(J("/api/workflows/route-made/run", "POST", { module: "nowhere" }), ctx("route-made"));
check("run with an unknown module is 400", r.status === 400);
r = await runRoute.POST(J("/api/workflows/route-made/run", "POST", { module: "deals", input: "" }), ctx("route-made"));
j = await r.json();
check("run refuses a workflow whose required input is missing (400, names it)", r.status === 400 && /needs: What/.test(j.error));

// ── G. wiring ──────────────────────────────────────────────────────────────────
const loop = read("src/lib/loopEngine.ts");
check("cliComplete applies module skills when given a module (never incognito)", loop.includes("let text = opts?.module && !incog ? withSkills(prompt, opts.module) : prompt;"));
check("the orchestration prefix wraps the skill-wrapped text, not the raw prompt", loop.includes("${ORCHESTRATION_DIRECTIVE}") && /---\\n\\n\$\{text\}`/.test(loop));
check("Jarvis's stable prompt includes its own module skills", read("src/lib/v2/jarvis/context.ts").includes('moduleSkillBlock("jarvis", 12_000)'));
check("the Oracle's prompt is skill-wrapped and arg-capped", read("src/lib/oracle.ts").includes('withSkills(sagePrompt(question), "oracle", SKILL_ARG_SAFE_CHARS)'));
check("the pop-up is mounted in the TopBar (every page)", /<ModuleKit \/>\s*<CommandPalette \/>/.test(read("src/components/TopBar.tsx")));
const ui = read("src/components/ModuleKit.tsx");
check("toggles are real switches for assistive tech", ui.includes('role="switch"') && ui.includes("aria-checked={on}"));
check("a module that does not read skills says so", ui.includes("do not read skills yet"));
check("the pop-up resolves Jarvis tabs from the URL", ui.includes("window.location.search") && ui.includes("moduleForPath("));
const tools = read("src/lib/v2/jarvis/tools.ts");
check("Jarvis has a module_kit tool", tools.includes("module_kit: {") && tools.includes('action: z.enum(["list", "set", "run"])'));
check("module_kit writes and runs sit behind the taint gate; list does not", /if \(a\.action === "list"\)[\s\S]*?const refused = gateTaint\("module_kit"\)/.test(tools));
check("the old stale 'cliComplete global wrap' claim is corrected", !/prompt reaches cliComplete's global wrap/.test(read("src/lib/platformSkills.ts")));

console.log(failures ? `smoke-module-kit: ${failures} FAILURES` : "smoke-module-kit: all checks passed");
process.exit(failures ? 1 : 0);
