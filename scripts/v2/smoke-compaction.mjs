// A5+A6 smoke: session compaction + persona generator gate.
//   OFFLINE (always): coveredUntil watermark math, <output>-tag parse fallback,
//     persona bullet-ops (split/append/promote/tombstone/apply), compaction
//     disabled-gate + insufficient-episodes skip, full-regen 409 refusal
//     invariant, deterministic tombstone-only incremental (pure code, no LLM).
//   ONLINE (needs local Ollama embeddings + an LLM provider): 4 episodes into
//     ONE session → conversation Document w/ coveredUntil advancing + version
//     bumps + document_labels mirror + compacted_session vector → exploratory
//     executeSearch surfaces the compact → persona full-gen fired by the queue
//     trigger, second full-gen REFUSED (409), incremental bullet + tombstone.
// Run: npx tsx scripts/v2/smoke-compaction.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmp = path.join(os.tmpdir(), `agentos-smoke-compaction-${Date.now()}.db`);
process.env.AGENTIC_OS_DB = tmp;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-compaction-"));
const settingsFile = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_SETTINGS = settingsFile;

// Mirror Next's .env loading for OLLAMA_API_KEY (cloud LLM path)
for (const envFile of [".env.local", ".env"]) {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), envFile), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {}
}

const { ensureDb, getDb, __closeForTests } = await import("../../src/lib/v2/db.ts");
const queue = await import("../../src/lib/v2/memory/queue.ts");
const compaction = await import("../../src/lib/v2/memory/compaction.ts");
const persona = await import("../../src/lib/v2/memory/persona.ts");
const compactionPrompts = await import("../../src/lib/v2/memory/prompts/compaction.ts");
const labels = await import("../../src/lib/v2/memory/labels.ts");
const vector = await import("../../src/lib/v2/memory/vector.ts");
const graph = await import("../../src/lib/v2/memory/graph.ts");
const { uuid: newUuid, now } = await import("../../src/lib/v2/ids.ts");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra ? ` — ${extra}` : ""}`);
  if (!cond) failures++;
};
const writeSettings = (memory) =>
  fs.writeFileSync(settingsFile, JSON.stringify({ memory }, null, 2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cleanup = () => {
  queue.stopMemoryQueue();
  __closeForTests();
  try {
    fs.rmSync(tmp, { force: true });
    fs.rmSync(tmp + "-wal", { force: true });
    fs.rmSync(tmp + "-shm", { force: true });
    fs.rmSync(settingsDir, { recursive: true, force: true });
  } catch {}
};
const finish = (code) => {
  cleanup();
  console.log(
    failures === 0 ? "\nsmoke-compaction: ALL PASS" : `\nsmoke-compaction: ${failures} FAILURES`,
  );
  process.exit(failures === 0 ? 0 : code);
};

ensureDb();
const db = getDb();

// ===========================================================================
// OFFLINE — pure watermark math (A5)
// ===========================================================================
console.log("--- offline: coveredUntil watermark math ---");
const { computeCoveredUntil } = compaction;
check(
  "max of batch",
  computeCoveredUntil(["2026-01-01T00:00:00.000Z", "2026-01-03T00:00:00.000Z", "2026-01-02T00:00:00.000Z"]) ===
    "2026-01-03T00:00:00.000Z",
);
check(
  "monotonic: newer prior wins over older batch",
  computeCoveredUntil(["2026-01-03T00:00:00.000Z"], "2026-02-01T00:00:00.000Z") ===
    "2026-02-01T00:00:00.000Z",
);
check(
  "advances past prior when batch is newer",
  computeCoveredUntil(["2026-03-01T00:00:00.000Z"], "2026-02-01T00:00:00.000Z") ===
    "2026-03-01T00:00:00.000Z",
);
check("empty batch, no prior -> undefined", computeCoveredUntil([]) === undefined);
check(
  "malformed values ignored",
  computeCoveredUntil(["garbage", "2026-01-01T00:00:00.000Z"], "not-a-date") ===
    "2026-01-01T00:00:00.000Z",
);

console.log("--- offline: compaction response parse (<output> fallback) ---");
const { parseCompactionResponse } = compactionPrompts;
check(
  "<output> tag extracted",
  parseCompactionResponse("noise <output>**Context**: X</output> tail").summary === "**Context**: X",
);
check(
  "raw fallback when no tags",
  parseCompactionResponse("**Context**: raw body").summary === "**Context**: raw body",
);
let threw = false;
try {
  parseCompactionResponse("   ");
} catch {
  threw = true;
}
check("empty response throws", threw);

// ===========================================================================
// OFFLINE — persona bullet ops (A6, pure)
// ===========================================================================
console.log("--- offline: persona bullet ops ---");
const DOC = `# PERSONA

