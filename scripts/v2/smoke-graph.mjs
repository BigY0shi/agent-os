// A1.2 smoke: triples/provenance/invalidation/duplicate-move/voice/orphan-cleanup
// over a temp DB. Run: npx tsx scripts/v2/smoke-graph.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmp = path.join(os.tmpdir(), `agentos-smoke-graph-${Date.now()}.db`);
process.env.AGENTIC_OS_DB = tmp;

const { ensureDb, __closeForTests } = await import("../../src/lib/v2/db.ts");
const graph = await import("../../src/lib/v2/memory/graph.ts");
const vector = await import("../../src/lib/v2/memory/vector.ts");

let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
};

ensureDb();

// --- Episodes ---
const ep1 = graph.saveEpisode({
  content: "Yoshi lives in NYC.",
  originalContent: "yo I live in NYC",
  source: "smoke",
  sessionId: "sess-a",
  validAt: "2026-08-01T00:00:00.000Z",
});
const ep2 = graph.saveEpisode({
  content: "Yoshi moved to LA.",
  originalContent: "moved to LA last week",
  source: "smoke",
  sessionId: "sess-a",
  validAt: "2026-08-20T00:00:00.000Z",
});
check("saveEpisode returns uuids", !!ep1 && !!ep2 && ep1 !== ep2);
check("getEpisode round-trip", graph.getEpisode(ep1)?.content === "Yoshi lives in NYC.");

// re-save merges but keeps original_content verbatim
graph.saveEpisode({
  uuid: ep1,
  content: "Yoshi lives in NYC (normalized).",
  originalContent: "MUTATED — must not land",
  source: "smoke",
  sessionId: "sess-a",
  validAt: "2026-08-01T00:00:00.000Z",
});
const ep1Row = graph.getEpisode(ep1);
check("re-save updates content", ep1Row.content === "Yoshi lives in NYC (normalized).");
check("re-save never mutates original_content", ep1Row.originalContent === "yo I live in NYC");

// --- Entities + 2 triples sharing an entity ---
const yoshi = graph.saveEntity({ name: "Yoshi", type: "Person" });
const nyc = graph.saveEntity({ name: "NYC", type: "Place" });
const la = graph.saveEntity({ name: "LA", type: "Place" });
const livesIn = graph.saveEntity({ name: "lives in", type: "Predicate" });

check("findEntityByName COLLATE NOCASE", graph.findEntityByName("yOsHi")?.uuid === yoshi);
check("findEntityByName type filter", graph.findEntityByName("lives in", "Predicate")?.uuid === livesIn);
check("findEntityByName miss -> null", graph.findEntityByName("nobody") === null);

const st1 = graph.saveTriple({
  statement: { fact: "Yoshi lives in NYC", aspect: "Identity", validAt: "2026-08-01T00:00:00.000Z" },
  subjectUuid: yoshi,
  predicateUuid: livesIn,
  objectUuid: nyc,
  episodeUuid: ep1,
});
const st2 = graph.saveTriple({
  statement: { fact: "Yoshi lives in LA", aspect: "Identity", validAt: "2026-08-20T00:00:00.000Z" },
  subjectUuid: yoshi,
  predicateUuid: livesIn,
  objectUuid: la,
  episodeUuid: ep2,
});

// --- Provenance both directions ---
const ep1Stmts = graph.getStatementsForEpisode(ep1);
check("provenance episode->statements", ep1Stmts.length === 1 && ep1Stmts[0].uuid === st1);
check("provenance statement->episodes", JSON.stringify(graph.getEpisodeUuidsForStatement(st2)) === JSON.stringify([ep2]));

const yoshiStmts = graph.getStatementsForEntity(yoshi);
check("shared entity touches both statements", yoshiStmts.length === 2);
const nycStmts = graph.getStatementsForEntity(nyc);
check("object-edge entity finds its statement", nycStmts.length === 1 && nycStmts[0].uuid === st1);

// saveTriple is idempotent on edges (UNIQUE merge)
graph.saveTriple({
  statement: { uuid: st1, fact: "Yoshi lives in NYC", aspect: "Identity", validAt: "2026-08-01T00:00:00.000Z" },
  subjectUuid: yoshi,
  predicateUuid: livesIn,
  objectUuid: nyc,
  episodeUuid: ep1,
});
check("saveTriple edge MERGE idempotent", graph.getStatementsForEpisode(ep1).length === 1);

