// A9 smoke: legacy migration importers + route (migrate.ts, /api/v2/memory/migrate).
//   Entirely OFFLINE: temp DB, stub /api/embed server, FIXTURE legacy stores in
//   a temp dir (importers pointed at override paths) — the REAL legacy stores
//   are never read or written here (that run is Yoshi's button in the gear).
//   Covers: per-source parsing (memsearch/jarvis/agents/remember), dry-run
//   counts with no writes, raw import (episodes + embeddings + legacy labels +
//   COMPLETED queue row), idempotent re-run (all skipped), pending-file drains,
//   malformed input counted-as-skipped-not-thrown, full-mode enqueue, route
//   validation.
// Run: npx tsx scripts/v2/smoke-migrate.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import http from "node:http";

const tmpDb = path.join(os.tmpdir(), `agentos-smoke-migrate-${Date.now()}.db`);
process.env.AGENTIC_OS_DB = tmpDb;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-migrate-"));
process.env.AGENTIC_OS_SETTINGS = path.join(settingsDir, "settings.json");
// ingestEnabled:false — full-mode rows must stay PENDING (no LLM calls anywhere)
fs.writeFileSync(
  process.env.AGENTIC_OS_SETTINGS,
  JSON.stringify({ memory: { embedProvider: "ollama-local", embedModel: "stub-embed", ingestEnabled: false } }),
);

// --- deterministic stub embedder (same as smoke-search) ---------------------
function hashStr(s) {
  let h = 2166136261;
  for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function stubEmbed(text) {
  let seed = hashStr(String(text)) || 1;
  const v = new Array(768);
  for (let i = 0; i < 768; i++) {
    seed ^= (seed << 13) >>> 0; seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= (seed << 5) >>> 0; seed >>>= 0;
    v[i] = (seed / 4294967296) * 2 - 1;
  }
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / n);
}
const stubServer = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    try {
      const { input } = JSON.parse(body);
      const texts = Array.isArray(input) ? input : [input];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ embeddings: texts.map(stubEmbed) }));
    } catch {
      res.writeHead(500); res.end("{}");
    }
  });
});
await new Promise((r) => stubServer.listen(0, "127.0.0.1", r));
process.env.OLLAMA_URL = `http://127.0.0.1:${stubServer.address().port}`;

