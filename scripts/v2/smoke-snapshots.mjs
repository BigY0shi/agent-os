// S37 Snapshots smoke, offline.
//   A. config: defaults (weekly / default folder / keep 8 / secrets out), the folder must be
//      outside the state folder, the secret list, secret fields stripped from JSON
//   B. boot registers core:snapshots on the scheduler; Standing orders lists it as a system job
//   C. a snapshot: a backup-API copy of the DB (marker row read back), a manifest whose every
//      entry matches the file on disk (size + sha256) and misses none, restore.ps1, secrets
//      absent and listed, settings.json kept with its secret fields removed, the always-excluded
//      folders absent, no .partial-* left behind
//   D. restore.ps1 really restores into a temp target (Windows with pwsh/powershell only): the
//      previous state is moved to .exile, the left-out secret file and the removed secret field
//      are carried over from it, the DB and files come back with their hashes
//   E. include secrets on: the key files and fields are in the snapshot and the manifest says so
//   F. retention keeps the newest N, exiles the rest and stale .partial-* folders; nothing deleted
//   G. the job follows the cadence (rrule, enabled); a scheduled run with cadence Off is a no-op
//   H. the route: GET status, POST now (409 while running, 400 bad action), PATCH validation,
//      PATCH persists and re-syncs the job, a folder inside the state folder is refused
//   I. wiring: the card on Health, its controls in the doc, no delete anywhere in the module
// HOME / USERPROFILE and every store point at a temp dir (rule 19); the fake ~/.agentic-os
// holds fake secrets so their absence from the snapshot is what is tested.
// Run: npx tsx scripts/v2/smoke-snapshots.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-snapshots-"));
const fakeHome = path.join(tmp, "home");
const state = path.join(fakeHome, ".agentic-os");
fs.mkdirSync(state, { recursive: true });
process.env.HOME = fakeHome;
process.env.USERPROFILE = fakeHome;
process.env.AGENTIC_OS_SETTINGS = path.join(state, "settings.json");
process.env.AGENTIC_OS_DB = path.join(state, "agentos.db");
process.env.AGENTIC_OS_CONFIG = path.join(state, "config.json");
process.env.AGENTIC_OS_KEY = path.join(tmp, "elsewhere.key");
process.env.AGENTIC_OS_AGENTS_DIR = path.join(tmp, "agents");
process.env.AGENTIC_OS_PRINCIPALS = path.join(tmp, "principals.json");
process.env.AGENTIC_OS_RUNS_DIR = path.join(tmp, "runs");
process.env.AGENTIC_OS_MISSIONS_DIR = path.join(tmp, "missions");
process.env.AGENTIC_OS_WEBMCP_DIR = path.join(tmp, "webmcp");
process.env.AGENTIC_OS_SKILLS_DIR = path.join(tmp, "skills");
process.env.AGENTIC_OS_AGENTMAIL_DIR = path.join(tmp, "agentmail");
process.env.AGENTIC_OS_NEWSLETTER_DIR = path.join(tmp, "newsletter");
process.env.AGENTIC_OS_ANYNOTES_DIR = path.join(tmp, "anynotes");
process.env.AGENTIC_OS_FILE_VERSIONS_DIR = path.join(tmp, "versions");
delete process.env.AGENTIC_OS_SNAPSHOT_SOURCE;
delete process.env.AGENTIC_OS_BACKUPS_DIR;

