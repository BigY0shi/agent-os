// §9.2 golden-queries — THE A-phase quality gate. Run anytime:
//   npx tsx scripts/v2/golden-queries.mjs
//
// Fresh temp DB (AGENTIC_OS_DB/AGENTIC_OS_SETTINGS set BEFORE imports).
// Requires Ollama: local embeddings at 127.0.0.1:11434 + an LLM provider
// (OLLAMA_API_KEY → cloud, else a local chat model). If either is missing the
// script SKIPS LOUDLY and exits 0 — it is a gate, not a unit test.
//
// Seeds ~8 episodes across 4 sessions through the REAL pipeline
// (ingestFromModule + drainMemoryQueueOnce): preferences, a decision with
// reasoning, a contradiction pair, a future-dated Event, two people + a
// project, a counterparty-scoped episode, and a 3-episode session dense
// enough to trigger compaction. Then runs the SPEC-A §9.2 case table via
// searchV2 and prints a scorecard. Exit 1 on any FAIL.
//
// Assertions are content-first (the fact must appear in the results) with the
// router classification printed as info — model nondeterminism must not flake
// the gate, but a lost fact must fail it.
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDb = path.join(os.tmpdir(), `agentos-golden-${Date.now()}.db`);
process.env.AGENTIC_OS_DB = tmpDb;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-golden-"));
const settingsFile = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_SETTINGS = settingsFile;

// Mirror Next's .env loading for OLLAMA_API_KEY (cloud provider path)
for (const envFile of [".env.local", ".env"]) {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), envFile), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {}
}

const skip = (msg) => {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║ golden-queries: SKIPPED — " + msg);
  console.log("║ This gate needs Ollama. Start it and re-run before declaring ║");
  console.log("║ the A-phase APIs frozen.                                     ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  process.exit(0);
};

// --- Ollama probe ------------------------------------------------------------
let ollamaUp = false;
try {
  const probe = await fetch("http://127.0.0.1:11434/api/version", { signal: AbortSignal.timeout(3000) });
  ollamaUp = probe.ok;
} catch {}
if (!ollamaUp) skip("local Ollama not reachable at 127.0.0.1:11434");

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
    if (preferred) { provider = "ollama-local"; modelLow = modelMedium = preferred; }
  } catch {}
}
if (!provider) skip("no LLM provider (no OLLAMA_API_KEY, no local chat model)");
console.log(`golden-queries: provider=${provider} modelLow=${modelLow} modelMedium=${modelMedium}`);

fs.writeFileSync(
  settingsFile,
  JSON.stringify({
    memory: {
      provider, modelLow, modelMedium,
      embedProvider: "ollama-local", embedModel: "nomic-embed-text",
      ingestEnabled: true, compactionEnabled: true,
      personaAutoUpdate: false, // persona is not under test — save its LLM calls
    },
  }, null, 2),
);

const { ensureDb, getDb, __closeForTests } = await import("../../src/lib/v2/db.ts");
ensureDb();
const db = getDb();

try {
  const { getEmbedding } = await import("../../src/lib/v2/memory/embed.ts");
  await getEmbedding("golden probe");
} catch (e) {
  __closeForTests();
  skip(`embeddings unavailable (${e.message}) — ollama pull nomic-embed-text`);
}

const queue = await import("../../src/lib/v2/memory/queue.ts");
const search = await import("../../src/lib/v2/memory/search/index.ts");

// --- LLM-call counter: wrap fetch, count chat-completion POSTs ---------------
const realFetch = globalThis.fetch;
let llmCalls = 0;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (/\/api\/chat|\/v1\/chat\/completions|\/text\/chatcompletion/i.test(url)) llmCalls++;
  return realFetch(input, init);
};

// ============================================================================
// Fixture corpus — seeded through the REAL pipeline
// ============================================================================
const DAY = 86_400_000;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const futureDate = new Date(Date.now() + 10 * DAY).toISOString().slice(0, 10);