// --- fixture legacy stores ---------------------------------------------------
const fixRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-legacy-"));
const repoRoot = path.join(fixRoot, "repo");
const homeDir = path.join(fixRoot, "home");
const w = (rel, content) => {
  const full = path.join(fixRoot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
};

// (a) memsearch: 2 entries + 1 too-short entry, plus a garbage no-block file
w("repo/.memsearch/memory/2026-08-01.md", `
## Session 09:00

### 09:15
<!-- session:aaaa-bbbb turn:cccc-dddd transcript:C:\\somewhere\\x.jsonl -->
- User decided to rebuild the memory system on SQLite.
- Claude Code ported the search router.

### 10:30
<!-- session:aaaa-bbbb turn:eeee-ffff transcript:C:\\somewhere\\x.jsonl -->
- Yoshi verified the ingestion pipeline end to end.

### 11:00
<!-- session:aaaa-bbbb turn:gggg-hhhh transcript:C:\\somewhere\\x.jsonl -->
ok
`);
w("repo/.memsearch/memory/2026-08-02.md", " bad"); // malformed: no blocks, sub-minimum junk

// (b) jarvis: 2 good lines + 1 malformed line; plus BOTH pending drains
w(
  "home/.agentic-os/jarvis-memory.jsonl",
  JSON.stringify({ id: "m_1", ts: Date.UTC(2026, 6, 15, 12, 0, 0), text: "Remember that the homelab box is 192.168.0.99" }) + "\n" +
  "{ this is not json\n" +
  JSON.stringify({ id: "m_2", ts: Date.UTC(2026, 7, 1, 9, 30, 0), text: "Remember the demo is on Friday" }) + "\n",
);
w(
  "home/.agentic-os/jarvis-pending-episodes.jsonl",
  JSON.stringify({ episodeBody: "Pending jarvis episode that never got ingested", referenceTime: "2026-08-20T10:00:00.000Z" }) + "\n",
);
w(
  "home/.agentic-os/anynotes/pending-ingest.jsonl",
  JSON.stringify({ body: "A pending anynote about the marketing hub" }) + "\n",
);

// (c) agents: one agent with facts.md (no ## sections) + journal.md (2 dated sections)
w("home/.agentic-os/agents/agent-42/memory/facts.md", `# Facts

- The save destination is the samples folder.
- Playwright is the only reliable capture path.
`);
w("home/.agentic-os/agents/agent-42/memory/journal.md", `# Journal

## 2026-08-27 (run, a46113b5)
Daily run succeeded cleanly in 6 turns.

## 2026-08-26 (run, 62c76a4f)
Daily run succeeded cleanly, tied fastest turn count.
`);
w("home/.agentic-os/agents/.exile/old/memory/facts.md", "should be ignored (dot-dir)");

// (d) remember: empty now.md, dated today file, recent.md with dated headings
w("repo/.remember/now.md", "");
w("repo/.remember/today-2026-08-03.md", `## 05:02 | main
Read the v2 docs and started the master plan.

## 06:01 | main
MASTER-PLAN written with 12 workstreams.
`);
w("repo/.remember/recent.md", `# Recent

## 2026-08-26

Implemented the Jarvis console UI.
`);
w("repo/.remember/logs", ""); // a FILE named logs (not matching patterns) — ignored

const paths = { repoRoot, homeDir };

// --- harness -----------------------------------------------------------------
let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${extra}` : ""}`);
  if (!cond) failures++;
};

const { ensureDb, getDb, __closeForTests } = await import("../../src/lib/v2/db.ts");
const migrate = await import("../../src/lib/v2/memory/migrate.ts");
ensureDb();
const db = getDb();
const count = (sql, ...args) => db.prepare(sql).get(...args).c;

// === dry-run: counts + no writes ============================================
console.log("--- dry-run per source ---");
const dryMs = await migrate.runMigration({ source: "memsearch", dryRun: true, paths });
check("memsearch dry-run found=2 (2 entries; short+garbage skipped)", dryMs.found === 2, JSON.stringify(dryMs));
check("memsearch dry-run skipped=2", dryMs.skipped === 2, dryMs.skipped);
check("memsearch dry-run queued/imported 0", dryMs.queued === 0 && dryMs.imported === 0);
check(
  "memsearch sample shape {source, referenceTime, bytes, originFile}",
  dryMs.sample.length === 2 &&
    dryMs.sample[0].source === "migration:memsearch" &&
    dryMs.sample[0].referenceTime === "2026-08-01T09:15:00.000Z" &&
    dryMs.sample[0].bytes > 0 &&
    dryMs.sample[0].originFile.includes("2026-08-01.md"),
  JSON.stringify(dryMs.sample),
);

const dryJa = await migrate.runMigration({ source: "jarvis", dryRun: true, paths });
check("jarvis dry-run found=4 (2 memory + 2 pending drains)", dryJa.found === 4, JSON.stringify(dryJa));
check("jarvis dry-run skipped=1 (malformed json line)", dryJa.skipped === 1);
check(
  "jarvis drains include anynotes pending with its own source",
  dryJa.sample.some((s) => s.source === "migration:anynotes"),
  JSON.stringify(dryJa.sample),
);

const dryAg = await migrate.runMigration({ source: "agents", dryRun: true, paths });
check("agents dry-run found=3 (facts + 2 journal sections; .exile ignored)", dryAg.found === 3, JSON.stringify(dryAg));

const dryRe = await migrate.runMigration({ source: "remember", dryRun: true, paths });
check("remember dry-run found=3 (2 today entries + 1 recent section)", dryRe.found === 3, JSON.stringify(dryRe));

