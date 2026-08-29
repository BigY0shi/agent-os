// F1.2/F1.3 smoke: open temp DB via AGENTIC_OS_DB, assert schema, idempotent re-run,
// vec KNN sanity. Run: npx tsx scripts/v2/smoke-db.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmp = path.join(os.tmpdir(), `agentos-smoke-${Date.now()}.db`);
process.env.AGENTIC_OS_DB = tmp;

const { ensureDb, __closeForTests, dbPath } = await import("../../src/lib/v2/db.ts");

let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
};

check("dbPath honors AGENTIC_OS_DB", dbPath() === tmp);

let db = ensureDb();

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')")
  .all()
  .map((r) => r.name);
for (const t of [
  "migrations", "meta", "events", "jobs", "ingestion_queue", "ingestion_rules",
  "episodes", "entities", "statements", "edges", "labels", "episode_labels",
  "document_labels", "voice_aspects", "documents", "recall_logs",
  "vec_episode", "vecmap_episode", "vec_statement", "vec_entity",
  "vec_label", "vec_voice_aspect", "vec_compacted_session",
]) {
  check(`table ${t}`, tables.includes(t));
}

const meta = Object.fromEntries(
  db.prepare("SELECT key, value FROM meta").all().map((r) => [r.key, r.value]),
);
check("meta.embed_dim = 768", meta.embed_dim === "768");
check("meta.embed_model set", !!meta.embed_model);

const versions = db.prepare("SELECT version FROM migrations ORDER BY version").all().map((r) => r.version);
// Later workstreams append to MIGRATIONS (020-029 = SPEC-B, …) — assert the
// foundations applied and the ledger is strictly increasing, not an exact list.
check("migrations 1,2 applied", versions.includes(1) && versions.includes(2));
check("migration versions strictly increasing", versions.every((v, i) => i === 0 || v > versions[i - 1]));

// Idempotent re-open (fresh process state simulated by closing the singleton)
__closeForTests();
db = ensureDb();
const versions2 = db.prepare("SELECT version FROM migrations").all().length;
check("re-open idempotent (same migration count)", versions2 === versions.length);

// agent_id column present on episodes (CONVENTIONS §4)
const epCols = db.prepare("PRAGMA table_info(episodes)").all().map((r) => r.name);
check("episodes.agent_id column", epCols.includes("agent_id"));

// vec KNN sanity with the vecmap join pattern (BigInt rowids — the discovered gotcha)
const buf = (a) => Buffer.from(new Float32Array(a).buffer);
const dim = 768;
const mk = (seed) => {
  const v = new Array(dim).fill(0);
  v[seed] = 1;
  return v;
};
const near = new Array(dim).fill(0);
near[0] = 0.9; near[1] = 0.1;
const n = Math.hypot(0.9, 0.1);
const nearN = near.map((x) => x / n);

const insVec = db.prepare("INSERT INTO vec_episode(rowid, embedding) VALUES (?, ?)");
const insMap = db.prepare("INSERT INTO vecmap_episode(rowid, uuid) VALUES (?, ?)");
insVec.run(1n, buf(mk(0))); insMap.run(1n, "ep-identical");
insVec.run(2n, buf(nearN)); insMap.run(2n, "ep-near");
insVec.run(3n, buf(mk(5))); insMap.run(3n, "ep-orthogonal");

const rows = db
  .prepare(
    `SELECT m.uuid, v.distance FROM vec_episode v
     JOIN vecmap_episode m ON m.rowid = v.rowid
     WHERE v.embedding MATCH ? AND k = 3 ORDER BY v.distance`,
  )
  .all(buf(mk(0)));

check("KNN nearest-first order", rows[0].uuid === "ep-identical" && rows[1].uuid === "ep-near" && rows[2].uuid === "ep-orthogonal");
check("cosine d(identical)=0", Math.abs(rows[0].distance) < 1e-6);
// hand-computed: 1 - 0.9/sqrt(0.82) = 0.0061163...
check("cosine d(near) ≈ 0.006116 (hand-computed)", Math.abs(rows[1].distance - 0.0061163) < 1e-4);
check("cosine d(orthogonal)=1", Math.abs(rows[2].distance - 1) < 1e-6);
// sim = 1 - distance (CONVENTIONS §10)
check("similarity formula 1-d gives 0.9938 for near", Math.abs(1 - rows[1].distance - 0.9938837) < 1e-4);

__closeForTests();
try { fs.rmSync(tmp); fs.rmSync(tmp + "-wal", { force: true }); fs.rmSync(tmp + "-shm", { force: true }); } catch {}

console.log(failures === 0 ? "\nsmoke-db: ALL PASS" : `\nsmoke-db: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