const LIVE_KEY = "sk-live-ollama-key-0123456789abcdef";
const put = (rel, text) => { const p = path.join(state, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text, "utf8"); };
const writeSettings = (obj) => fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, JSON.stringify(obj, null, 2), "utf8");
writeSettings({ defaultAgent: "claude", ollama: { apiKey: LIVE_KEY, host: "https://ollama.com" } });
put("config.json", JSON.stringify({ roomAgents: { pi: { apiKeyEnv: "GLM_API_KEY", model: "glm" } }, buzzToken: "tok-0123456789abcdefghij" }));
// secrets (must stay out)
put("secrets.json", '{"X":"1"}');
put("session-secret.json", '{"secret":"s"}');
put("principals.json", "[]");
put("agentos.key", "k");
put("buzz.env", "BUZZ_PRIVATE_KEY=1");
put("newsletter/config.json", '{"addyKey":"a"}');
put("agentmail/config.json", '{"apiKey":"a"}');
put("browser-profiles/Default/Cookies", "cookie-jar");
put("webmcp/pkg.secrets.json", "{}");
put("jarvis-glasses.token", "t");
// ordinary state (must be copied)
put("jarvis-persona.json", '{"name":"Jarvis"}');
put("agents/a1/agent.json", '{"id":"a1"}');
put("skills/demo/SKILL.md", "# demo\n");
put("workflows/workflows.json", "[]");
// never copied
put("backups/agentos-20200101.db", "old");
put(".exile/2020-01-01_00-00-00/gone.txt", "x");
put("agentos.lock", "1");
put("heygen-cache/a.bin", "b");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || extra === undefined ? "" : `  [${String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 400)}]`}`);
  if (!cond) failures++;
};
const skip = (name, why) => console.log(`SKIP  ${name}  [${why}]`);
const read = (f) => fs.readFileSync(f, "utf8");
const sha = (f) => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const listFiles = (root, rel = "", out = []) => {
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) listFiles(root, r, out); else out.push(r);
  }
  return out;
};

const C = await import("../../src/lib/v2/snapshots/config.ts");
const T = await import("../../src/lib/v2/snapshots/take.ts");
const J = await import("../../src/lib/v2/snapshots/jobs.ts");
const S = await import("../../src/lib/settings.ts");
const boot = await import("../../src/lib/v2/boot.ts");
const sched = await import("../../src/lib/v2/scheduler.ts");
const { getDb } = await import("../../src/lib/v2/db.ts");
const Database = (await import("better-sqlite3")).default;

// ── A ─────────────────────────────────────────────────────────────────────────
let st = C.snapshotSettings();
check("A1 defaults: weekly, default folder, keep 8, secrets out", st.cadence === "weekly" && st.dir === "" && st.keep === 8 && st.includeSecrets === false, st);
check("A2 the default folder is <home>/AgentOS-snapshots, outside the state folder", C.snapshotRootDir(st) === path.join(fakeHome, "AgentOS-snapshots") && C.snapshotSourceDir() === state);
writeSettings({ ...S.readSettings(), snapshots: { keep: 0, cadence: "hourly", dir: "~/snaps" } });
st = C.snapshotSettings();
check("A3 a bad keep or cadence falls back to the defaults; ~ expands", st.keep === 8 && st.cadence === "weekly" && C.snapshotRootDir(st) === path.join(fakeHome, "snaps"));
let threw = null;
try { C.snapshotRootDir({ ...st, dir: path.join(state, "snaps") }); } catch (e) { threw = e; }
check("A4 a folder inside the state folder is refused, naming the gear", threw instanceof Error && /outside the state folder/.test(threw.message) && /Snapshots gear/.test(threw.message));
check("A5 the secret list covers the key files, *.env, *.secrets.json, tokens and browser profiles", ["secrets.json", "session-secret.json", "principals.json", "agentos.key", "buzz.env", "newsletter/config.json", "agentmail/config.json", "webmcp/pkg.secrets.json", "jarvis-glasses.token", "browser-profiles", "browser-profiles/Default/Cookies"].every(C.isSecretRel) && !C.isSecretRel("jarvis-persona.json") && !C.isSecretRel("settings.json"));
check("A6 always excluded: backups/, .exile/, the lock, heygen-cache/", ["backups", "backups/x.db", ".exile/a/b", "agentos.lock", "heygen-cache/a"].every(C.isExcludedRel) && !C.isExcludedRel("agents/a1/agent.json"));
const stripped = C.stripSecretFields({ ollama: { apiKey: "k", host: "h" }, room: { agents: { pi: { apiKeyEnv: "E" } } }, hotkey: { key: "F13" } });
check("A7 secret fields are removed, env-var names and hotkey names stay", stripped.removed.join() === "ollama.apiKey" && stripped.doc.ollama.host === "h" && stripped.doc.room.agents.pi.apiKeyEnv === "E" && stripped.doc.hotkey.key === "F13", stripped);
writeSettings({ defaultAgent: "claude", ollama: { apiKey: LIVE_KEY, host: "https://ollama.com" }, snapshots: { keep: 3 } });

// ── B ─────────────────────────────────────────────────────────────────────────
boot.ensureV2();
let job = J.snapshotJob();
check("B1 boot registers core:snapshots, weekly, enabled, with a next run", globalThis.__agentosV2Booted === true && job && job.kind === "snapshots.take" && job.rrule === C.CADENCE_RRULE.weekly && job.enabled === 1 && typeof job.run_at === "string", job);
const O = await import("../../src/lib/v2/standing/orders.ts");
const orders = await O.listStandingOrders();
const so = orders.find((o) => o.kind === "system" && o.title === J.SNAPSHOT_JOB_NAME);
check("B2 Standing orders lists it as a system job with Run it now and a next run", !!so && so.actions.run && so.live && typeof so.nextRunAt === "number" && /week/i.test(so.cadence), so);

// ── C ─────────────────────────────────────────────────────────────────────────
getDb().prepare("CREATE TABLE IF NOT EXISTS snap_probe (v TEXT)").run();
getDb().prepare("INSERT INTO snap_probe (v) VALUES (?)").run("marker-one");
const root = C.snapshotRootDir();
const r1 = await J.takeSnapshotNow("manual");
const snap1 = r1.snapshot.dir;
check("C1 the snapshot folder is named by its stamp and holds the four parts", T.SNAPSHOT_NAME_RE.test(path.basename(snap1)) && ["agentos.db", "agentic-os", "manifest.json", "restore.ps1"].every((f) => fs.existsSync(path.join(snap1, f))), fs.readdirSync(snap1));
let marker = null;
{ const copy = new Database(path.join(snap1, "agentos.db"), { readonly: true }); try { marker = copy.prepare("SELECT v FROM snap_probe").get()?.v; } finally { copy.close(); } }
check("C2 agentos.db is a consistent backup-API copy (marker row read back)", marker === "marker-one");
const m1 = T.readManifest(snap1);
check("C3 the manifest records format, reason, source paths, port and the DB entry", m1.format === 1 && m1.reason === "manual" && m1.source.dir === state && m1.source.db === path.resolve(process.env.AGENTIC_OS_DB) && m1.source.port === 3737 && m1.db.path === "agentos.db" && m1.db.sha256 === sha(path.join(snap1, "agentos.db")));
const mismatched = m1.files.filter((f) => { const p = path.join(snap1, f.path); return !fs.existsSync(p) || fs.statSync(p).size !== f.bytes || sha(p) !== f.sha256; });
check(`C4 every manifest entry (${m1.files.length}) matches its file: size and sha256`, m1.files.length >= 6 && mismatched.length === 0, mismatched);
const onDisk = listFiles(snap1).filter((f) => f !== "manifest.json" && f !== "restore.ps1");
const unlisted = onDisk.filter((f) => !m1.files.some((x) => x.path === f));
check("C5 no file in the snapshot is missing from the manifest; totalBytes is the sum", unlisted.length === 0 && m1.totalBytes === m1.files.reduce((n, f) => n + f.bytes, 0), unlisted);
const SECRETS = ["secrets.json", "session-secret.json", "principals.json", "agentos.key", "buzz.env", "newsletter/config.json", "agentmail/config.json", "browser-profiles", "webmcp/pkg.secrets.json", "jarvis-glasses.token"];
const leaked = SECRETS.filter((s) => fs.existsSync(path.join(snap1, "agentic-os", s)));
check("C6 no secret file is in the snapshot", leaked.length === 0, leaked);
check("C7 the manifest lists every secret left out", SECRETS.every((s) => m1.secretsLeftOut.some((x) => x === s || x === `${s}/`)), m1.secretsLeftOut);
const snapSettings = JSON.parse(read(path.join(snap1, "agentic-os", "settings.json")));
const snapConfig = JSON.parse(read(path.join(snap1, "agentic-os", "config.json")));
check("C8 settings.json and config.json are kept with their secret fields removed, listed in the manifest", snapSettings.defaultAgent === "claude" && snapSettings.ollama.host === "https://ollama.com" && !("apiKey" in snapSettings.ollama) && snapConfig.roomAgents.pi.apiKeyEnv === "GLM_API_KEY" && !("buzzToken" in snapConfig) && m1.redacted.some((r) => r.path === "agentic-os/settings.json" && r.fields.includes("ollama.apiKey")) && m1.redacted.some((r) => r.path === "agentic-os/config.json" && r.fields.includes("buzzToken")), m1.redacted);
check("C9 ordinary state is copied", ["jarvis-persona.json", "agents/a1/agent.json", "skills/demo/SKILL.md", "workflows/workflows.json"].every((f) => fs.existsSync(path.join(snap1, "agentic-os", f))));
const exc = ["backups", ".exile", "agentos.lock", "heygen-cache", "agentos.db", "agentos.db-wal", "agentos.db-shm"].filter((f) => fs.existsSync(path.join(snap1, "agentic-os", f)));
check("C10 backups/, .exile/, the lock, the cache and the live DB files are not copied raw", exc.length === 0, exc);
check("C11 no .partial-* folder is left behind; the snapshot is listed newest first", !fs.readdirSync(root).some((f) => f.startsWith(".partial-")) && T.listSnapshots(root)[0]?.name === path.basename(snap1));
const ps1 = read(path.join(snap1, "restore.ps1"));
check("C12 restore.ps1 is ASCII, stops Agent OS first, exiles the current state, never deletes", /^[\x00-\x7F]*$/.test(ps1) && ps1.includes("Get-NetTCPConnection -LocalPort $P -State Listen") && ps1.includes("Stop Agent OS.bat") && ps1.includes("before-restore") && ps1.includes("Move-Item") && !/Remove-Item|\brm\b|\bdel\b|\berase\b/.test(ps1));
check("C13 restore.ps1 defaults to the paths this snapshot came from", ps1.includes(`[string]$SourceDir = '${state.replace(/'/g, "''")}'`) && ps1.includes(`[int]$Port = 3737`));