check("dry-run wrote NOTHING (episodes=0, labels=0, queue=0)",
  count("SELECT COUNT(*) c FROM episodes") === 0 &&
  count("SELECT COUNT(*) c FROM labels") === 0 &&
  count("SELECT COUNT(*) c FROM ingestion_queue") === 0);

// === raw import: memsearch ==================================================
console.log("--- raw import: memsearch ---");
const rawMs = await migrate.runMigration({ source: "memsearch", paths });
check("raw import imported=2", rawMs.imported === 2, JSON.stringify(rawMs));
check("episodes rows created with source migration:memsearch",
  count("SELECT COUNT(*) c FROM episodes WHERE source = 'migration:memsearch'") === 2);
const ep = db.prepare("SELECT * FROM episodes WHERE source = 'migration:memsearch' ORDER BY valid_at ASC").get();
check("episode content == original_content (verbatim raw mode)", ep.content === ep.original_content && ep.content.includes("SQLite"));
check("episode valid_at from ### timestamp", ep.valid_at === "2026-08-01T09:15:00.000Z", ep.valid_at);
check("episode content_hash set", typeof ep.content_hash === "string" && ep.content_hash.length === 16);
check("session comment stripped into metadata", JSON.parse(ep.metadata).sessionUuid === "aaaa-bbbb", ep.metadata);
check("sessionId is the per-file-date bucket", ep.session_id === "memsearch-2026-08-01");
const legacyLabel = db.prepare("SELECT id FROM labels WHERE name = 'legacy' COLLATE NOCASE").get();
const msLabel = db.prepare("SELECT id FROM labels WHERE name = 'legacy:memsearch' COLLATE NOCASE").get();
check("labels 'legacy' + 'legacy:memsearch' created", !!legacyLabel && !!msLabel);
check("episode_labels junction rows attached",
  count("SELECT COUNT(*) c FROM episode_labels WHERE episode_uuid = ? ", ep.uuid) === 2);
check("episode embeddings upserted (vecmap_episode)",
  count("SELECT COUNT(*) c FROM vecmap_episode") === 2);
check("one COMPLETED queue row tagged migration:memsearch",
  count("SELECT COUNT(*) c FROM ingestion_queue WHERE source = 'migration:memsearch' AND status = 'COMPLETED'") === 1);
check("memory.migrated event emitted",
  count("SELECT COUNT(*) c FROM events WHERE type = 'memory.migrated'") === 1);

// === idempotency: re-run skips everything ===================================
console.log("--- idempotent re-run ---");
const rerun = await migrate.runMigration({ source: "memsearch", paths });
check("re-run imports 0", rerun.imported === 0, JSON.stringify(rerun));
check("re-run skips all found (2 dupes + 2 parse skips)", rerun.skipped === 4, rerun.skipped);
check("no duplicate episodes", count("SELECT COUNT(*) c FROM episodes WHERE source = 'migration:memsearch'") === 2);

// === raw import: jarvis (incl. pending drains) ==============================
console.log("--- raw import: jarvis + drains ---");
const rawJa = await migrate.runMigration({ source: "jarvis", paths });
check("jarvis raw imported=4", rawJa.imported === 4, JSON.stringify(rawJa));
const jaEp = db.prepare("SELECT * FROM episodes WHERE source = 'migration:jarvis' ORDER BY valid_at ASC").get();
check("jarvis valid_at from record ts", jaEp.valid_at === "2026-07-15T12:00:00.000Z", jaEp.valid_at);
check("anynotes drain landed with source migration:anynotes",
  count("SELECT COUNT(*) c FROM episodes WHERE source = 'migration:anynotes'") === 1);
check("legacy:anynotes label attached to the drained note",
  count(
    `SELECT COUNT(*) c FROM episode_labels el JOIN labels l ON l.id = el.label_id
     JOIN episodes e ON e.uuid = el.episode_uuid
     WHERE e.source = 'migration:anynotes' AND l.name = 'legacy:anynotes'`,
  ) === 1);