const FIXTURES = [
  // S1 — dense project session (3 episodes → compaction + compact-replacement)
  { sessionId: "golden-s1", referenceTime: iso(3 * DAY), labelNames: ["Nova Project"],
    episodeBody: "Yoshi kicked off the Project Nova rebuild. He decided to build Project Nova's memory layer on SQLite instead of Neo4j because Neo4j was too heavy to self-host on the homelab." },
  { sessionId: "golden-s1", referenceTime: iso(2 * DAY), labelNames: ["Nova Project"],
    episodeBody: "Sarah Chen joined Project Nova as the lead designer. Sarah Chen's email address is sarah.chen@example.com and her role is lead designer." },
  { sessionId: "golden-s1", referenceTime: iso(2 * DAY - 3_600_000), labelNames: ["Nova Project"],
    episodeBody: "On Project Nova, Sarah Chen mentors Marcus Webb. Marcus Webb handles the Project Nova frontend while Sarah Chen owns the design system." },
  // S2 — preferences
  { sessionId: "golden-s2", referenceTime: iso(2 * DAY),
    episodeBody: "Yoshi's coding preferences: he prefers TypeScript strict mode everywhere, and he prefers pnpm over npm for package management." },
  // S5 — the contradiction pair, isolated in its own session so same-session
  // normalization context can't pre-fold the move into past-tense narrative
  // (phrasing mirrors smoke-ingest's proven contradiction leg).
  { sessionId: "golden-s5", referenceTime: iso(40 * DAY),
    episodeBody: "Yoshi lives in New York City. His apartment is in Brooklyn." },
  { sessionId: "golden-s5", referenceTime: iso(1 * DAY),
    episodeBody: "Correction: Yoshi now lives in Los Angeles. He no longer lives in New York City." },
  // S3 — future Event
  { sessionId: "golden-s3", referenceTime: iso(1 * DAY),
    episodeBody: `The Project Nova demo presentation is scheduled for ${futureDate}. Yoshi will present the demo to the whole team on that date.` },
  // S4 — counterparty-scoped (endUserId)
  { sessionId: "golden-s4", referenceTime: iso(1 * DAY), endUserId: "client-acme",
    episodeBody: "Acme Corp wants weekly status reports every Friday. The Acme Corp contact person is Dana Reyes from procurement." },
];

console.log(`\n--- seeding ${FIXTURES.length} episodes through the full pipeline (this makes real LLM calls) ---`);
const t0 = Date.now();
const queueIds = [];
for (const f of FIXTURES) {
  const { queueId } = await queue.ingestFromModule({ source: "golden-fixture", ...f });
  queueIds.push(queueId);
}
// Sequential, ordered drain (concurrency 1) — NYC lands before LA, so the
// contradiction resolves in-order. addToQueue already kicked an async drain;
// drainMemoryQueueOnce no-ops while one is running, so poll to settlement.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEED_TIMEOUT_MS = 20 * 60_000;
const seedStart = Date.now();
for (;;) {
  void queue.drainMemoryQueueOnce();
  const rows = queueIds.map((id) =>
    db.prepare("SELECT status FROM ingestion_queue WHERE id = ?").get(id),
  );
  const settled = rows.every((r) => r && (r.status === "COMPLETED" || r.status === "FAILED"));
  if (settled) break;
  if (Date.now() - seedStart > SEED_TIMEOUT_MS) {
    console.log("SEED TIMEOUT — queue did not settle in 20 minutes");
    break;
  }
  await sleep(1000);
}
queue.stopMemoryQueue();

let seedOk = true;
for (const id of queueIds) {
  const row = db.prepare("SELECT status, stage, error FROM ingestion_queue WHERE id = ?").get(id);
  if (!row || row.status !== "COMPLETED") {
    seedOk = false;
    console.log(`SEED FAIL  queue ${id}: ${row?.status ?? "MISSING"} stage=${row?.stage} error=${row?.error}`);
  }
}
console.log(`--- seed done in ${((Date.now() - t0) / 1000).toFixed(0)}s (episodes=${db.prepare("SELECT COUNT(*) c FROM episodes").get().c}, statements=${db.prepare("SELECT COUNT(*) c FROM statements").get().c}, voice=${db.prepare("SELECT COUNT(*) c FROM voice_aspects").get().c}, compacts=${db.prepare("SELECT COUNT(*) c FROM documents WHERE type='conversation'").get().c}) ---`);
if (!seedOk) {
  console.log("golden-queries: FIXTURE SEED FAILED — cannot score. Exit 1.");
  __closeForTests();
  process.exit(1);
}

