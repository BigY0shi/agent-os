// smoke-webmcp-wizard-upgrade: migration 046 brings an OLD webmcp_wizard_drafts table (the one a
// killed S7 cycle created on the owner's live DB on 2026-09-03, recorded as migration 44) up to
// the S7 shape, so the wizard's queries work there too. Offline; temp DB only (rule 19).
//   A. a fresh DB: 044 creates the S7 shape, 046 changes nothing
//   B. an upgraded DB: old-shape table + 44 already recorded -> 046 adds applied_slug and
//      archived_at, and the wizard's own insert/list/archive SQL runs against it
// Run: npx tsx scripts/v2/smoke-webmcp-wizard-upgrade.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-wizard-upgrade-"));
process.env.AGENTIC_OS_DB = path.join(tmp, "fresh.db");
process.env.AGENTIC_OS_SETTINGS = path.join(tmp, "settings.json");
process.env.AGENTIC_OS_AGENTMAIL_DIR = path.join(tmp, "agentmail");
process.env.AGENTIC_OS_NEWSLETTER_DIR = path.join(tmp, "newsletter");
fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, "{}", "utf8");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || extra === undefined ? "" : `  [${JSON.stringify(extra).slice(0, 300)}]`}`);
  if (!cond) failures++;
};
const cols = (db) => db.prepare("PRAGMA table_info(webmcp_wizard_drafts)").all().map((c) => c.name);

const dbm = await import("../../src/lib/v2/db.ts");
const Database = (await import("better-sqlite3")).default;

// A. fresh
let db = dbm.getDb();
const freshCols = cols(db);
check("A1 fresh DB has the S7 columns", freshCols.includes("applied_slug") && freshCols.includes("archived_at"), freshCols);
check("A2 migrations 44 and 46 are both recorded", db.prepare("SELECT count(*) n FROM migrations WHERE version IN (44,46)").get().n === 2);
dbm.__closeForTests();

// B. the owner's live shape: built by hand, with 44 recorded and 46 not yet
const old = path.join(tmp, "old.db");
fs.copyFileSync(path.join(tmp, "fresh.db"), old);
const raw = new Database(old);
raw.exec("DROP TABLE webmcp_wizard_drafts"); // temp fixture DB only, never user data
raw.exec(`CREATE TABLE webmcp_wizard_drafts (
  id TEXT PRIMARY KEY, mode TEXT NOT NULL CHECK (mode IN ('wizard','own')), step TEXT NOT NULL DEFAULT 'describe',
  title TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','applied','discarded')),
  state_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
raw.prepare("DELETE FROM migrations WHERE version = 46").run(); // temp fixture: "46 not yet applied"
raw.close();
check("B0 fixture has the old shape (no applied_slug/archived_at)", (() => { const r = new Database(old); const c = cols(r); r.close(); return !c.includes("applied_slug") && !c.includes("archived_at"); })());

process.env.AGENTIC_OS_DB = old;
db = dbm.getDb();
const upCols = cols(db);
check("B1 after boot: applied_slug and archived_at exist", upCols.includes("applied_slug") && upCols.includes("archived_at"), upCols);
check("B2 046 is now recorded", db.prepare("SELECT count(*) n FROM migrations WHERE version = 46").get().n === 1);
const now = new Date().toISOString();
db.prepare(`INSERT INTO webmcp_wizard_drafts(id, mode, step, title, state_json, applied_slug, created_at, updated_at, archived_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run("d1", "wizard", "describe", "t", "{}", null, now, now, null);
db.prepare("UPDATE webmcp_wizard_drafts SET step = ?, title = ?, state_json = ?, applied_slug = ?, updated_at = ? WHERE id = ?").run("emitted", "t2", "{}", "pkg", now, "d1");
const listed = db.prepare("SELECT * FROM webmcp_wizard_drafts WHERE archived_at IS NULL ORDER BY updated_at DESC LIMIT 200").all();
check("B3 the wizard's insert / update / list SQL works on the upgraded table", listed.length === 1 && listed[0].applied_slug === "pkg", listed);
db.prepare("UPDATE webmcp_wizard_drafts SET archived_at = ?, updated_at = ? WHERE id = ?").run(now, now, "d1");
check("B4 archive hides the draft from the list (row kept)", db.prepare("SELECT count(*) n FROM webmcp_wizard_drafts WHERE archived_at IS NULL").get().n === 0 && db.prepare("SELECT count(*) n FROM webmcp_wizard_drafts").get().n === 1);
dbm.__closeForTests();

console.log(failures ? `\n${failures} failure(s)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
