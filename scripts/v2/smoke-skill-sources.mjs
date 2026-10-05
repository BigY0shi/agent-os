// Skill sources smoke, offline: the pop-up offers Agent OS, Claude Code and SkillDB
// skills (owner, 2026-09-28).
//   A. a smoke that redirects AGENTIC_OS_SKILLS_DIR gets NO extra sources by default,
//      so tests never read the owner's real libraries
//   B. three temp sources: listed with their source, sorted, first source wins a clash,
//      folders without SKILL.md and unsafe names are skipped
//   C. descriptions: plain, quoted, and YAML folded (`description: >`)
//   D. bodies resolve from any source and reach withSkills; toggling a SkillDB skill
//      through the module kit works; createSkill refuses a name another source holds
//   E. UI: source label, source filter, near-opaque panel
// Run: npx tsx scripts/v2/smoke-skill-sources.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-skillsrc-"));
process.env.AGENTIC_OS_SETTINGS = path.join(tmp, "settings.json");
process.env.AGENTIC_OS_DB = path.join(tmp, "test.db");
process.env.AGENTIC_OS_SKILLS_DIR = path.join(tmp, "agentos");
process.env.AGENTIC_OS_WORKFLOWS_DIR = path.join(tmp, "workflows");
process.env.AGENTIC_OS_AGENTMAIL_DIR = path.join(tmp, "agentmail");
process.env.AGENTIC_OS_NEWSLETTER_DIR = path.join(tmp, "newsletter");
fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, "{}", "utf8");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || extra === undefined ? "" : `  [${String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 260)}]`}`);
  if (!cond) failures++;
};
const skill = (dir, name, front, body = `Body of ${name}.`) => {
  fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.writeFileSync(path.join(dir, name, "SKILL.md"), `---\nname: ${name}\n${front}\n---\n\n${body}\n`, "utf8");
};

const ps = await import("../../src/lib/platformSkills.ts");

// ── A. smoke default ──────────────────────────────────────────────────────────
check("A1 redirected skills dir -> only the Agent OS source", ps.skillSources().map((s) => s.id).join(",") === "agentos");

// ── B. three sources ──────────────────────────────────────────────────────────
const A = process.env.AGENTIC_OS_SKILLS_DIR, C = path.join(tmp, "claude"), D = path.join(tmp, "skilldb");
process.env.AGENTIC_OS_CLAUDE_SKILLS_DIR = C;
process.env.AGENTIC_OS_SKILLDB_DIR = D;
skill(A, "brand-voice", "description: Agent OS copy of brand voice.");
skill(C, "brand-voice", "description: Claude copy, must lose the clash.");
skill(C, "zeta-helper", 'description: "Quoted description."');
skill(C, "Yoshi_UE_Skills", "description: A mixed-case folder name.");
skill(D, "academic-writing", "description: >\n  Folded description line one\n  and line two.\nlicense: MIT");
skill(D, "Content Creation", "description: |\n  Literal block.");
fs.mkdirSync(path.join(D, "not-a-skill"), { recursive: true });
fs.mkdirSync(path.join(D, "bad.name"), { recursive: true });
fs.writeFileSync(path.join(D, "bad.name", "SKILL.md"), "---\ndescription: x\n---\nx", "utf8");

check("B1 three sources in precedence order", ps.skillSources().map((s) => s.id).join(",") === "agentos,claude,skilldb");
const list = ps.listInstalledSkills();
const byName = Object.fromEntries(list.map((s) => [s.name, s]));
check("B2 every real skill listed once", list.length === 5, list.map((s) => `${s.source}:${s.name}`));
check("B3 a clash is won by the earlier source", byName["brand-voice"]?.source === "agentos" && byName["brand-voice"].description.startsWith("Agent OS"));
check("B4 source recorded per skill", byName["zeta-helper"]?.source === "claude" && byName["academic-writing"]?.source === "skilldb");
check("B5 mixed-case and spaced folder names are allowed", !!byName["Yoshi_UE_Skills"] && !!byName["Content Creation"]);
check("B6 folder without SKILL.md skipped", !byName["not-a-skill"]);
check("B7 dotted name skipped", !byName["bad.name"]);
check("B8 path-walking names resolve to nothing", ps.readSkillBody("../agentos/brand-voice") === "" && ps.readSkillBody("..") === "");

// ── C. descriptions ───────────────────────────────────────────────────────────
check("C1 quoted description unquoted", byName["zeta-helper"]?.description === "Quoted description.");
check("C2 folded description joined", byName["academic-writing"]?.description === "Folded description line one and line two.", byName["academic-writing"]?.description);
check("C3 literal block read", byName["Content Creation"]?.description === "Literal block.");

// ── D. bodies, module kit, create ─────────────────────────────────────────────
check("D1 a SkillDB body resolves", ps.readSkillBody("academic-writing") === "Body of academic-writing.");
check("D2 the clash body comes from the winning source", ps.readSkillBody("brand-voice") === "Body of brand-voice." && ps.listInstalledSkills().find((s) => s.name === "brand-voice").source === "agentos");
const kit = await import("../../src/lib/moduleKit.ts");
kit.setKitItem({ module: "deals", kind: "skill", name: "academic-writing", active: true });
const k = kit.getModuleKit("deals");
check("D3 a SkillDB skill switches on for a module", k.skills.find((s) => s.name === "academic-writing")?.activeHere === true);
check("D4 the kit carries each skill's source", k.skills.find((s) => s.name === "zeta-helper")?.source === "claude");
check("D5 withSkills injects the SkillDB body", ps.withSkills("PROMPT", "deals").includes("Body of academic-writing."));
check("D6 createSkill refuses a name another source holds", (() => { try { ps.createSkill({ name: "zeta-helper", description: "d", body: "b" }); return false; } catch (e) { return e.status === 409 && /Claude Code/.test(e.message); } })());
check("D7 createSkill still writes only the Agent OS folder", (() => { ps.createSkill({ name: "fresh-one", description: "d", body: "b" }); return fs.existsSync(path.join(A, "fresh-one", "SKILL.md")) && !fs.existsSync(path.join(C, "fresh-one")) && !fs.existsSync(path.join(D, "fresh-one")); })());

// ── E. UI ─────────────────────────────────────────────────────────────────────
const ui = fs.readFileSync("src/components/ModuleKit.tsx", "utf8");
check("E1 each skill shows its source", ui.includes('SOURCE_LABEL[s.source ?? "agentos"]'));
check("E2 skills filter by source and by on", ui.includes('aria-label="Filter skills by source"') && ui.includes('src === "on" ? s.activeHere || s.activeGlobal'));
check("E3 the panel is near-opaque", /rgba\(22,19,34,0\.9\d\)/.test(ui) && ui.includes("bg-black/70"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