// ── D ─────────────────────────────────────────────────────────────────────────
const pwsh = (() => {
  if (process.platform !== "win32") return null;
  for (const bin of ["pwsh", "powershell"]) {
    const r = spawnSync(bin, ["-NoProfile", "-NonInteractive", "-Command", "exit 0"], { timeout: 30_000 });
    if (r.status === 0) return bin;
  }
  return null;
})();
if (!pwsh) {
  skip("D restore.ps1 run", process.platform === "win32" ? "no pwsh/powershell on PATH" : `not Windows (${process.platform})`);
} else {
  const target = path.join(tmp, "restore-target");
  const tState = path.join(target, "agentic-os");
  const tDb = path.join(tState, "agentos.db");
  fs.mkdirSync(tState, { recursive: true });
  fs.writeFileSync(path.join(tState, "secrets.json"), '{"CURRENT":"secret"}', "utf8");
  fs.writeFileSync(path.join(tState, "settings.json"), JSON.stringify({ defaultAgent: "codex", ollama: { apiKey: "sk-current-live-key-9876543210" } }), "utf8");
  fs.writeFileSync(path.join(tState, "stale.txt"), "to be exiled, not deleted", "utf8");
  fs.writeFileSync(tDb, "not a database, must be moved aside", "utf8");
  fs.writeFileSync(`${tDb}-wal`, "wal", "utf8");
  const run = spawnSync(pwsh, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(snap1, "restore.ps1"), "-SourceDir", tState, "-DbPath", tDb, "-RepoRoot", path.join(tmp, "no-repo"), "-Port", "1", "-Yes"], { encoding: "utf8", timeout: 180_000 });
  const out = `${run.stdout}\n${run.stderr}`;
  check("D1 restore.ps1 exits 0 against a temp target (port 1: nothing to stop)", run.status === 0, out.slice(-800));
  const exRoot = path.join(root, ".exile");
  const beforeDirs = fs.existsSync(exRoot) ? fs.readdirSync(exRoot).map((d) => path.join(exRoot, d, "before-restore")).filter((d) => fs.existsSync(d)) : [];
  const before = beforeDirs[0];
  check("D2 the previous state was moved to <root>/.exile/<stamp>/before-restore (stale file and old DB there)", !!before && fs.existsSync(path.join(before, "agentic-os", "stale.txt")) && fs.existsSync(path.join(before, "agentic-os", "agentos.db")) && !fs.existsSync(path.join(tState, "stale.txt")), beforeDirs);
  let restoredMarker = null;
  try { const copy = new Database(tDb, { readonly: true }); try { restoredMarker = copy.prepare("SELECT v FROM snap_probe").get()?.v; } finally { copy.close(); } } catch (e) { restoredMarker = String(e); }
  check("D3 the database came back from the snapshot (marker read)", restoredMarker === "marker-one", restoredMarker);
  check("D4 the snapshot's files are in place", fs.existsSync(path.join(tState, "jarvis-persona.json")) && fs.existsSync(path.join(tState, "agents", "a1", "agent.json")) && sha(path.join(tState, "jarvis-persona.json")) === m1.files.find((f) => f.path === "agentic-os/jarvis-persona.json").sha256);
  check("D5 the left-out secret file was carried over from the current state", fs.existsSync(path.join(tState, "secrets.json")) && read(path.join(tState, "secrets.json")).includes("CURRENT"));
  let merged = null;
  try { merged = JSON.parse(read(path.join(tState, "settings.json"))); } catch { /* unreadable */ }
  check("D6 settings.json: the snapshot's values with the removed secret field put back from the current file", merged && merged.defaultAgent === "claude" && merged.ollama?.apiKey === "sk-current-live-key-9876543210" && merged.ollama?.host === "https://ollama.com", merged);
  check("D7 the restore said what it did", /Restored \d+ files/.test(out) && /kept 1 current secret file/.test(out) && /put 1 secret field/.test(out), out.slice(-600));
}