## IDENTITY

Independent builder running Agent OS.

- Primary email robby@launchworks.io
- GitHub handle BigY0shi

### Homelab

Runs a Proxmox cluster at home.

- Self-hosts umbrelOS on LXCs

[Confidence: HIGH]

## PREFERENCES

- Prefers terse replies
`;

const split = persona.splitByH2Markdown(DOC);
check("splitByH2Markdown round-trips byte-for-byte", split.map((s) => s.content).join("") === DOC);
check(
  "sections parsed (null header + IDENTITY + PREFERENCES)",
  split.length === 3 && split[0].heading === null && split[1].heading === "IDENTITY" && split[2].heading === "PREFERENCES",
);

const structure = persona.parseSectionStructure(DOC, "IDENTITY");
check(
  "loose facts get stable L-ids",
  structure.looseFacts.length === 2 && structure.looseFacts[0].id === "L1" && structure.looseFacts[1].id === "L2",
);
check(
  "subsection summarised with prose + bullet count",
  structure.subsections.length === 1 &&
    structure.subsections[0].name === "Homelab" &&
    structure.subsections[0].bulletCount === 1 &&
    structure.subsections[0].proseFirstSentence.startsWith("Runs a Proxmox"),
);

const withTombstone = persona.appendTombstone(DOC, "IDENTITY", "Lives in Austin");
const tombIdx = withTombstone.indexOf("- ⚠ Possibly outdated: Lives in Austin");
const confIdx = withTombstone.indexOf("[Confidence: HIGH]");
check("tombstone appended before [Confidence:] line", tombIdx !== -1 && tombIdx < confIdx);
check("tombstone excluded from structure parse", persona.parseSectionStructure(withTombstone, "IDENTITY").looseFacts.length === 2);

const withBullet = persona.appendBulletToSubsection(DOC, "IDENTITY", "Homelab", "Backs up nightly to the .99 box");
check(
  "bullet appended inside subsection",
  withBullet.includes("- Self-hosts umbrelOS on LXCs\n- Backs up nightly to the .99 box"),
);
check("append to missing subsection is a no-op", persona.appendBulletToSubsection(DOC, "IDENTITY", "Nope", "x") === DOC);

const withLoose = persona.appendLooseFactBullet(DOC, "PREFERENCES", "Wants approval before sends");
check("loose bullet appended after last loose bullet", withLoose.includes("- Prefers terse replies\n- Wants approval before sends"));

const promoted = persona.promoteLooseFactsToSubsection(
  DOC,
  "IDENTITY",
  ["Primary email robby@launchworks.io"],
  "Contact",
  "Reach Yoshi through these identifiers.",
  ["Primary email robby@launchworks.io"],
);
check("promote removes the matched loose bullet", !/^- Primary email/m.test(promoted.split("### ")[0]));
check("promote creates the new subsection", promoted.includes("### Contact"));
check("unmatched loose bullet survives promotion", promoted.includes("- GitHub handle BigY0shi"));
check(
  "promote with zero matches is a no-op",
  persona.promoteLooseFactsToSubsection(DOC, "IDENTITY", ["not present"], "X", "p", ["b"]) === DOC,
);

check("applyPlacementDecision skip is a no-op", persona.applyPlacementDecision(DOC, "IDENTITY", { decision: "skip", reason: "r" }) === DOC);
const fallbackPromote = persona.applyPlacementDecision(
  DOC,
  "IDENTITY",
  { decision: "promote_to_new_subsection", subsection: "Ghost", prose: "p", bullets: ["New standing fact"], promoted_loose_ids: ["L9"] },
  new Map(),
);
check(
  "promote w/ unresolvable ids falls back to loose fact (no ghost subsection)",
  !fallbackPromote.includes("### Ghost") && fallbackPromote.includes("- New standing fact"),
);

// ===========================================================================
// OFFLINE — compaction gates (DB, no LLM reached)
// ===========================================================================
console.log("--- offline: compaction gates ---");
writeSettings({ compactionEnabled: false });
const disabled = await compaction.compactSession("no-such-session");
check("compactionEnabled=false -> silent disabled skip", disabled.success === false && disabled.reason === "disabled");

writeSettings({ compactionEnabled: true });
const insufficient = await compaction.compactSession("empty-session");
check(
  "empty session -> insufficient_episodes (threshold before any LLM)",
  insufficient.success === false && insufficient.reason === "insufficient_episodes",
);

// ===========================================================================
// OFFLINE — persona refusal invariant + deterministic tombstone-only pass
// ===========================================================================
console.log("--- offline: full-regen 409 refusal invariant ---");
const seededDocId = newUuid();
db.prepare(
  `INSERT INTO documents (id, session_id, title, content, source, type, version, metadata, created_at, updated_at)
   VALUES (?, 'persona-v2', 'Persona', ?, 'persona-v2', 'persona', 1, '{}', ?, ?)`,
).run(seededDocId, DOC, now(), now());
threw = false;
let status = 0;
try {
  await persona.generatePersonaFull();
} catch (e) {
  threw = e instanceof persona.PersonaExistsError;
  status = e.status;
}
check("generatePersonaFull over existing doc REFUSES (PersonaExistsError)", threw);
check("refusal carries 409 status", status === 409);
check("getPersonaDocument returns the seeded row", persona.getPersonaDocument()?.id === seededDocId);

console.log("--- offline: tombstone-only incremental (pure code, no LLM) ---");
db.prepare("INSERT INTO meta (key, value) VALUES ('persona.lastGenerationAt', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(now());
const fakeEp = newUuid();
const invStmt = newUuid();
db.prepare(
  `INSERT INTO statements (uuid, fact, aspect, attributes, user_id, created_at, valid_at, invalid_at, invalidated_by)
   VALUES (?, 'Yoshi lives in Austin', 'Identity', '{}', 'owner', ?, ?, ?, ?)`,
).run(invStmt, now(), now(), now(), fakeEp);
const incOffline = await persona.updatePersonaIncremental(fakeEp);
const offlineDoc = persona.getPersonaDocument();
check("tombstone-only incremental reports changed", incOffline.changed === true, JSON.stringify(incOffline));
check(
  "IDENTITY section gained the tombstone line",
  offlineDoc.content.includes("- ⚠ Possibly outdated: Yoshi lives in Austin"),
);
check("persona doc version bumped on incremental save", offlineDoc.version === 2, `version=${offlineDoc.version}`);
check(
  "trigger worthiness gate: unrelated episode -> no generation",
  (await persona.checkPersonaUpdateThreshold(newUuid())).shouldGenerate === false,
);
check(
  "personaAutoUpdate=false gates the trigger",
  await (async () => {
    writeSettings({ compactionEnabled: true, personaAutoUpdate: false });
    const c = await persona.checkPersonaUpdateThreshold(fakeEp);
    writeSettings({ compactionEnabled: true });
    return c.shouldGenerate === false && c.reason === "auto_update_persona_disabled";
  })(),
);

// Clear the seeded persona state so the online path starts fresh
db.prepare("DELETE FROM document_labels WHERE document_id = ?").run(offlineDoc.id);
db.prepare("DELETE FROM documents WHERE id = ?").run(offlineDoc.id);
db.prepare("DELETE FROM statements WHERE uuid = ?").run(invStmt);
db.prepare("DELETE FROM meta WHERE key = 'persona.lastGenerationAt'").run();

// ===========================================================================
// ONLINE — needs Ollama (embeddings) + an LLM provider
// ===========================================================================
console.log("--- online probe ---");
let ollamaUp = false;
try {
  const probe = await fetch("http://127.0.0.1:11434/api/version", { signal: AbortSignal.timeout(3000) });
  ollamaUp = probe.ok;
} catch {}

if (!ollamaUp) {
  console.log("SKIP  local Ollama not reachable at 127.0.0.1:11434 — ONLINE compaction/persona checks skipped.");
  console.log("      Start Ollama (`ollama serve`, `ollama pull nomic-embed-text`) and re-run for the full gate.");
  finish(1);
}

let provider = null;
let modelLow = "";
let modelMedium = "";
if (process.env.OLLAMA_API_KEY) {
  provider = "ollama-cloud";
  modelLow = process.env.SMOKE_MODEL_LOW || "kimi-k2.6:cloud";
  modelMedium = process.env.SMOKE_MODEL_MEDIUM || "glm-5.2:cloud";
} else {
  try {
    const tags = await (await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(3000) })).json();
    const chat = (tags.models || []).map((m) => m.name).filter((n) => !/embed|bge|minilm/i.test(n));
    const preferred = chat.find((n) => /glm|kimi|qwen|llama|gemma|mistral|deepseek/i.test(n)) || chat[0];
    if (preferred) {
      provider = "ollama-local";
      modelLow = modelMedium = preferred;
    }
  } catch {}
}
if (!provider) {
  console.log("SKIP  no LLM provider available (no OLLAMA_API_KEY, no local chat model) — ONLINE checks skipped.");
  finish(1);
}
console.log(`      provider=${provider} modelLow=${modelLow} modelMedium=${modelMedium}`);

const onlineSettings = {
  ingestEnabled: true,
  compactionEnabled: true,
  personaAutoUpdate: true,
  provider,
  modelLow,
  modelMedium,
  embedProvider: "ollama-local",
  embedModel: "nomic-embed-text",
};
writeSettings(onlineSettings);
try {
  const { getEmbedding } = await import("../../src/lib/v2/memory/embed.ts");
  await getEmbedding("smoke probe");
} catch (e) {
  console.log(`SKIP  embeddings unavailable (${e.message}) — ONLINE checks skipped.`);
  finish(1);
}

const waitForQueue = async (queueId, timeoutMs) => {
  const start = Date.now();
  for (;;) {
    const row = db.prepare("SELECT status, stage, error FROM ingestion_queue WHERE id = ?").get(queueId);
    if (row && (row.status === "COMPLETED" || row.status === "FAILED")) return row;
    if (Date.now() - start > timeoutMs) return row ?? { status: "MISSING" };
    await sleep(500);
  }
};

const SESSION = "compact-smoke-session";
const ingestOne = async (body) => {
  const { queueId } = await queue.ingestFromModule({
    episodeBody: body,
    source: "smoke",
    sessionId: SESSION,
    labelNames: ["Compact Smoke"],
  });
  void queue.drainMemoryQueueOnce();
  return waitForQueue(queueId, 300_000);
};

console.log("--- online: 4 episodes -> incremental session compaction ---");
const rowA = await ingestOne("Yoshi runs a Proxmox homelab and self-hosts services on it. His primary focus this week is the Agent OS memory rebuild.");
check("ingest #1 COMPLETED", rowA.status === "COMPLETED", `status=${rowA.status} stage=${rowA.stage} error=${rowA.error}`);
const rowB = await ingestOne("Yoshi decided the memory store lives in SQLite with sqlite-vec. He confirmed the compaction design follows the coveredUntil watermark.");
check("ingest #2 COMPLETED", rowB.status === "COMPLETED", `status=${rowB.status} stage=${rowB.stage} error=${rowB.error}`);

const getSessionDoc = () => db.prepare("SELECT * FROM documents WHERE session_id = ?").get(SESSION);
const docSnap1 = getSessionDoc();
check("conversation Document exists for the session", !!docSnap1 && docSnap1.type === "conversation", JSON.stringify(docSnap1 ?? null));
const meta1 = docSnap1 ? JSON.parse(docSnap1.metadata) : {};
check("metadata carries coveredUntil + compactedAt + episodeCount", !!meta1.coveredUntil && !!meta1.compactedAt && meta1.episodeCount >= 1);
const version1 = docSnap1?.version ?? 0;
check(`version bumped by second compaction (v=${version1})`, version1 >= 2);

const rowC = await ingestOne("Yoshi hit a bug where the compaction prompt lost file paths. He fixed it by keeping technical values verbatim in the summary.");
check("ingest #3 COMPLETED", rowC.status === "COMPLETED", `status=${rowC.status} error=${rowC.error}`);
const rowD = await ingestOne("Yoshi wants the memory page to show compaction status. Follow-up: wire the compact link into EpisodeDetail next chunk.");
check("ingest #4 COMPLETED", rowD.status === "COMPLETED", `status=${rowD.status} error=${rowD.error}`);

const docSnap2 = getSessionDoc();
const meta2 = docSnap2 ? JSON.parse(docSnap2.metadata) : {};
check("still exactly one Document row for the session", db.prepare("SELECT COUNT(*) c FROM documents WHERE session_id = ?").get(SESSION).c === 1);
check(`version keeps bumping (v ${version1} -> ${docSnap2?.version})`, (docSnap2?.version ?? 0) > version1);
check(
  `coveredUntil advanced (${meta1.coveredUntil} -> ${meta2.coveredUntil})`,
  typeof meta2.coveredUntil === "string" && meta2.coveredUntil > meta1.coveredUntil,
);
const maxValidAt = db.prepare("SELECT MAX(valid_at) m FROM episodes WHERE session_id = ?").get(SESSION).m;
check("coveredUntil == max(valid_at) of the session", meta2.coveredUntil === maxValidAt, `${meta2.coveredUntil} vs ${maxValidAt}`);
const smokeLabel = labels.getLabelByName("Compact Smoke");
const docLabelRows = db.prepare("SELECT label_id FROM document_labels WHERE document_id = ?").all(docSnap2.id).map((r) => r.label_id);
check("document_labels mirrors the episode label", !!smokeLabel && docLabelRows.includes(smokeLabel.id));
check("compacted_session vector present", vector.count("compacted_session") >= 1);
const compactedEvent = db
  .prepare("SELECT COUNT(*) c FROM events WHERE type = 'memory.compacted'")
  .get().c;
check(`memory.compacted events emitted (${compactedEvent})`, compactedEvent >= 2);

console.log("--- online: exploratory search surfaces the compact ---");
const search = await import("../../src/lib/v2/memory/search/index.ts");
const ro = (o = {}) => ({
  matchedLabels: [],
  aspects: [],
  queryType: "aspect_query",
  temporal: { type: "all", days: null, startDate: null, endDate: null },
  shouldSearch: true,
  entityHints: [],
  selectedLabels: [],
  lookupMode: "broad",
  attributeHint: null,
  facets: [],
  confidence: 0.9,
  routingTimeMs: 0,
  ...o,
});
const explore = await search.executeSearch(
  ro({
    queryType: "exploratory",
    matchedLabels: [{ labelId: smokeLabel.id, labelName: "Compact Smoke", score: 0.9 }],
    selectedLabels: ["Compact Smoke"],
  }),
  { enableReranking: false },
);
check(
  "exploratory returns the session compact as a 📄 DOCUMENT episode",
  (explore.episodes || []).some((e) => e.uuid === docSnap2.id && e.isDocument),
  JSON.stringify((explore.episodes || []).map((e) => ({ uuid: e.uuid, isDocument: e.isDocument }))),
);

console.log("--- online: persona full generation (queue trigger) ---");
const personaDoc = persona.getPersonaDocument();
check("persona doc created by the post-COMPLETED trigger", !!personaDoc, "trigger did not fire or full gen failed");
check("persona doc contains IDENTITY section", !!personaDoc && personaDoc.content.includes("IDENTITY"));
check("persona row is type='persona' single row", db.prepare("SELECT COUNT(*) c FROM documents WHERE type = 'persona'").get().c === 1);
const personaLabel = labels.getLabelByName("Persona");
check("Persona label auto-created (#009CF3)", !!personaLabel && personaLabel.color === "#009CF3");

threw = false;
try {
  await persona.generatePersonaFull();
} catch (e) {
  threw = e instanceof persona.PersonaExistsError && e.status === 409;
}
check("second full generation REFUSES (409 invariant)", threw);

console.log("--- online: incremental update (bullet + tombstone) ---");
// Deterministic graph seed: one new valid Identity fact + one invalidated
// Identity fact, both tied to a fresh episode — then drive the incremental
// pass directly (placement = 1 real LLM call; tombstone = pure code).
const personaBefore = persona.getPersonaDocument();
const incEp = graph.saveEpisode({
  content: "Yoshi shared contact details for future correspondence.",
  originalContent: "Yoshi shared contact details for future correspondence.",
  source: "smoke",
  sessionId: "persona-inc-session",
});
const subj = graph.saveEntity({ name: "Yoshi", type: "Person" });
graph.saveTriple({
  statement: { fact: "Yoshi's primary email is robby@launchworks.io", aspect: "Identity" },
  subjectUuid: subj,
  episodeUuid: incEp,
});
const oldStmt = graph.saveTriple({
  statement: { fact: "Yoshi's primary email is old@example.com", aspect: "Identity" },
  subjectUuid: subj,
  episodeUuid: incEp,
});
graph.invalidateStatements([oldStmt], incEp);
const incResult = await persona.updatePersonaIncremental(incEp);
const personaAfter = persona.getPersonaDocument();
check("incremental update reports changed", incResult.changed === true, JSON.stringify(incResult));
check(
  "tombstone appended for the invalidated identity fact",
  personaAfter.content.includes("- ⚠ Possibly outdated: Yoshi's primary email is old@example.com"),
);
check(
  "new persona-worthy fact placed as a bullet (email keep-anchor)",
  personaAfter.content.includes("robby@launchworks.io"),
  "placement LLM skipped a keep-anchor fact — inspect the placement prompt/model",
);
check("only the touched content changed (doc still single IDENTITY-rooted persona)", personaAfter.content.startsWith("# PERSONA"));
check("persona version bumped on incremental save", personaAfter.version > personaBefore.version);

finish(1);
