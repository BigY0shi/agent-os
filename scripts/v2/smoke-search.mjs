// A4 smoke: THE search-v2 gate (router / handlers / formatter / searchV2).
//   OFFLINE (always): seeds the graph DIRECTLY (graph.ts + vector.ts + raw SQL,
//     synthetic deterministic 768-d embeddings served by a local stub /api/embed
//     so NO Ollama is needed), then drives the HANDLERS through executeSearch()
//     with hand-built RouterOutput objects (LLM router bypassed):
//     aspect_query voice aspects, entity_lookup broad + attribute, temporal
//     lexical window + Event event_date OR-branch, relationship, exploratory
//     compacted docs, compact replacement (>2 episodes/session), token budget,
//     endUserIds hard filter (NULL excluded), labelIds force-scope, agentId
//     scope, temporal_facets graph+voice split, invalidated-facts surfacing.
//   ONLINE (needs local Ollama embeddings + an LLM provider): fresh DB, real
//     ingest via ingestFromModule → searchV2("what are my coding preferences?")
//     asserts router classification (recall_logs row) + formatter markdown,
//     then searchV2("hello!") asserts the confidence/shouldSearch gate.
// Run: npx tsx scripts/v2/smoke-search.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import http from "node:http";
import crypto from "node:crypto";

const tmp = path.join(os.tmpdir(), `agentos-smoke-search-${Date.now()}.db`);
const tmp2 = path.join(os.tmpdir(), `agentos-smoke-search-online-${Date.now()}.db`);
process.env.AGENTIC_OS_DB = tmp;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-search-"));
const settingsFile = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_SETTINGS = settingsFile;

// Mirror Next's .env loading for OLLAMA_API_KEY (cloud LLM path, online half)
for (const envFile of [".env.local", ".env"]) {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), envFile), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {}
}

// ---------------------------------------------------------------------------
// Deterministic embedding stub (offline half): hash → xorshift32 → 768-d unit
// vector. Same text ⇒ same vector (sim 1.0); different texts ⇒ ~orthogonal
// (768-d random cosine ≈ N(0, 0.036) — far below every threshold in play).
// ---------------------------------------------------------------------------
function hashStr(s) {
  let h = 2166136261;
  for (const c of s) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
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
      res.writeHead(500, { "content-type": "application/json" });
      res.end("{}");
    }
  });
});
await new Promise((r) => stubServer.listen(0, "127.0.0.1", r));
process.env.OLLAMA_URL = `http://127.0.0.1:${stubServer.address().port}`;

const writeSettings = (memory) =>
  fs.writeFileSync(settingsFile, JSON.stringify({ memory }, null, 2));
writeSettings({ embedProvider: "ollama-local", embedModel: "stub-embed", ingestEnabled: true });