// ── E ─────────────────────────────────────────────────────────────────────────
writeSettings({ ...S.readSettings(), snapshots: { keep: 3, includeSecrets: true } });
await new Promise((r) => setTimeout(r, 1100)); // a new stamp (second resolution)
const r2 = await J.takeSnapshotNow("manual");
const m2 = T.readManifest(r2.snapshot.dir);
const inSnap = (s) => fs.existsSync(path.join(r2.snapshot.dir, "agentic-os", s));
check("E1 include secrets on: the key files are in the snapshot and the manifest says so", m2.includeSecrets === true && m2.secretsLeftOut.length === 0 && m2.redacted.length === 0 && SECRETS.every(inSnap), m2.secretsLeftOut);
check("E2 settings.json carries its key when secrets are included", JSON.parse(read(path.join(r2.snapshot.dir, "agentic-os", "settings.json"))).ollama.apiKey === LIVE_KEY);
check("E3 backups/, .exile/ and the live DB files are still never copied raw", !inSnap("backups") && !inSnap(".exile") && !inSnap("agentos.db"));
writeSettings({ ...S.readSettings(), snapshots: { keep: 3, includeSecrets: false } });

// ── F ─────────────────────────────────────────────────────────────────────────
for (let d = 1; d <= 4; d++) {
  const dir = path.join(root, `2020-01-0${d}_00-00-00`);
  fs.mkdirSync(path.join(dir, "agentic-os"), { recursive: true });
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ format: 1, createdAt: `2020-01-0${d}T00:00:00.000Z`, reason: "schedule", files: [], totalBytes: 0, includeSecrets: false, secretsLeftOut: [], agentOsVersion: null }), "utf8");
  fs.writeFileSync(path.join(dir, "agentic-os", "x.txt"), "old", "utf8");
}
fs.mkdirSync(path.join(root, ".partial-2020-02-02_00-00-00"), { recursive: true });
fs.mkdirSync(path.join(root, "not-a-snapshot"), { recursive: true });
const countBefore = T.listSnapshots(root).length; // 2 real + 4 old = 6
await new Promise((r) => setTimeout(r, 1100));
const r3 = await J.takeSnapshotNow("manual");
const kept = T.listSnapshots(root);
check("F1 retention keeps the newest 3 (the three real snapshots)", kept.length === 3 && kept.every((s) => !s.name.startsWith("2020-")) && kept[0].name === r3.snapshot.name, kept.map((s) => s.name));
const exiled = T.listExiled(root).flatMap((e) => e.names).filter((n) => n !== "before-restore"); // D's restore left its own exile batch
check("F2 the four old snapshots and the stale .partial-* were exiled, not deleted", r3.exiled.length === 5 && [1, 2, 3, 4].every((d) => exiled.includes(`2020-01-0${d}_00-00-00`)) && exiled.includes(".partial-2020-02-02_00-00-00"), { exiled, moved: r3.exiled });
check("F3 an exiled snapshot is intact under .exile", T.listExiled(root).some((e) => fs.existsSync(path.join(root, ".exile", e.stamp, "2020-01-01_00-00-00", "agentic-os", "x.txt"))));
check("F4 nothing vanished: before = kept + exiled snapshots; a folder without a manifest is ignored", countBefore + 1 === kept.length + exiled.filter((n) => !n.startsWith(".partial")).length && fs.existsSync(path.join(root, "not-a-snapshot")));
check("F5 no unlink / rm in the module: exile is the only way out", !["config.ts", "take.ts", "jobs.ts"].some((f) => /unlink|rmSync|\brm\(|rimraf/.test(read(`src/lib/v2/snapshots/${f}`))));

// ── G ─────────────────────────────────────────────────────────────────────────
writeSettings({ ...S.readSettings(), snapshots: { keep: 3, cadence: "biweekly" } });
job = J.syncSnapshotJob();
check("G1 biweekly -> INTERVAL=2 weekly rrule, enabled, a new next run", job.rrule === C.CADENCE_RRULE.biweekly && job.rrule.includes("INTERVAL=2") && job.enabled === 1 && typeof job.run_at === "string");
writeSettings({ ...S.readSettings(), snapshots: { keep: 3, cadence: "monthly" } });
job = J.syncSnapshotJob();
check("G2 monthly -> FREQ=MONTHLY on the 1st", job.rrule === C.CADENCE_RRULE.monthly && /FREQ=MONTHLY;BYMONTHDAY=1/.test(job.rrule) && job.enabled === 1);
writeSettings({ ...S.readSettings(), snapshots: { keep: 3, cadence: "off" } });
job = J.syncSnapshotJob();
check("G3 off -> the job stays on the books but disabled (held in Standing orders)", job.enabled === 0 && (await O.listStandingOrders()).some((o) => o.title === J.SNAPSHOT_JOB_NAME && !o.live));
const nBefore = T.listSnapshots(root).length;
const okOff = await sched.runInline(J.SNAPSHOT_JOB_KIND);
check("G4 a scheduled run with cadence Off takes nothing (handler ran, no new snapshot)", okOff === true && T.listSnapshots(root).length === nBefore);
writeSettings({ ...S.readSettings(), snapshots: { keep: 3, cadence: "weekly" } });
await new Promise((r) => setTimeout(r, 1100));
const okOn = await sched.runInline(J.SNAPSHOT_JOB_KIND);
const newest = T.listSnapshots(root)[0];
check("G5 the scheduled handler takes a snapshot marked 'schedule' and re-syncs the job", okOn === true && newest.reason === "schedule" && T.listSnapshots(root).length === 3 && J.snapshotJob().enabled === 1 && J.snapshotJob().rrule === C.CADENCE_RRULE.weekly, newest);

// ── H ─────────────────────────────────────────────────────────────────────────
const route = await import("../../src/app/api/v2/snapshots/route.ts");
const call = async (method, body) => { const res = await route[method](new Request("http://x/api/v2/snapshots", { method: method === "GET" ? "GET" : "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })); return { status: res.status, json: await res.json() }; };
let g = await call("GET");
check("H1 GET: status with settings, folder, job (last/next), the latest snapshot and the left-out list", g.status === 200 && g.json.ok && g.json.root === root && g.json.settings.cadence === "weekly" && g.json.job && typeof g.json.job.nextRunAt === "string" && g.json.latest?.name === newest.name && g.json.snapshots.length === 3 && g.json.leavesOut.secrets.length > 5 && g.json.running === false, g.json);
await new Promise((r) => setTimeout(r, 1100));
let p = await call("POST", { action: "now" });
check("H2 POST now: a new snapshot, the response carries it and the fresh status", p.status === 200 && p.json.ok && p.json.snapshot.reason === "manual" && p.json.latest.name === p.json.snapshot.name && p.json.snapshots.length === 3 && Array.isArray(p.json.manifest.secretsLeftOut), p.json);
p = await call("POST", { action: "wipe" });
check("H3 POST with an unknown action is 400", p.status === 400 && /only "now"/.test(p.json.error));
globalThis.__agentosSnapshotRunning = true;
p = await call("POST", { action: "now" });
globalThis.__agentosSnapshotRunning = false;
check("H4 POST while one is running is 409, nothing taken", p.status === 409 && /already being taken/.test(p.json.error) && T.listSnapshots(root).length === 3);
const bad = await Promise.all([call("PATCH", { cadence: "hourly" }), call("PATCH", { keep: 0 }), call("PATCH", { keep: 2.5 }), call("PATCH", { includeSecrets: "yes" }), call("PATCH", { dir: 7 }), call("PATCH", {}), call("PATCH", { dir: path.join(state, "inside") })]);
check("H5 PATCH validates: cadence, keep (1..200 whole), includeSecrets boolean, dir string, an empty patch, a folder inside the state folder", bad.every((b) => b.status === 400 && typeof b.json.error === "string") && /outside the state folder/.test(bad[6].json.error), bad.map((b) => `${b.status} ${b.json.error}`));
check("H5b a refused folder is not saved; the setting and the job are untouched", S.readSettings().snapshots.dir === "" && J.snapshotJob().enabled === 1 && (await call("GET")).json.root === root);
p = await call("PATCH", { cadence: "monthly", keep: 2, dir: "", includeSecrets: false });
check("H6 PATCH persists, re-syncs the job and prunes to the new keep", p.status === 200 && p.json.ok && S.readSettings().snapshots.cadence === "monthly" && S.readSettings().snapshots.keep === 2 && p.json.job.rrule === C.CADENCE_RRULE.monthly && p.json.pruned.length === 1 && p.json.snapshots.length === 2 && T.listSnapshots(root).length === 2, p.json);
p = await call("PATCH", { cadence: "off" });
check("H7 PATCH cadence off: the job is disabled and the status says so", p.status === 200 && p.json.settings.cadence === "off" && p.json.job.enabled === false && p.json.job.nextRunAt === null);

// ── I ─────────────────────────────────────────────────────────────────────────
const cockpit = read("src/components/v2/home/Cockpit.tsx");
const card = read("src/components/v2/home/SnapshotsCard.tsx");
check("I1 the Health view renders the Snapshots card", cockpit.includes("<SnapshotsCard />") && cockpit.includes('import { SnapshotsCard } from "./SnapshotsCard"'));
check("I2 the card: Snapshot now, Configure, and every knob (Cadence, Snapshot folder, Keep last, Include secrets)", ["Snapshot now", "Configure", ">Cadence<", ">Snapshot folder<", ">Keep last<", ">Include secrets<", "Last snapshot", "Last scheduled run", "none yet", "/api/v2/snapshots"].every((s) => card.includes(s)));
check("I3 the card invents nothing: unknown is said, no Math.random", card.includes('"unknown"') && !/Math\.random/.test(card));
const doc = read("docs/modules/mission-control.md");
check("I4 the Mission Control doc lists the Snapshots controls and what is left out", ["**Snapshots**", "**Snapshot now**", "**Configure**", "Cadence", "Snapshot folder", "Keep last", "Include secrets", "restore.ps1", "secrets.json", "agentos.key", "browser-profiles", ".exile"].every((s) => doc.includes(s)));
check("I5 boot wires the job; settings carries the defaults", read("src/lib/v2/boot.ts").includes("ensureSnapshotJobs()") && /snapshots: \{ cadence: "weekly", dir: "", keep: 8, includeSecrets: false \}/.test(read("src/lib/settings.ts")));
check("I6 the real home was not touched", !fs.existsSync(path.join(os.homedir(), "AgentOS-snapshots")) || os.homedir() === fakeHome);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
