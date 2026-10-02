// db.backup location smoke, offline.
//   A. backupDirFor: default install keeps ~/.agentic-os/backups; a temp DB backs up beside
//      itself; AGENTIC_OS_BACKUPS_DIR overrides; a DB with no file path fails loudly
//   B. runInline("db.backup") with AGENTIC_OS_DB in a temp dir: the snapshot lands next to
//      that temp DB and is a real SQLite copy; nothing appears under the home dir
//   C. retention exiles the oldest snapshots to a .exile folder beside the backups, never home
//   D. the real ~/.agentic-os/backups was not touched (read-only listing before and after)
//   E. boot.ts no longer builds backup paths from the home dir
// HOME / USERPROFILE point at a temp "home" so the old bug (backups under os.homedir())
// would land somewhere this smoke can see, and every store is redirected (rule 19).
// Run: npx tsx scripts/v2/smoke-db-backup-location.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const realBackups = path.join(os.homedir(), ".agentic-os", "backups");
const listReal = () => {
  try {
    return fs.readdirSync(realBackups).sort().map((f) => `${f}:${fs.statSync(path.join(realBackups, f)).mtimeMs}`).join("|");
  } catch { return "(none)"; }
};
const realBefore = listReal();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-backup-"));
const fakeHome = path.join(tmp, "home");
const dataDir = path.join(tmp, "data");
fs.mkdirSync(fakeHome, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });
process.env.HOME = fakeHome;
process.env.USERPROFILE = fakeHome;
process.env.AGENTIC_OS_SETTINGS = path.join(tmp, "settings.json");
process.env.AGENTIC_OS_DB = path.join(dataDir, "test.db");
process.env.AGENTIC_OS_AGENTS_DIR = path.join(tmp, "agents");
process.env.AGENTIC_OS_PRINCIPALS = path.join(tmp, "principals");
process.env.AGENTIC_OS_RUNS_DIR = path.join(tmp, "runs");
process.env.AGENTIC_OS_WEBMCP_DIR = path.join(tmp, "webmcp");
process.env.AGENTIC_OS_SKILLS_DIR = path.join(tmp, "skills");
process.env.AGENTIC_OS_AGENTMAIL_DIR = path.join(tmp, "agentmail");
process.env.AGENTIC_OS_NEWSLETTER_DIR = path.join(tmp, "newsletter");
delete process.env.AGENTIC_OS_BACKUPS_DIR;
fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, "{}", "utf8");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || extra === undefined ? "" : `  [${String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 300)}]`}`);
  if (!cond) failures++;
};

const boot = await import("../../src/lib/v2/boot.ts");
const sched = await import("../../src/lib/v2/scheduler.ts");
const { getDb } = await import("../../src/lib/v2/db.ts");

// ── A ─────────────────────────────────────────────────────────────────────────
const defaultDb = path.join("C:", path.sep, "Users", "someone", ".agentic-os", "agentos.db");
check("A1 default install keeps ~/.agentic-os/backups", boot.backupDirFor(path.resolve(defaultDb)) === path.join(path.dirname(path.resolve(defaultDb)), "backups"));
check("A2 default exile root stays ~/.agentic-os/.exile", boot.backupExileRootFor(path.resolve(defaultDb)) === path.join(path.dirname(path.resolve(defaultDb)), ".exile"));
check("A3 a temp DB backs up beside itself", boot.backupDirFor(process.env.AGENTIC_OS_DB) === path.join(dataDir, "backups"));
process.env.AGENTIC_OS_BACKUPS_DIR = path.join(tmp, "elsewhere", "snaps");
check("A4 AGENTIC_OS_BACKUPS_DIR overrides, exile sits beside it", boot.backupDirFor(process.env.AGENTIC_OS_DB) === path.join(tmp, "elsewhere", "snaps") && boot.backupExileRootFor(process.env.AGENTIC_OS_DB) === path.join(tmp, "elsewhere", ".exile"));
delete process.env.AGENTIC_OS_BACKUPS_DIR;
let threw = null;
try { boot.backupDirFor(":memory:"); } catch (e) { threw = e; }
check("A5 an in-memory DB fails loudly instead of writing to the cwd", threw instanceof Error && /without a file path/.test(threw.message));

// ── B ─────────────────────────────────────────────────────────────────────────
boot.ensureV2();
check("B0 V2 booted on the temp DB", globalThis.__agentosV2Booted === true && fs.existsSync(process.env.AGENTIC_OS_DB));
getDb().prepare("CREATE TABLE IF NOT EXISTS backup_probe (v TEXT)").run();
getDb().prepare("INSERT INTO backup_probe (v) VALUES (?)").run("smoke-marker");
const ok = await sched.runInline("db.backup");
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const snap = path.join(dataDir, "backups", `agentos-${stamp}.db`);
check("B1 runInline(db.backup) succeeded", ok === true);
check("B2 the snapshot landed next to the temp DB", fs.existsSync(snap) && fs.statSync(snap).size > 0);
const Database = (await import("better-sqlite3")).default;
const copy = new Database(snap, { readonly: true });
let marker = null;
try { marker = copy.prepare("SELECT v FROM backup_probe").get()?.v; } finally { copy.close(); }
check("B3 the snapshot is a real copy of that DB (marker row read back)", marker === "smoke-marker");
check("B4 nothing appeared under the home dir", !fs.existsSync(path.join(fakeHome, ".agentic-os", "backups")) && !fs.existsSync(path.join(fakeHome, ".agentic-os", ".exile")));

// ── C ─────────────────────────────────────────────────────────────────────────
const bdir = path.join(dataDir, "backups");
for (let d = 1; d <= 15; d++) fs.writeFileSync(path.join(bdir, `agentos-202001${String(d).padStart(2, "0")}.db`), "old", "utf8");
await sched.runInline("db.backup");
const left = fs.readdirSync(bdir).filter((f) => /^agentos-\d{8}\.db$/.test(f));
const exileRoot = path.join(dataDir, ".exile");
const exiled = fs.existsSync(exileRoot) ? fs.readdirSync(exileRoot).flatMap((d) => fs.readdirSync(path.join(exileRoot, d))) : [];
check("C1 retention keeps 14 snapshots", left.length === 14, left.length);
check("C2 the oldest were exiled beside the backups, not deleted", exiled.length === 2 && exiled.includes("agentos-20200101.db") && exiled.includes("agentos-20200102.db"), exiled);
check("C3 still nothing under the home dir", !fs.existsSync(path.join(fakeHome, ".agentic-os")) || !fs.readdirSync(path.join(fakeHome, ".agentic-os")).some((f) => f === "backups" || f === ".exile"));

// ── D ─────────────────────────────────────────────────────────────────────────
check("D1 the real ~/.agentic-os/backups is unchanged", listReal() === realBefore);

// ── E ─────────────────────────────────────────────────────────────────────────
const src = fs.readFileSync("src/lib/v2/boot.ts", "utf8");
check("E1 boot.ts builds no path from os.homedir()", !/homedir\(\)/.test(src));
check("E2 the handler uses the file ensureDb() opened", /backupDirFor\(db\.name\)/.test(src));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
