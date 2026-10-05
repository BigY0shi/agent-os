// S28 Files smoke, offline. Every root is a temp fixture; the owner's real files are
// never listed, read or written.
//   A. listing: the right files per agent, grouped, sensitive flagged; credentials,
//      .env and lock files never listed
//   B. allow-list and containment: unknown files, "..", absolute paths, malformed ids
//      and (where the OS allows it) a symlink escaping its folder are all refused
//   C. read: secrets in yaml/json configs come back masked; the hash is of the raw bytes
//   D. save: confirm needed for files that shape an agent; a stale hash is a 409 carrying
//      the current text; masks are restored to the real values on disk; invalid JSON or
//      YAML is refused untouched; the previous version is kept first; a no-op keeps none
//   E. routes   F. UI wiring
// Run: npx tsx scripts/v2/smoke-files.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-files-"));
const J = path.join(tmp, "agentic"), HERMES = path.join(tmp, "hermes"), AGENTS = path.join(tmp, "agents"), SKILLS = path.join(tmp, "skills"), VERS = path.join(tmp, "versions");
process.env.AGENTIC_OS_SETTINGS = path.join(tmp, "settings.json");
process.env.AGENTIC_OS_DB = path.join(tmp, "test.db");
process.env.AGENTIC_OS_AGENTS_DIR = AGENTS;
process.env.AGENTIC_OS_SKILLS_DIR = SKILLS;
process.env.AGENTIC_OS_HERMES_HOME = HERMES;
process.env.AGENTIC_OS_JARVIS_PERSONA_FILE = path.join(J, "jarvis-persona.json");
process.env.AGENTIC_OS_FILE_VERSIONS_DIR = VERS;
process.env.AGENTIC_OS_AGENTMAIL_DIR = path.join(tmp, "agentmail");
process.env.AGENTIC_OS_NEWSLETTER_DIR = path.join(tmp, "newsletter");
fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, "{}", "utf8");