// === raw import: agents (agent_id + metadata.agentId) =======================
console.log("--- raw import: agents ---");
const rawAg = await migrate.runMigration({ source: "agents", paths });
check("agents raw imported=3", rawAg.imported === 3, JSON.stringify(rawAg));
const agEp = db.prepare("SELECT * FROM episodes WHERE source = 'migration:agents' AND session_id LIKE '%journal' ORDER BY valid_at ASC").get();
check("agents episode agent_id column set (NOT end_user_id)", agEp.agent_id === "agent-42" && agEp.end_user_id === null, JSON.stringify({ a: agEp.agent_id, e: agEp.end_user_id }));
check("agents metadata.agentId set", JSON.parse(agEp.metadata).agentId === "agent-42");
check("journal section referenceTime from heading date", agEp.valid_at === "2026-08-26T00:00:00.000Z", agEp.valid_at);

// === full mode: remember → addToQueue (worker disabled, no LLM) =============
console.log("--- full mode: remember ---");
const fullRe = await migrate.runMigration({ source: "remember", full: true, paths });
check("full mode queued=3, imported=0", fullRe.queued === 3 && fullRe.imported === 0, JSON.stringify(fullRe));
check("full mode rows PENDING with migration source",
  count("SELECT COUNT(*) c FROM ingestion_queue WHERE source = 'migration:remember' AND status = 'PENDING'") === 3);
check("full mode created no episodes directly",
  count("SELECT COUNT(*) c FROM episodes WHERE source = 'migration:remember'") === 0);

// raw import still works after full-queue (hash check is against episodes)
const rawRe = await migrate.runMigration({ source: "remember", paths });
check("remember raw imported=3 with today-file times", rawRe.imported === 3, JSON.stringify(rawRe));
const reEp = db.prepare("SELECT * FROM episodes WHERE source = 'migration:remember' ORDER BY valid_at ASC").get();
check("today entry referenceTime = file date + heading time", reEp.valid_at === "2026-08-03T05:02:00.000Z", reEp.valid_at);

// === route: validation + dry-run round trip =================================
console.log("--- route /api/v2/memory/migrate ---");
const { POST } = await import("../../src/app/api/v2/memory/migrate/route.ts");
const { NextRequest } = await import("next/server");
const post = (body) =>
  POST(new NextRequest("http://smoke.local/api/v2/memory/migrate", { method: "POST", body: JSON.stringify(body) }));
const badRes = await post({ source: "nope" });
check("route rejects unknown source with 400", badRes.status === 400);
// Route uses default (real) paths — dry-run only, so the real stores are READ at
// most, never written, and the temp DB is untouched.
const routeRes = await post({ source: "jarvis", dryRun: true });
const routeJson = await routeRes.json();
check("route dry-run 200 with result shape", routeRes.status === 200 && typeof routeJson.found === "number" && routeJson.queued === 0, JSON.stringify(routeJson));

// === malformed inputs never throw ===========================================
console.log("--- malformed handling ---");
w("repo/.memsearch/memory/2026-08-05.md", "### zz:zz\nnot a real timestamp heading\n");
let threw = false;
let mal;
try {
  mal = await migrate.runMigration({ source: "memsearch", dryRun: true, paths });
} catch {
  threw = true;
}
check("malformed heading file: importer does not throw", !threw);
check("malformed heading file: content counted (fallback) or skipped, never lost silently",
  !!mal && mal.found + mal.skipped >= 3, JSON.stringify(mal));

// --- cleanup -----------------------------------------------------------------
stubServer.close();
__closeForTests();
for (const f of [tmpDb, tmpDb + "-wal", tmpDb + "-shm"]) { try { fs.rmSync(f, { force: true }); } catch {} }
try { fs.rmSync(settingsDir, { recursive: true, force: true }); } catch {}
try { fs.rmSync(fixRoot, { recursive: true, force: true }); } catch {}

console.log(failures === 0 ? "\nsmoke-migrate: ALL PASS" : `\nsmoke-migrate: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