const { ensureDb, getDb, __closeForTests } = await import("../../src/lib/v2/db.ts");
const graph = await import("../../src/lib/v2/memory/graph.ts");
const labels = await import("../../src/lib/v2/memory/labels.ts");
const vector = await import("../../src/lib/v2/memory/vector.ts");
const handlers = await import("../../src/lib/v2/memory/search/handlers.ts");
const search = await import("../../src/lib/v2/memory/search/index.ts");
const { countTokens } = await import("../../src/lib/v2/memory/chunker.ts");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra ? ` — ${extra}` : ""}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cleanup = async () => {
  try {
    const queue = await import("../../src/lib/v2/memory/queue.ts");
    queue.stopMemoryQueue();
  } catch {}
  stubServer.close();
  __closeForTests();
  for (const f of [tmp, tmp2]) {
    try {
      fs.rmSync(f, { force: true });
      fs.rmSync(f + "-wal", { force: true });
      fs.rmSync(f + "-shm", { force: true });
    } catch {}
  }
  try { fs.rmSync(settingsDir, { recursive: true, force: true }); } catch {}
};
const finish = async (code) => {
  await cleanup();
  console.log(failures === 0 ? "\nsmoke-search: ALL PASS" : `\nsmoke-search: ${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : code);
};

ensureDb();
const db = getDb();
const uuid = () => crypto.randomUUID();
const nowIso = new Date().toISOString();

// ===========================================================================
// OFFLINE fixture seed (graph.ts + vector.ts + raw SQL — no LLM, stub embeds)
// ===========================================================================
console.log("--- offline: seeding fixture graph ---");

// Labels
const L_AOS = uuid();
const L_CODE = uuid();
const insLabel = db.prepare(
  "INSERT INTO labels (id, name, description, color, created_at) VALUES (?, ?, ?, ?, ?)",
);
insLabel.run(L_AOS, "AgentOS Project", "The Agent OS rebuild", "oklch(66% 0.1835 200)", nowIso);
insLabel.run(L_CODE, "Coding Preferences", "How Yoshi likes code", "oklch(66% 0.1835 100)", nowIso);
vector.upsert("label", L_AOS, stubEmbed("AgentOS Project"));
vector.upsert("label", L_CODE, stubEmbed("Coding Preferences"));

// Episodes (validAt staggered ISO; content vectors seeded for rerank paths)
const EP4_CONTENT = "Sarah joined the AgentOS project as designer.";
const seedEpisode = (p) => {
  const id = graph.saveEpisode({
    content: p.content,
    originalContent: p.content,
    source: "smoke-search",
    sessionId: p.sessionId,
    endUserId: p.endUserId ?? null,
    agentId: p.agentId ?? null,
    validAt: p.validAt,
  });
  if (p.labelIds?.length) labels.addEpisodeLabels(id, p.labelIds);
  vector.upsert("episode", id, stubEmbed(p.content));
  return id;
};
const ep1 = seedEpisode({ content: "Kickoff notes for AgentOS memory rebuild planning.", sessionId: "S1", validAt: "2026-08-10T10:00:00.000Z", labelIds: [L_AOS] });
const ep2 = seedEpisode({ content: "Yoshi implemented the AgentOS search router today.", sessionId: "S1", validAt: "2026-08-20T10:00:00.000Z", labelIds: [L_AOS] });
const ep3 = seedEpisode({ content: "Yoshi wired the AgentOS handlers and formatter.", sessionId: "S1", validAt: "2026-08-21T10:00:00.000Z", labelIds: [L_AOS] });
const ep4 = seedEpisode({ content: EP4_CONTENT, sessionId: "S2", validAt: "2026-08-19T09:00:00.000Z", labelIds: [L_CODE] });
const ep5 = seedEpisode({ content: "Client One asked for weekly progress reports.", sessionId: "S3", validAt: "2026-08-22T09:00:00.000Z", labelIds: [L_CODE], endUserId: "client-1" });
const ep6 = seedEpisode({ content: "Planned the AgentOS demo for late August.", sessionId: "S4", validAt: "2026-07-01T08:00:00.000Z" });
const ep7 = seedEpisode({ content: "Agent X noted a config drift in staging.", sessionId: "S5", validAt: "2026-08-23T09:00:00.000Z", labelIds: [L_CODE], agentId: "agent-x" });

// Entities (Sarah / AgentOS + predicates + facet extras)
const seedEntity = (name, type, attributes) => {
  const id = graph.saveEntity({ name, type, attributes });
  vector.upsert("entity", id, stubEmbed(name));
  return id;
};
const sarah = seedEntity("Sarah", "Person", { email: "sarah@example.com", role: "designer" });
const agentos = seedEntity("AgentOS", "Project", {});
const clientOne = seedEntity("Client One", "Person", {});
const agentX = seedEntity("Agent X", "Person", {});
const predWorks = graph.saveEntity({ name: "works on", type: "Predicate" });
const predLeads = graph.saveEntity({ name: "leads", type: "Predicate" });

// Statements (incl. one invalidated pair) — statement vectors for rerank
const seedTriple = (p) => {
  const id = graph.saveTriple({
    statement: { fact: p.fact, aspect: p.aspect, attributes: p.attributes, validAt: p.validAt },
    subjectUuid: p.subject,
    predicateUuid: p.predicate,
    objectUuid: p.object,
    episodeUuid: p.episode,
  });
  vector.upsert("statement", id, stubEmbed(p.fact));
  return id;
};
const st1 = seedTriple({ fact: "Sarah works on AgentOS", aspect: "Relationship", validAt: "2026-08-26T09:05:00.000Z", subject: sarah, predicate: predWorks, object: agentos, episode: ep4 });
const st2 = seedTriple({ fact: "Sarah leads AgentOS", aspect: "Relationship", validAt: "2026-08-26T09:05:00.000Z", subject: sarah, predicate: predLeads, object: agentos, episode: ep4 });
seedTriple({ fact: "Decided to plan the memory rebuild", aspect: "Decision", validAt: "2026-08-10T10:05:00.000Z", subject: agentos, predicate: predWorks, episode: ep1 });
seedTriple({ fact: "Decided to build the search router first", aspect: "Decision", validAt: "2026-08-20T10:05:00.000Z", subject: agentos, predicate: predWorks, episode: ep2 });
seedTriple({ fact: "Decided to port the formatter verbatim", aspect: "Decision", validAt: "2026-08-21T10:05:00.000Z", subject: agentos, predicate: predWorks, episode: ep3 });
seedTriple({ fact: "Client One prefers weekly reports", aspect: "Knowledge", validAt: "2026-08-01T00:00:00.000Z", subject: clientOne, predicate: predWorks, episode: ep5 });
seedTriple({ fact: "Agent X noted a config drift", aspect: "Problem", validAt: "2026-08-05T00:00:00.000Z", subject: agentX, predicate: predWorks, episode: ep7 });
// Event with event_date INSIDE the query window while valid_at is OUTSIDE
seedTriple({ fact: "AgentOS demo scheduled for late August", aspect: "Event", attributes: { event_date: "2026-08-24" }, validAt: "2026-07-01T08:05:00.000Z", subject: agentos, predicate: predWorks, episode: ep6 });

// Invalidate the pair's older fact (temporal chain — never deleted)
graph.invalidateStatements([st2], ep5);

// Voice aspects (stored WHOLE) + embeddings
const seedVoice = (fact, aspect, episode, validAt) => {
  const id = graph.saveVoiceAspect({ fact, aspect, episodeUuid: episode, validAt });
  vector.upsert("voice_aspect", id, stubEmbed(fact));
  return id;
};
const VA1_FACT = "Yoshi prefers TypeScript strict mode";
seedVoice(VA1_FACT, "Preference", ep4, "2026-08-19T09:10:00.000Z");
seedVoice("Always run tsc before committing", "Directive", ep4, "2026-08-19T09:11:00.000Z");

// Compacted-session document for S1 (+ label + compacted_session embedding)
const DOC1_CONTENT =
  "COMPACT: AgentOS memory rebuild sessions — router, handlers, and formatter progress summary.";
const doc1 = uuid();
db.prepare(
  `INSERT INTO documents (id, session_id, title, content, source, type, metadata, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, 'conversation', '{}', ?, ?)`,
).run(doc1, "S1", "AgentOS sessions", DOC1_CONTENT, "compaction", nowIso, nowIso);
db.prepare("INSERT INTO document_labels (document_id, label_id) VALUES (?, ?)").run(doc1, L_AOS);
vector.upsert("compacted_session", doc1, stubEmbed(DOC1_CONTENT));

// Hand-built RouterOutput factory (LLM router bypassed)
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
const uuids = (r) => r.episodes.map((e) => e.uuid);

// ===========================================================================
// OFFLINE handler checks (executeSearch = dispatch + post-chain + budget)
// ===========================================================================
console.log("--- offline: aspect_query → voice aspects ---");
const r1 = await search.executeSearch(
  ro({ queryType: "aspect_query", aspects: ["Preference"] }),
  { query: VA1_FACT },
);
check("matching voice aspect returned", (r1.voiceAspects || []).some((v) => v.fact === VA1_FACT));
check(
  "voice aspects filtered to router-named aspect",
  (r1.voiceAspects || []).every((v) => v.aspect === "Preference"),
);

console.log("--- offline: entity_lookup broad (Sarah) ---");
const r2 = await search.executeSearch(
  ro({ queryType: "entity_lookup", lookupMode: "broad", entityHints: ["Sarah"] }),
  { query: EP4_CONTENT },
);
check("entity resolved via vector hint", r2.entity?.name === "Sarah");
check("Sarah's episode returned", uuids(r2).includes(ep4));
check(
  "invalidated fact ONLY in invalidatedFacts section",
  (r2.invalidatedFacts || []).some((f) => f.fact === "Sarah leads AgentOS" && f.invalidAt),
);
check(
  "current fact NOT in invalidatedFacts",
  !(r2.invalidatedFacts || []).some((f) => f.fact === "Sarah works on AgentOS"),
);

console.log("--- offline: entity_lookup attribute (email) ---");
const r3 = await search.executeSearch(
  ro({ queryType: "entity_lookup", lookupMode: "attribute", entityHints: ["Sarah"], attributeHint: "email" }),
  {},
);
check("attribute mode returns entity attributes", r3.entity?.attributes?.email === "sarah@example.com");
check("attribute mode returns no episodes", r3.episodes.length === 0);

console.log("--- offline: temporal window (lexical ISO) + Event OR-branch ---");
const temporalRO = ro({
  queryType: "temporal",
  temporal: { type: "range", days: null, startDate: "2026-08-15", endDate: "2026-08-25" },
});
const r4 = await search.executeSearch(temporalRO, {});
const u4 = uuids(r4);
check("in-window episodes returned (ep2, ep3)", u4.includes(ep2) && u4.includes(ep3), JSON.stringify(u4));
check("out-of-window episode excluded (ep1)", !u4.includes(ep1));
check("out-of-window statements excluded (ep4, ep5, ep7)", !u4.includes(ep4) && !u4.includes(ep5) && !u4.includes(ep7));
check("Event event_date OR-branch pulls ep6 into window", u4.includes(ep6));

console.log("--- offline: relationship (Sarah ↔ AgentOS) ---");
const r5 = await search.executeSearch(
  ro({ queryType: "relationship", entityHints: ["Sarah", "AgentOS"] }),
  { query: "Sarah works on AgentOS" },
);
check(
  "connecting statement returned",
  (r5.statements || []).some((s) => s.fact === "Sarah works on AgentOS"),
);
check(
  "invalidated connecting statement excluded from current results",
  !(r5.statements || []).some((s) => s.fact === "Sarah leads AgentOS"),
);

console.log("--- offline: exploratory → compacted-session documents ---");
const r6 = await search.executeSearch(
  ro({
    queryType: "exploratory",
    matchedLabels: [{ labelId: L_AOS, labelName: "AgentOS Project", score: 0.9 }],
    selectedLabels: ["AgentOS Project"],
  }),
  { query: DOC1_CONTENT },
);
check(
  "compacted session doc returned as 📄 DOCUMENT",
  r6.episodes.some((e) => e.isDocument && e.content.startsWith("COMPACT:")),
  JSON.stringify(r6.episodes.map((e) => ({ uuid: e.uuid, isDocument: e.isDocument }))),
);

console.log("--- offline: replaceWithCompacts (>2 episodes from one session) ---");
const r7 = await search.executeSearch(
  ro({
    queryType: "aspect_query",
    aspects: ["Decision"],
    matchedLabels: [{ labelId: L_AOS, labelName: "AgentOS Project", score: 0.9 }],
    selectedLabels: ["AgentOS Project"],
  }),
  { enableReranking: false },
);
check(
  "3 session episodes collapsed into ONE 📦 compact",
  r7.episodes.length === 1 && r7.episodes[0].isCompact === true && r7.episodes[0].uuid === doc1,
  JSON.stringify(r7.episodes.map((e) => ({ uuid: e.uuid, isCompact: e.isCompact }))),
);
check("compact carries the session's union of labels", (r7.episodes[0]?.labelIds || []).includes(L_AOS));

console.log("--- offline: token budget trims from the tail ---");
const tbBudget = countTokens("one two three");
const tb = handlers.applyTokenBudget(
  [{ uuid: "a", content: "one two three" }, { uuid: "b", content: "four five six" }],
  tbBudget,
);
check("applyTokenBudget drops tail episode", tb.episodes.length === 1 && tb.episodes[0].uuid === "a" && tb.droppedCount === 1);
const r8 = await search.executeSearch(temporalRO, { tokenBudget: 12 });
check(
  "executeSearch applies tokenBudget option",
  r8.episodes.length >= 1 && r8.episodes.length < r4.episodes.length,
  `r8=${r8.episodes.length} r4=${r4.episodes.length}`,
);

console.log("--- offline: labelIds force-scope + endUserIds + agentId ---");
const r9 = await search.executeSearch(ro({ queryType: "aspect_query" }), {
  labelIds: [L_CODE],
  enableReranking: false,
});
const u9 = uuids(r9);
check(
  "labelIds force-scope (router bypassed) returns L_CODE episodes",
  u9.includes(ep4) && u9.includes(ep5) && u9.includes(ep7),
  JSON.stringify(u9),
);
check("force-scope excludes other labels", !u9.includes(ep1) && !u9.includes(ep2) && !u9.includes(ep3));

const r10 = await search.executeSearch(ro({ queryType: "aspect_query" }), {
  labelIds: [L_CODE],
  endUserIds: ["client-1"],
  enableReranking: false,
});
const u10 = uuids(r10);
check("endUserIds hard filter keeps only the counterparty's episode", u10.length === 1 && u10[0] === ep5, JSON.stringify(u10));
check("NULL end_user_id rows EXCLUDED when filter set", !u10.includes(ep4) && !u10.includes(ep7));

const r11 = await search.executeSearch(ro({ queryType: "aspect_query" }), {
  labelIds: [L_CODE],
  agentId: "agent-x",
  enableReranking: false,
});
const u11 = uuids(r11);
check("agentId scopes to the agent's episodes", u11.length === 1 && u11[0] === ep7, JSON.stringify(u11));

console.log("--- offline: temporal_facets (graph + voice queried separately) ---");
const r12 = await search.executeSearch(
  ro({
    queryType: "temporal_facets",
    facets: ["topics", "entities", "aspects"],
    // Start pinned before the seeded facts (fixed August 2026 valid_at dates), end at
    // tomorrow so the labels created "now" stay in. A literal "2026-08-01".."2026-08-31"
    // went stale on 2026-09-01 (topics/stats); a rolling 30-day start went stale on
    // 2026-09-18, when the Sarah/Decision/Preference facts slid out of it.
    temporal: { type: "range", days: null, startDate: "2026-08-01", endDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) },
  }),
  {},
);
check("facets: topics include AgentOS Project", (r12.facets?.topics || []).some((t) => t.labelName === "AgentOS Project"));
check("facets: entities include Sarah", (r12.facets?.entities || []).some((e) => e.entityName === "Sarah"));
const facetAspects = (r12.facets?.aspects || []).map((a) => a.aspect);
check("facets: graph aspects counted (Decision)", facetAspects.includes("Decision"), JSON.stringify(facetAspects));
check("facets: voice aspects counted separately (Preference)", facetAspects.includes("Preference"), JSON.stringify(facetAspects));
check("facets: stats present", (r12.facets?.stats?.totalEpisodes ?? 0) >= 1);

console.log("--- offline: recall_count bump ---");
const rc = db.prepare("SELECT recall_count FROM episodes WHERE uuid = ?").get(ep4);
check("recall_count bumped for recalled episode", rc.recall_count >= 1, `recall_count=${rc.recall_count}`);

console.log("--- offline: formatter markdown sections ---");
const { formatRecallAsMarkdown } = await import("../../src/lib/v2/memory/search/formatter.ts");
const md2 = formatRecallAsMarkdown(r2);
check("markdown: Entity Information section", md2.includes("## Entity Information"));
check("markdown: Invalidated Facts section", md2.includes("## Invalidated Facts") && md2.includes("Sarah leads AgentOS"));
const md7 = formatRecallAsMarkdown(r7);
check("markdown: 📦 Session Compact marker", md7.includes("📦 Session Compact"));
const md6 = formatRecallAsMarkdown(r6);
check("markdown: 📄 Document marker", md6.includes("📄 Document"));
const mdEmpty = formatRecallAsMarkdown({ episodes: [], invalidatedFacts: [], statements: [], entity: null });
check("markdown: empty-result message", mdEmpty.includes("*No relevant memories found.*"));

// ===========================================================================
// ONLINE half — real embeddings + LLM router through the full searchV2()
// ===========================================================================
console.log("--- online probe ---");
stubServer.close();
delete process.env.OLLAMA_URL;

let ollamaUp = false;
// Harness/CI gate: AGENTIC_SMOKE_OFFLINE=1 skips the model legs even with Ollama up.
// Decided BEFORE the probe: an in-flight probe socket at process.exit trips a
// libuv assertion on Windows (seen 2026-09-02 on smoke-ingest).
if (process.env.AGENTIC_SMOKE_OFFLINE) { console.log("SKIP  online leg: AGENTIC_SMOKE_OFFLINE=1"); }
else try {
  const probe = await fetch("http://127.0.0.1:11434/api/version", { signal: AbortSignal.timeout(3000) });
  ollamaUp = probe.ok;
} catch {}
if (!ollamaUp) {
  console.log("SKIP  local Ollama not reachable at 127.0.0.1:11434 — ONLINE searchV2 checks skipped.");
  console.log("      Start Ollama (`ollama serve`, `ollama pull nomic-embed-text`) and re-run for the full gate.");
  await finish(1);
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
  await finish(1);
}
console.log(`      provider=${provider} modelLow=${modelLow} modelMedium=${modelMedium}`);

// Fresh DB for the online half (synthetic vectors must not pollute real recall)
__closeForTests();
process.env.AGENTIC_OS_DB = tmp2;
ensureDb();
writeSettings({
  ingestEnabled: true,
  provider,
  modelLow,
  modelMedium,
  embedProvider: "ollama-local",
  embedModel: "nomic-embed-text",
});

try {
  const { getEmbedding } = await import("../../src/lib/v2/memory/embed.ts");
  await getEmbedding("smoke probe");
} catch (e) {
  console.log(`SKIP  embeddings unavailable (${e.message}) — ONLINE checks skipped.`);
  await finish(1);
}

const queue = await import("../../src/lib/v2/memory/queue.ts");
const db2 = getDb();
const waitForQueue = async (queueId, timeoutMs) => {
  const start = Date.now();
  for (;;) {
    const row = db2.prepare("SELECT status, stage, error FROM ingestion_queue WHERE id = ?").get(queueId);
    if (row && (row.status === "COMPLETED" || row.status === "FAILED")) return row;
    if (Date.now() - start > timeoutMs) return row ?? { status: "MISSING" };
    await sleep(500);
  }
};

console.log("--- online: ingest fixture ---");
const { queueId } = await queue.ingestFromModule({
  episodeBody:
    "Yoshi's coding preferences: he prefers TypeScript strict mode, and he prefers pnpm over npm for package management.",
  source: "smoke-search",
  labelNames: ["Coding Preferences"],
});
void queue.drainMemoryQueueOnce();
const qrow = await waitForQueue(queueId, 300_000);
check("online ingest COMPLETED", qrow.status === "COMPLETED", `status=${qrow.status} stage=${qrow.stage} error=${qrow.error}`);

console.log("--- online: full searchV2 round trip ---");
const t0 = Date.now();
const md = await search.searchV2("what are my coding preferences?");
console.log(`      searchV2 completed in ${Date.now() - t0}ms`);
check("searchV2 returns markdown", typeof md === "string" && md.length > 0);
check(
  "markdown recalls the ingested preference",
  /typescript|pnpm|strict/i.test(md),
  md.slice(0, 300),
);
const logRow = db2
  .prepare("SELECT query_type, result_count, response_time_ms, context FROM recall_logs WHERE query = ? ORDER BY id DESC LIMIT 1")
  .get("what are my coding preferences?");
check("recall_logs row written with router classification", !!logRow && !!logRow.query_type, JSON.stringify(logRow ?? null));
check("recall_logs context carries router output", !!logRow && logRow.context.includes("confidence"));

console.log("--- online: greeting gate (no search, no log) ---");
const logCountBefore = db2.prepare("SELECT COUNT(*) c FROM recall_logs").get().c;
const mdHello = await search.searchV2("hello!");
const logCountAfter = db2.prepare("SELECT COUNT(*) c FROM recall_logs").get().c;
check("gate short-circuits: empty result markdown", typeof mdHello === "string" && mdHello.includes("No relevant memories found"), mdHello.slice(0, 200));
check("gate short-circuits: no recall_logs row / no handler dispatch", logCountAfter === logCountBefore);

await finish(1);