const w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s, "utf8"); };
w(path.join(J, "jarvis-persona.json"), JSON.stringify({ name: "Jarvis", tone: "dry" }, null, 2));
w(path.join(HERMES, "SOUL.md"), "# Soul\nCalm.\n");
w(path.join(HERMES, "memories", "MEMORY.md"), "- likes short answers\n");
w(path.join(HERMES, "memories", "USER.md"), "Owner: Yoshi\n");
w(path.join(HERMES, "memories", "MEMORY.md.lock"), "");
w(path.join(HERMES, "config.yaml"), "model:\n  provider: ollama-cloud\n  api_key: sk-REAL-HERMES-KEY-123\n  name: kimi\nother:\n  api_key: sk-SECOND-KEY-456\n");
w(path.join(HERMES, ".env"), "OPENROUTER_API_KEY=sk-ENV-SECRET\n");
w(path.join(HERMES, "auth.json"), '{"token":"AUTH-SECRET"}');
const AID = "agent-0000-aaaa";
w(path.join(AGENTS, AID, "system.md"), "You are a scout.\n");
w(path.join(AGENTS, AID, "agent.json"), JSON.stringify({ id: AID, name: "Scout", apiKey: "sk-AGENT-KEY-789", enabled: true }, null, 2));
w(path.join(AGENTS, AID, "notes.md"), "notes\n");
w(path.join(SKILLS, "brand-voice", "SKILL.md"), "---\nname: brand-voice\n---\nPlain.\n");
const SECRETS = ["sk-REAL-HERMES-KEY-123", "sk-SECOND-KEY-456", "sk-ENV-SECRET", "AUTH-SECRET", "sk-AGENT-KEY-789"];
const leaks = (s) => SECRETS.filter((x) => s.includes(x));
const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || extra === undefined ? "" : `  [${String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 300)}]`}`);
  if (!cond) failures++;
};
const errOf = (fn) => { try { fn(); return null; } catch (e) { return e; } };

const F = await import("../../src/lib/v2/files/agentFiles.ts");

// ── A ─────────────────────────────────────────────────────────────────────────
const sources = F.listSources();
const src = (k) => sources.find((s) => s.key === k);
const rels = (k) => src(k).files.map((f) => f.rel).sort().join(",");
check("A1 sources: Jarvis, Hermes, each agent, skills", sources.map((s) => s.key).join(",") === `jarvis,hermes,agent:${AID},skills`);
check("A2 Hermes: soul, memories, config; never .env, auth or locks", rels("hermes") === "SOUL.md,config.yaml,memories/MEMORY.md,memories/USER.md", rels("hermes"));
check("A3 agent: system.md, agent.json, its notes; named from agent.json", rels(`agent:${AID}`) === "agent.json,notes.md,system.md" && src(`agent:${AID}`).name === "Scout");
check("A4 groups and sensitivity", (() => { const h = src("hermes").files; const g = (r) => h.find((f) => f.rel === r); return g("SOUL.md").group === "identity" && g("SOUL.md").sensitive && g("memories/MEMORY.md").group === "memory" && !g("memories/MEMORY.md").sensitive && g("memories/USER.md").group === "identity" && g("config.yaml").group === "configuration"; })());
check("A5 skills listed as SKILL.md per skill", rels("skills") === "brand-voice/SKILL.md");
check("A6 nothing in the listing leaks a secret", leaks(JSON.stringify(sources)).length === 0);

// ── B ─────────────────────────────────────────────────────────────────────────
check("B1 a file not in the listing is refused (404)", errOf(() => F.resolve("hermes::.env"))?.status === 404 && errOf(() => F.resolve("hermes::auth.json"))?.status === 404);
check("B2 '..' refused (400)", errOf(() => F.resolve("hermes::memories/../auth.json"))?.status === 400);
check("B3 absolute path refused", errOf(() => F.resolve(`hermes::${path.join(HERMES, "SOUL.md")}`))?.status >= 400);
check("B4 malformed id refused", errOf(() => F.resolve("SOUL.md"))?.status === 400 && errOf(() => F.resolve("nope::SOUL.md"))?.status === 404);
let symlinkTested = false;
try {
  const outside = path.join(tmp, "outside.md"); w(outside, "outside\n");
  fs.symlinkSync(outside, path.join(HERMES, "memories", "ESCAPE.md"));
  symlinkTested = true;
  const listed = F.listSources().find((s) => s.key === "hermes").files.some((f) => f.rel === "memories/ESCAPE.md");
  check("B5 a symlink escaping its folder is refused (403)", listed && errOf(() => F.resolve("hermes::memories/ESCAPE.md"))?.status === 403);
  fs.renameSync(path.join(HERMES, "memories", "ESCAPE.md"), path.join(tmp, "escape-link-parked.md"));
} catch { if (!symlinkTested) console.log("SKIP  B5 symlink escape: this OS user cannot create symlinks"); }

// ── C ─────────────────────────────────────────────────────────────────────────
const cfg = F.readFile("hermes::config.yaml");
check("C1 yaml secrets masked on read, both of them", cfg.masked === 2 && leaks(cfg.content).length === 0 && cfg.content.includes("api_key: ********") && cfg.content.includes("provider: ollama-cloud"));
check("C2 the hash is of the raw bytes", cfg.hash === sha(fs.readFileSync(path.join(HERMES, "config.yaml"), "utf8")));
const aj = F.readFile(`agent:${AID}::agent.json`);
check("C3 json secrets masked on read", aj.masked === 1 && aj.content.includes('"apiKey": "********"') && leaks(aj.content).length === 0);
check("C4 markdown is returned as is", F.readFile("hermes::SOUL.md").content === "# Soul\nCalm.\n");

// ── D ─────────────────────────────────────────────────────────────────────────
const soul = F.readFile("hermes::SOUL.md");
check("D1 a file that shapes an agent needs a confirm (403)", errOf(() => F.saveFile({ id: soul.entry.id, content: "x", baseHash: soul.hash }))?.status === 403);
const r1 = F.saveFile({ id: soul.entry.id, content: "# Soul\nCalm and curious.\n", baseHash: soul.hash, confirm: true });
check("D2 confirmed save writes the file", fs.readFileSync(path.join(HERMES, "SOUL.md"), "utf8") === "# Soul\nCalm and curious.\n");
check("D3 the previous version was kept first", fs.readFileSync(r1.versionKept, "utf8") === "# Soul\nCalm.\n" && F.listVersions(soul.entry.id).length === 1);
const stale = errOf(() => F.saveFile({ id: soul.entry.id, content: "overwrite", baseHash: soul.hash, confirm: true }));
check("D4 a stale hash is a 409 with the current text, nothing written", stale?.status === 409 && stale.extra.current.includes("curious") && fs.readFileSync(path.join(HERMES, "SOUL.md"), "utf8").includes("curious"));
const edited = cfg.content.replace("name: kimi", "name: glm");
F.saveFile({ id: "hermes::config.yaml", content: edited, baseHash: cfg.hash, confirm: true });
const onDisk = fs.readFileSync(path.join(HERMES, "config.yaml"), "utf8");
check("D5 masks restored: real keys still on disk, the edit applied", onDisk.includes("sk-REAL-HERMES-KEY-123") && onDisk.includes("sk-SECOND-KEY-456") && onDisk.includes("name: glm") && !onDisk.includes("********"));
const cfg2 = F.readFile("hermes::config.yaml");
check("D6 invalid YAML refused, file untouched", errOf(() => F.saveFile({ id: "hermes::config.yaml", content: "model: [unclosed", baseHash: cfg2.hash, confirm: true }))?.status === 400 && fs.readFileSync(path.join(HERMES, "config.yaml"), "utf8") === onDisk);
const aj2 = F.readFile(`agent:${AID}::agent.json`);
check("D7 invalid JSON refused", errOf(() => F.saveFile({ id: aj2.entry.id, content: "{ nope", baseHash: aj2.hash, confirm: true }))?.status === 400);
check("D8 a mask with no original is refused, not written", errOf(() => F.saveFile({ id: aj2.entry.id, content: aj2.content.replace('"enabled": true', '"token": "********",\n  "enabled": true'), baseHash: aj2.hash, confirm: true }))?.status === 400);
const mem = F.readFile("hermes::memories/MEMORY.md");
const before = F.countVersions();
F.saveFile({ id: mem.entry.id, content: mem.content, baseHash: mem.hash });
check("D9 memory notes save without the gate; a no-op keeps no version", F.countVersions() === before);
F.saveFile({ id: mem.entry.id, content: mem.content + "- works late\n", baseHash: mem.hash });
check("D10 a real change keeps one more version", F.countVersions() === before + 1);

// ── E ─────────────────────────────────────────────────────────────────────────
const list = await import("../../src/app/api/v2/files/route.ts");
const one = await import("../../src/app/api/v2/files/file/route.ts");
let res = await list.GET(); let text = await res.text(); let j = JSON.parse(text);
check("E1 list: counts (agents, files, last changed, versions kept)", res.status === 200 && j.counts.agents === 4 && j.counts.files >= 8 && j.counts.versionsKept === F.countVersions() && typeof j.counts.lastChanged === "number");
check("E2 list carries no secret", leaks(text).length === 0);
res = await one.GET(new Request(`http://x/api/v2/files/file?id=${encodeURIComponent("hermes::config.yaml")}`)); text = await res.text(); j = JSON.parse(text);
check("E3 read route masks and lists versions", res.status === 200 && leaks(text).length === 0 && Array.isArray(j.versions) && j.versions.length >= 1);
res = await one.GET(new Request(`http://x/api/v2/files/file?id=${encodeURIComponent("hermes::auth.json")}`));
check("E4 a credential file cannot be read through the route", res.status === 404);
res = await one.POST(new Request("http://x", { method: "POST", body: JSON.stringify({ id: "hermes::SOUL.md", content: "x", baseHash: "0".repeat(64), confirm: true }) }));
j = await res.json();
check("E5 route: stale save is a 409 with the current text", res.status === 409 && typeof j.current === "string" && j.current.includes("curious"));

// ── F ─────────────────────────────────────────────────────────────────────────
const hub = fs.readFileSync("src/components/jarvis/JarvisHub.tsx", "utf8");
const ui = fs.readFileSync("src/components/jarvis/FilesTab.tsx", "utf8");
check("F1 Files tab registered in Jarvis", /key: "files", label: "Files"[^\n]*<FilesTab \/>/.test(hub));
check("F2 the gate offers both choices", ui.includes("I understand, let me edit") && ui.includes("Just read it"));
check("F3 saves send the hash the editor started from", ui.includes("baseHash: file.hash"));
check("F4 a conflict shows the current text instead of overwriting", ui.includes("res.status === 409"));
check("F5 masked secrets are explained", ui.includes("masked"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