// ============================================================================
// Case runner
// ============================================================================
const scorecard = [];
const latencies = [];
const callCounts = [];

function lastQueryType(query) {
  const row = db.prepare("SELECT query_type FROM recall_logs WHERE query = ? ORDER BY id DESC LIMIT 1").get(query);
  return row?.query_type ?? "(no log)";
}

async function runCase(num, name, query, opts, asserts) {
  const before = llmCalls;
  const t = Date.now();
  let result;
  let error = null;
  try {
    result = await search.searchV2(query, { structured: true, ...opts });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const ms = Date.now() - t;
  const calls = llmCalls - before;
  latencies.push(ms);
  callCounts.push(calls);

  const failures = [];
  if (error) failures.push(`threw: ${error}`);
  else {
    for (const [label, fn] of asserts) {
      try {
        if (!fn(result)) failures.push(label);
      } catch (e) {
        failures.push(`${label} (assert threw: ${e.message})`);
      }
    }
  }
  const routed = lastQueryType(query);
  scorecard.push({
    num, name, status: failures.length === 0 ? "PASS" : "FAIL",
    detail: failures.join("; "), routed, ms, calls,
  });
  if (failures.length > 0 && result) {
    console.log(`  [case ${num} debug] ${JSON.stringify(result).slice(0, 600)}`);
  }
  return result;
}

const text = (r) => JSON.stringify(r ?? {});
const epText = (r) => (r?.episodes ?? []).map((e) => e.content).join("\n");

// 1 — aspect query recalls the preference
await runCase(1, 'aspect query "coding preferences" → voice Preference', "what are my coding preferences?", {}, [
  ["≥1 voice Preference returned", (r) => (r.voiceAspects ?? []).some((v) => v.aspect === "Preference")],
  ["the preference fact is recalled", (r) => /typescript|strict|pnpm/i.test(text(r))],
]);

// 2 — entity lookup broad
await runCase(2, 'entity lookup "Sarah Chen" → her episodes', "what do I know about Sarah Chen?", {}, [
  ["Sarah's content recalled", (r) => /sarah chen/i.test(text(r))],
  ["≥1 episode or statement returned", (r) => (r.episodes ?? []).length + (r.statements ?? []).length > 0],
]);

// 3 — entity lookup attribute
await runCase(3, "entity attribute lookup → Sarah's email", "what is Sarah Chen's email address?", {}, [
  ["email surfaces in the recall", (r) => /sarah\.chen@example\.com/i.test(text(r))],
]);

// 4 — temporal window
await runCase(4, 'temporal "what happened this week"', "what happened this week?", {}, [
  ["recent-week content recalled", (r) => /los angeles|sarah|nova|demo|acme/i.test(text(r))],
]);

// 5 — temporal facets, both stores
await runCase(5, "temporal_facets overview (graph + voice counted)", "give me an overview of everything in my memory this month", {}, [
  ["facets present", (r) => !!r.facets],
  ["topics or entities counted", (r) => ((r.facets?.topics ?? []).length + (r.facets?.entities ?? []).length) > 0],
  ["voice store counted separately (a voice aspect appears)", (r) => (r.facets?.aspects ?? []).some((a) => ["Preference", "Directive", "Habit", "Belief", "Goal"].includes(a.aspect))],
  ["graph store counted (a graph aspect appears)", (r) => (r.facets?.aspects ?? []).some((a) => ["Identity", "Knowledge", "Decision", "Event", "Problem", "Relationship", "Task"].includes(a.aspect))],
]);

// 6 — exploratory + compact replacement for the dense session.
// Robustness note: whether ≥3 raw S1 episodes survive routing+rerank is
// model-dependent (entity_lookup vs exploratory classification). The
// load-bearing invariant is: a dense (≥3) same-session run must NEVER appear
// un-replaced — replaceWithCompacts itself is deterministically verified in
// smoke-search. So: FAIL if ≥3 raw episodes from one session appear with no
// compact; otherwise the compact doc existing + project recall is the pass.
{
  const s1CompactExists =
    db.prepare("SELECT COUNT(*) c FROM documents WHERE type = 'conversation' AND session_id = 'golden-s1'").get().c >= 1;
  const sessionOf = db.prepare("SELECT session_id FROM episodes WHERE uuid = ?");
  await runCase(6, "project overview → dense session compacted (📦/📄)", "tell me about Project Nova", {}, [
    ["project content recalled", (r) => /nova/i.test(text(r))],
    ["session compact document exists for the dense session", () => s1CompactExists],
    ["no dense (≥3) same-session run left un-replaced by its compact", (r) => {
      const bySession = new Map();
      for (const e of r.episodes ?? []) {
        if (e.isCompact || e.isDocument) continue;
        const row = sessionOf.get(e.uuid);
        if (!row?.session_id) continue;
        bySession.set(row.session_id, (bySession.get(row.session_id) ?? 0) + 1);
      }
      const hasCompact = (r.episodes ?? []).some((e) => e.isCompact);
      for (const n of bySession.values()) if (n >= 3 && !hasCompact) return false;
      return true;
    }],
  ]);
}

// 7 — relationship connects the two people
await runCase(7, "relationship Sarah Chen ↔ Marcus Webb", "how are Sarah Chen and Marcus Webb related?", {}, [
  ["both people appear in the recall", (r) => /sarah/i.test(text(r)) && /marcus/i.test(text(r))],
  ["a connecting fact/episode present", (r) => /mentor|mentors|project nova/i.test(text(r))],
]);

// 8 — contradiction: current fact recalled, old one only ever invalidated.
// Robustness note: invalidatedFacts are sourced from the RETURNED episodes'
// provenance (REF semantics, offline-verified in smoke-search) — whether the
// NYC episode survives routing+rerank is model-dependent. So the deterministic
// asserts are: the live pipeline built the temporal chain in the DB, nothing
// current still claims NYC, and WHEN the NYC episode is returned its
// invalidated fact must surface in the invalidatedFacts section.
{
  const nycEpisode = db
    .prepare("SELECT uuid FROM episodes WHERE session_id = 'golden-s5' AND original_content LIKE '%Brooklyn%'")
    .get();
  await runCase(8, 'post-contradiction "where does Yoshi live"', "where does Yoshi live?", {}, [
    ["current fact (Los Angeles) recalled", (r) => /los angeles/i.test(text(r))],
    ["live pipeline invalidated the NYC fact (temporal chain in DB, either store)", () =>
      db.prepare(
        `SELECT
           (SELECT COUNT(*) FROM statements WHERE invalid_at IS NOT NULL AND (fact LIKE '%New York%' OR fact LIKE '%NYC%' OR fact LIKE '%Brooklyn%')) +
           (SELECT COUNT(*) FROM voice_aspects WHERE invalid_at IS NOT NULL AND (fact LIKE '%New York%' OR fact LIKE '%NYC%' OR fact LIKE '%Brooklyn%')) AS c`,
      ).get().c >= 1],
    ["no CURRENT statement still claims he lives in New York", (r) =>
      !(r.statements ?? []).some((s) => /lives in new york/i.test(s.fact))],
    ["NYC fact surfaces in invalidatedFacts whenever its episode is returned", (r) => {
      const returned = (r.episodes ?? []).some((e) => !e.isCompact && !e.isDocument && e.uuid === nycEpisode?.uuid);
      if (!returned) return true; // surfacing scope is per-returned-episode by design
      return (r.invalidatedFacts ?? []).some((f) => /new york|nyc|brooklyn/i.test(f.fact));
    }],
  ]);
}

// 9 — greeting gate short-circuit
{
  const logsBefore = db.prepare("SELECT COUNT(*) c FROM recall_logs").get().c;
  const before = llmCalls;
  const t = Date.now();
  let md = "";
  let err = null;
  try {
    md = await search.searchV2("hey");
  } catch (e) { err = e.message; }
  const ms = Date.now() - t;
  const calls = llmCalls - before;
  latencies.push(ms); callCounts.push(calls);
  const logsAfter = db.prepare("SELECT COUNT(*) c FROM recall_logs").get().c;
  const pass = !err && typeof md === "string" && md.includes("No relevant memories found") && logsAfter === logsBefore;
  scorecard.push({
    num: 9, name: 'greeting "hey" → gate short-circuit, no search',
    status: pass ? "PASS" : "FAIL",
    detail: pass ? "" : err ? `threw: ${err}` : `md=${md.slice(0, 80)} logsΔ=${logsAfter - logsBefore}`,
    routed: "(gated)", ms, calls,
  });
}

// 10 — counterparty scoping + leak-check inverse
await runCase(10, "endUserIds scope: counterparty in, owner out", "what does the client want from us?", { endUserIds: ["client-acme"] }, [
  ["acme counterparty content recalled", (r) => /acme|dana reyes|weekly status/i.test(text(r))],
  ["owner-only episodes EXCLUDED (no Sarah/TypeScript/Los Angeles leakage)",
    (r) => !/sarah chen|typescript|los angeles/i.test(epText(r))],
]);
await runCase(10.5, "endUserIds leak-check inverse: unknown counterparty sees nothing", "what does the client want from us?", { endUserIds: ["client-nobody"] }, [
  ["zero acme leakage into another counterparty's scope", (r) => !/acme|dana reyes/i.test(epText(r))],
  ["zero owner leakage either", (r) => !/sarah chen|typescript|los angeles/i.test(epText(r))],
]);

// 11 — future event surfaces for "what's coming up"
{
  const evRow = db.prepare(
    "SELECT COUNT(*) c FROM statements WHERE aspect = 'Event' AND json_extract(attributes, '$.event_date') IS NOT NULL",
  ).get();
  await runCase(11, `future Event (event_date ${futureDate}) surfaces for "what's coming up"`, "what's coming up in the next two weeks?", {}, [
    ["pipeline extracted an Event statement with event_date", () => evRow.c >= 1],
    ["the demo surfaces in the recall", (r) => /demo/i.test(text(r))],
  ]);
}

// ============================================================================
// Scorecard
// ============================================================================
console.log("\n════════════════════════ GOLDEN SCORECARD ════════════════════════");
let fails = 0;
for (const c of scorecard) {
  if (c.status === "FAIL") fails++;
  const flag = c.status === "PASS" ? "PASS" : c.status === "SKIP" ? "SKIP" : "FAIL";
  console.log(
    `${flag}  #${String(c.num).padEnd(4)} ${c.name}\n      routed=${c.routed} · ${c.ms}ms · ${c.calls} LLM call(s)${c.detail ? `\n      ↳ ${c.detail}` : ""}`,
  );
}
const sorted = [...latencies].sort((a, b) => a - b);
const p50 = sorted[Math.floor(sorted.length / 2)] ?? 0;
const maxCalls = Math.max(...callCounts);
console.log("───────────────────────────────────────────────────────────────────");
console.log(`p50 search latency: ${p50}ms (target <2500ms with a cloud router call)`);
console.log(`max LLM calls in one search: ${maxCalls} (bar: ≤2 — router + at most one corrective retry)`);
if (maxCalls > 2) {
  fails++;
  console.log("FAIL  LLM-call budget exceeded — a handler is making model calls beyond the router.");
}
console.log(`result: ${scorecard.filter((c) => c.status === "PASS").length}/${scorecard.length} cases PASS, ${fails} FAIL`);

globalThis.fetch = realFetch;
__closeForTests();
for (const f of [tmpDb, tmpDb + "-wal", tmpDb + "-shm"]) { try { fs.rmSync(f, { force: true }); } catch {} }
try { fs.rmSync(settingsDir, { recursive: true, force: true }); } catch {}

console.log(fails === 0 ? "\ngolden-queries: ALL PASS" : `\ngolden-queries: ${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
