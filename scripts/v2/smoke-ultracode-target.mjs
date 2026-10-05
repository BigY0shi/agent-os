// Ultracode target + model/effort smoke, offline (owner, 2026-09-30: "have it ask for a folder
// or repo. Also make sure the model/effort is configurable. At least between opus 5.5, sonnet
// 5.5, fable 5.1 and opus 5").
//   A. the four models + five effort levels; the defaults (Opus 5.5, xhigh); the request wins,
//      then settings.ultracode, then the defaults; anything invalid is an error, not a swap
//   B. target resolution: an existing folder is used where it is (real path); a file, a missing
//      folder, a relative path, http://, git@ and odd URLs are refused with a reason; a repo URL
//      maps to one clone folder per host/owner/repo under the scratch area
//   C. the route: a bad target / model / effort is a 400 with the reason BEFORE any claude
//      process starts; the args carry --model, --effort and --add-dir; the run records them
//   D. the tab: the two code-reading missions need a target; model + effort pickers save to
//      settings; a refused launch is shown
// No claude process is ever started (every route call here is refused before spawning), and
// no network is used (repo URLs are only mapped, never cloned). HOME / USERPROFILE and every
// store point at a temp dir (rule 19).
// Run: npx tsx scripts/v2/smoke-ultracode-target.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-ultracode-"));
process.env.HOME = tmp;
process.env.USERPROFILE = tmp;
process.env.AGENTIC_OS_SETTINGS = path.join(tmp, "settings.json");
process.env.AGENTIC_OS_DB = path.join(tmp, "test.db");
process.env.AGENTIC_OS_AGENTMAIL_DIR = path.join(tmp, "agentmail");
process.env.AGENTIC_OS_NEWSLETTER_DIR = path.join(tmp, "newsletter");
process.env.AGENTIC_OS_ULTRACODE_RUNS = path.join(tmp, "ultracode-runs");
process.env.AGENTIC_OS_CLAUDE_SCRATCH = path.join(tmp, "claude-projects");
fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, "{}", "utf8");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || extra === undefined ? "" : `  [${String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 300)}]`}`);
  if (!cond) failures++;
};
const errOf = async (fn) => { try { await fn(); return null; } catch (e) { return String(e?.message || e); } };

const M = await import("../../src/lib/ultracodeModels.ts");
const T = await import("../../src/lib/ultracodeTarget.ts");
const S = await import("../../src/lib/settings.ts");

// ── A ─────────────────────────────────────────────────────────────────────────
check("A1 the four models the owner named are offered", M.ULTRACODE_MODELS.map((m) => m.id).join() === "claude-opus-5-5,claude-sonnet-5-5,claude-fable-5-1,claude-opus-5");
check("A2 the five claude --effort levels are offered", M.ULTRACODE_EFFORTS.join() === "low,medium,high,xhigh,max");
check("A3 defaults: Opus 5.5 at xhigh (settings default too)", S.DEFAULT_SETTINGS.ultracode.model === "claude-opus-5-5" && S.DEFAULT_SETTINGS.ultracode.effort === "xhigh");
let c = T.ultracodeChoice(undefined, {});
check("A4 nothing given: the defaults", c.model === "claude-opus-5-5" && c.effort === "xhigh");
c = T.ultracodeChoice({ model: "claude-fable-5-1", effort: "max" }, {});
check("A5 settings apply when the request names none", c.model === "claude-fable-5-1" && c.effort === "max");
c = T.ultracodeChoice({ model: "claude-fable-5-1", effort: "max" }, { model: "claude-sonnet-5-5", effort: "low" });
check("A6 the request (the tab's pickers) wins over settings", c.model === "claude-sonnet-5-5" && c.effort === "low");
let m = await errOf(() => T.ultracodeChoice(undefined, { model: "gpt-5; rm -rf /" }));
check("A7 an invalid model is refused, never swapped", !!m && /is not a Claude model/.test(m), m);
m = await errOf(() => T.ultracodeChoice(undefined, { effort: "ludicrous" }));
check("A8 an invalid effort is refused", !!m && /is not an effort level/.test(m), m);

// ── B ─────────────────────────────────────────────────────────────────────────
const proj = path.join(tmp, "some project"); fs.mkdirSync(proj, { recursive: true });
const file = path.join(tmp, "a-file.txt"); fs.writeFileSync(file, "x", "utf8");
const repos = path.join(tmp, "repos");
const t = await T.resolveUltracodeTarget(`  ${proj}  `, repos);
check("B1 an existing folder is used where it is (real path, kind folder)", t.kind === "folder" && t.dir === fs.realpathSync(proj));
for (const [label, input, re] of [
  ["B2 a file is refused", file, /is a file, not a folder/],
  ["B3 a missing folder is refused", path.join(tmp, "nope"), /Folder not found/],
  ["B4 a relative path is refused", "some/relative/path", /not an absolute folder path/],
  ["B5 an http:// URL is refused (https only)", "http://github.com/owner/repo", /not a repo URL Ultracode can clone/],
  ["B6 a git@ URL is refused (https only)", "git@github.com:owner/repo.git", /not a repo URL Ultracode can clone/],
  ["B7 a URL with odd characters is refused", "https://github.com/owner/repo;rm -rf", /not a repo URL Ultracode can clone/],
  ["B8 an empty target is refused", "   ", /No folder or repo given/],
]) {
  const e = await errOf(() => T.resolveUltracodeTarget(input, repos));
  check(label, !!e && re.test(e), e);
}
const d1 = T.repoCloneDir("https://github.com/BigY0shi/agent-os.git", repos);
check("B9 one clone folder per repo: .git / trailing slash / case don't split it",
  d1 === T.repoCloneDir("https://github.com/BigY0shi/agent-os", repos) && d1 === T.repoCloneDir("https://github.com/bigy0shi/agent-os/", repos) &&
  path.basename(d1).startsWith("github.com-bigy0shi-agent-os-"), d1);
check("B9b different repos never share a folder (the review's collisions)",
  T.repoCloneDir("https://gitlab.com/groupA/team/app", repos) !== T.repoCloneDir("https://gitlab.com/groupB/team/app", repos) &&
  T.repoCloneDir("https://github.com/foo-bar/baz", repos) !== T.repoCloneDir("https://github.com/foo/bar-baz", repos));
check("B9c clones live outside the Claude scratch root the Workspace serves", !T.ULTRACODE_REPOS_ROOT.startsWith(process.env.AGENTIC_OS_CLAUDE_SCRATCH) && /ultracode-repos$/.test(T.ULTRACODE_REPOS_ROOT));
const B = String.fromCharCode(92);
check("B9d the read-only rule uses the form verified live on Windows (//c/... lower-case drive)",
  T.permissionPathFor(["C:", "Users", "Yoshi", "code", "proj"].join(B)) === "//c/Users/Yoshi/code/proj/**" &&
  T.permissionPathFor("D:/work/repo/") === "//d/work/repo/**" && T.permissionPathFor("/srv/repo") === "//srv/repo/**");
const roa = T.readOnlyArgs(["C:", "x", "y"].join(B));
check("B9e readOnlyArgs: acceptEdits for the mission folder, no shell, Edit/Write/NotebookEdit denied under the target",
  roa.join(" ") === "--permission-mode acceptEdits --disallowedTools Bash Edit(//c/x/y/**) Write(//c/x/y/**) NotebookEdit(//c/x/y/**)", roa);
const tsrc = fs.readFileSync("src/lib/ultracodeTarget.ts", "utf8");
check("B9f git never prompts, re-runs fetch + check out the tip, and an existing clone's origin is checked",
  /GIT_TERMINAL_PROMPT: "0"/.test(tsrc) && /credential\.interactive=never/.test(tsrc) && /"fetch", "--depth", "1", "origin", "HEAD"/.test(tsrc) && /"checkout", "--detach", "--force", "FETCH_HEAD"/.test(tsrc) && /remote", "get-url", "origin"/.test(tsrc) && !/"pull"/.test(tsrc));
check("B10 the prompt note names the target and says it is read-only", /read-only for this run/.test(T.targetNote(t)) && T.targetNote(t).includes(t.dir));
check("B11 resolving never ran git for a folder (no clone folder created)", !fs.existsSync(repos));

// ── C ─────────────────────────────────────────────────────────────────────────
const route = await import("../../src/app/api/claude/chat/route.ts");
const post = (body) => route.POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }));
let r = await post({ prompt: "audit it", ultracode: true, project: "ultracode-security", target: path.join(tmp, "missing-dir") });
check("C1 a missing target folder: 400 with the reason, before anything runs", r.status === 400 && /Folder not found/.test(await r.text()));
r = await post({ prompt: "audit it", ultracode: true, project: "ultracode-security", model: "gpt-5" });
check("C2 a bad model: 400", r.status === 400 && /is not a Claude model/.test(await r.text()));
r = await post({ prompt: "audit it", ultracode: true, project: "ultracode-security", effort: "turbo" });
check("C3 a bad effort: 400", r.status === 400 && /is not an effort level/.test(await r.text()));
const rs = fs.readFileSync("src/app/api/claude/chat/route.ts", "utf8");
check("C4 the args carry the chosen model, effort and --add-dir", /"--model", isUltra \? ucModel : claudeModel\(\)/.test(rs) && /"--effort", ucEffort/.test(rs) && /"--add-dir", ucTarget\.dir/.test(rs) && !/"--effort", "xhigh"/.test(rs));
check("C5 the run records model, effort and target; a resume keeps them (older runs at xhigh)", /run\.effort = ucEffort/.test(rs) && /run\.targetDir = ucTarget\.dir/.test(rs) && /resumeRun\?\.targetDir/.test(rs) && /resumeRun \? \{ model: resumeRun\.model, effort: resumeRun\.effort \?\? "xhigh" \}/.test(rs));
check("C7 a targeted run gets the read-only args and clones into ULTRACODE_REPOS_ROOT", /"--add-dir", ucTarget\.dir, \.\.\.readOnlyArgs\(ucTarget\.dir\)/.test(rs) && /resolveUltracodeTarget\(target, ULTRACODE_REPOS_ROOT\)/.test(rs));
check("C6 the run stays in its project folder (target only via --add-dir)", /spawnStream\("claude", args, \{ cwd: runCwd \}\)/.test(rs));

// ── D ─────────────────────────────────────────────────────────────────────────
const ui = fs.readFileSync("src/components/UltracodeView.tsx", "utf8");
check("D1 Security audit and Find dead code need a target, and no longer name src/", (ui.match(/needsTarget: true/g) || []).length === 2 && !/this Agent OS codebase \(src\/\)|across src\//.test(ui));
check("D2 the tab has the folder/repo field and the model + effort pickers, saved to settings.ultracode", /Folder or repo to work on/.test(ui) && /ULTRACODE_MODELS\.map/.test(ui) && /ULTRACODE_EFFORTS\.map/.test(ui) && /save\(\{ ultracode:/.test(ui));
check("D3 a refused launch is shown, not swallowed", /Mission not started: \{launchErr\}/.test(ui) && /if \(!r\.ok\)/.test(ui));
check("D4 the pickers save only the changed key and wait for settings", /save\(\{ ultracode: patch \}\)/.test(ui) && /disabled=\{!!launching \|\| !settingsReady\}/.test(ui));
check("D5 no screen still claims a fixed xhigh", !/at xhigh effort — it remembers|xhigh effort thinks hard/.test(ui) && !/xhigh effort, dynamic workflows|Claude runs at <code>xhigh<\/code>/.test(fs.readFileSync("src/components/ClaudePanel.tsx", "utf8")));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