// --- Contradiction: invalidate st1 by ep2, never delete ---
const invalidated = graph.invalidateStatements([st1], ep2);
check("invalidateStatements updates 1 row", invalidated === 1);
check("default read hides invalidated", graph.getStatement(st1) === null);
const st1Full = graph.getStatement(st1, { includeInvalidated: true });
check("row survives invalidation (append-never-destroy)", !!st1Full && st1Full.invalidatedBy === ep2 && !!st1Full.invalidAt);
check("current split: entity reads exclude invalidated", graph.getStatementsForEntity(yoshi).length === 1);
check("invalidated split: includeInvalidated returns both", graph.getStatementsForEntity(yoshi, { includeInvalidated: true }).length === 2);
check("invalidateStatements second call no-ops (first invalidation wins)", graph.invalidateStatements([st1], ep1) === 0);

const invalidFacts = graph.getEpisodesInvalidFacts([ep1, ep2]);
check("getEpisodesInvalidFacts finds st1", invalidFacts.length === 1 && invalidFacts[0].statementUuid === st1 && invalidFacts[0].invalidAt);

// --- Duplicate statement: delete-without-move throws, move then delete works ---
const st2dup = graph.saveTriple({
  statement: { fact: "Yoshi lives in LA (dup)", aspect: "Identity" },
  subjectUuid: yoshi,
  predicateUuid: livesIn,
  objectUuid: la,
  episodeUuid: ep1,
});
let threw = false;
try {
  graph.deleteStatementAsDuplicate(st2dup);
} catch {
  threw = true;
}
check("delete-without-provenance-move throws", threw);
check("statement intact after refused delete", graph.getStatement(st2dup) !== null);

const moved = graph.moveAllProvenanceToStatement(st2dup, st2);
check("moveAllProvenanceToStatement moved 1 episode", moved === 1);
check("survivor now has both provenance episodes", graph.getEpisodeUuidsForStatement(st2).sort().join(",") === [ep1, ep2].sort().join(","));
graph.deleteStatementAsDuplicate(st2dup);
check("duplicate deleted after move", graph.getStatement(st2dup, { includeInvalidated: true }) === null);

// --- Voice aspects: save / append (dedup) / invalidate ---
const va = graph.saveVoiceAspect({ fact: "Always use bun instead of npm", aspect: "Directive", episodeUuid: ep1 });
check("saveVoiceAspect initial episode list", JSON.stringify(graph.getVoiceAspect(va).episodeUuids) === JSON.stringify([ep1]));
graph.appendVoiceAspectEpisode(va, ep2);
graph.appendVoiceAspectEpisode(va, ep2); // dedup
check("appendVoiceAspectEpisode appends + dedups", JSON.stringify(graph.getVoiceAspect(va).episodeUuids) === JSON.stringify([ep1, ep2]));
check("invalidateVoiceAspects updates 1 row", graph.invalidateVoiceAspects([va], ep2) === 1);
const vaRow = graph.getVoiceAspect(va);
check("voice aspect invalidated not deleted", !!vaRow && vaRow.invalidAt !== null && vaRow.invalidatedBy === ep2);

// --- Orphan entity cleanup (entity row + entity-ns vector) ---
const orphan = graph.saveEntity({ name: "Orphanville", type: "Place" });
const vec = new Array(768).fill(0);
vec[7] = 1;
vector.upsert("entity", orphan, vec);
check("orphan vector present before cleanup", vector.get("entity", orphan) !== null);
const cleanup = graph.orphanEntityCleanup();
check("orphan cleanup removes exactly the orphan", cleanup.count === 1 && cleanup.deletedUuids[0] === orphan);
check("orphan entity row gone", graph.getEntity(orphan) === null);
check("orphan entity vector gone", vector.get("entity", orphan) === null);
check("edged entities survive cleanup", graph.getEntity(yoshi) !== null && graph.getEntity(nyc) !== null);

// --- Session episodes: most recent 5 of 7 ---
for (let i = 0; i < 7; i++) {
  graph.saveEpisode({
    content: `msg ${i}`,
    originalContent: `msg ${i}`,
    source: "smoke",
    sessionId: "sess-b",
    validAt: `2026-08-1${i}T00:00:00.000Z`,
  });
}
const recent = graph.getSessionEpisodes("sess-b");
check("getSessionEpisodes default limit 5", recent.length === 5);
check("getSessionEpisodes newest-first", recent[0].content === "msg 6" && recent[4].content === "msg 2");
check("getSessionEpisodes custom limit", graph.getSessionEpisodes("sess-b", 2).length === 2);

__closeForTests();
try { fs.rmSync(tmp); fs.rmSync(tmp + "-wal", { force: true }); fs.rmSync(tmp + "-shm", { force: true }); } catch {}

console.log(failures === 0 ? "\nsmoke-graph: ALL PASS" : `\nsmoke-graph: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
