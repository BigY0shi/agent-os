// A7 smoke: REST /api/v2/memory/* route handlers (direct-import, NextRequest)
// + the MCP memory tools through handleMcpMessage.
//   OFFLINE (always): temp DB + stub /api/embed server (deterministic 768-d
//     vectors, no Ollama), memory.ingestEnabled=false so queue rows stay
//     PENDING (no LLM pipeline). Graph seeded directly (smoke-search pattern).
//     Asserts: ingest 202+queueId (+400 zod), episodes list+filters, episode
//     detail (statements/voice/labels), entities q, labels CRUD, rules CRUD,
//     logs list + retry FAILED→PENDING, stats vs seeds, persona GET null →
//     seeded doc → POST 409, search route 200 (router error-fallback path),
//     DELETE cascade-exile (bundle on disk verified, sole-provenance statement
//     + orphan entity + sole-episode voice aspect removed, shared kept).
//   MCP half: tools/list live defs, initialize_conversation_session uuid,
//     memory_ingest queueId, get_labels, memory_about_user no-persona message.
//   ONLINE (needs local Ollama + OLLAMA_API_KEY): fresh DB, real ingest via
//     MCP memory_ingest → drain → memory_search returns markdown.
// Run: npx tsx scripts/v2/smoke-memory-api.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import http from "node:http";
import crypto from "node:crypto";

const tmp = path.join(os.tmpdir(), `agentos-smoke-memapi-${Date.now()}.db`);
const tmp2 = path.join(os.tmpdir(), `agentos-smoke-memapi-online-${Date.now()}.db`);
process.env.AGENTIC_OS_DB = tmp;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-memapi-"));
const settingsFile = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_SETTINGS = settingsFile;

// Mirror Next's .env loading (OLLAMA_API_KEY for the online half)
for (const envFile of [".env.local", ".env"]) {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), envFile), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {}
}

// Deterministic embedding stub (same construction as smoke-search)
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
const REAL_OLLAMA = "http://127.0.0.1:11434";
process.env.OLLAMA_URL = `http://127.0.0.1:${stubServer.address().port}`;

const writeMemorySettings = (memory) =>
  fs.writeFileSync(settingsFile, JSON.stringify({ memory }, null, 2));
// Kill-switch OFF: queue rows stay PENDING — no LLM pipeline in the offline
// half. provider ollama-local points chat at the stub (embeddings-only) server,
// so the search router's LLM call fails fast → deterministic error-fallback.
writeMemorySettings({
  embedProvider: "ollama-local",
  embedModel: "stub-embed",
  ingestEnabled: false,
  provider: "ollama-local",
  modelLow: "stub",
  modelMedium: "stub",
});

// ---------------------------------------------------------------------------
// Imports (env is set — routes/libs open the temp DB)
// ---------------------------------------------------------------------------
const { NextRequest } = await import("next/server");
const { ensureDb, getDb, __closeForTests } = await import("../../src/lib/v2/db.ts");
const graph = await import("../../src/lib/v2/memory/graph.ts");
const vector = await import("../../src/lib/v2/memory/vector.ts");
const queue = await import("../../src/lib/v2/memory/queue.ts");
const { handleMcpMessage } = await import("../../src/lib/v2/mcp/server.ts");

const ingestRoute = await import("../../src/app/api/v2/memory/ingest/route.ts");
const searchRoute = await import("../../src/app/api/v2/memory/search/route.ts");
const episodesRoute = await import("../../src/app/api/v2/memory/episodes/route.ts");
const episodeDetailRoute = await import("../../src/app/api/v2/memory/episodes/[id]/route.ts");
const entitiesRoute = await import("../../src/app/api/v2/memory/entities/route.ts");
const entityDetailRoute = await import("../../src/app/api/v2/memory/entities/[id]/route.ts");
const labelsRoute = await import("../../src/app/api/v2/memory/labels/route.ts");
const logsRoute = await import("../../src/app/api/v2/memory/logs/route.ts");
const rulesRoute = await import("../../src/app/api/v2/memory/rules/route.ts");
const personaRoute = await import("../../src/app/api/v2/memory/persona/route.ts");
const statsRoute = await import("../../src/app/api/v2/memory/stats/route.ts");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  if (!cond) failures++;
};

const BASE = "http://localhost/api/v2/memory";
const jreq = (url, method = "GET", body) =>
  new NextRequest(url, {
    method,
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } }
      : {}),
  });
const params = (id) => ({ params: Promise.resolve({ id }) });
const j = (res) => res.json();

const exileFiles = [];
const cleanup = () => {
  try { queue.stopMemoryQueue(); } catch {}
  stubServer.close();
  try { __closeForTests(); } catch {}
  for (const f of [tmp, tmp2]) {
    try {
      fs.rmSync(f, { force: true });
      fs.rmSync(f + "-wal", { force: true });
      fs.rmSync(f + "-shm", { force: true });
    } catch {}
  }
  // Exile bundles this smoke created from its own temp DB — safe to remove.
  for (const f of exileFiles) {
    try { fs.rmSync(f, { force: true }); } catch {}
  }
  try { fs.rmSync(settingsDir, { recursive: true, force: true }); } catch {}
};
const finish = (code) => {
  cleanup();
  console.log(failures === 0 ? "\nsmoke-memory-api: ALL PASS" : `\nsmoke-memory-api: ${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : code);
};

try {
  ensureDb();
  const db = getDb();
  const uuid = () => crypto.randomUUID();
  const nowIso = () => new Date().toISOString();

  // =========================================================================
  // Labels CRUD (route-level)
  // =========================================================================
  console.log("--- labels CRUD ---");
  let res = await labelsRoute.POST(jreq(`${BASE}/labels`, "POST", { name: "Projects", description: "Project work" }));
  check("POST /labels 201", res.status === 201);
  const labelProjects = (await j(res)).label;
  res = await labelsRoute.POST(jreq(`${BASE}/labels`, "POST", { name: "Clients" }));
  const labelClients = (await j(res)).label;
  check("labels have oklch colors", /^oklch\(/.test(labelProjects.color) && /^oklch\(/.test(labelClients.color));

  res = await labelsRoute.PATCH(jreq(`${BASE}/labels`, "PATCH", { id: labelClients.id, description: "Counterparty work" }));
  check("PATCH /labels updates description", res.status === 200 && (await j(res)).label.description === "Counterparty work");
  res = await labelsRoute.POST(jreq(`${BASE}/labels`, "POST", {}));
  check("POST /labels without name 400", res.status === 400);
  res = await labelsRoute.GET();
  const labelList = (await j(res)).labels;
  check("GET /labels lists both", labelList.length === 2 && labelList.every((l) => typeof l.episodeCount === "number"));

  // =========================================================================
  // Seed graph directly (LLM-free — smoke-search pattern)
  // =========================================================================
  console.log("--- seeding fixture graph ---");
  const seedEpisode = (p) => {
    const id = graph.saveEpisode({
      content: p.content,
      originalContent: p.content,
      source: p.source ?? "smoke-memapi",
      sessionId: p.sessionId,
      endUserId: p.endUserId ?? null,
      agentId: p.agentId ?? null,
      validAt: p.validAt,
    });
    if (p.labelIds?.length) {
      const ins = db.prepare("INSERT OR IGNORE INTO episode_labels (episode_uuid, label_id) VALUES (?, ?)");
      for (const l of p.labelIds) ins.run(id, l);
    }
    vector.upsert("episode", id, stubEmbed(p.content));
    return id;
  };
  const ep1 = seedEpisode({ content: "Alpha kickoff planning session with Sarah.", sessionId: "S1", validAt: "2026-08-10T10:00:00.000Z", labelIds: [labelProjects.id] });
  const ep2 = seedEpisode({ content: "Implemented the search router for Alpha.", sessionId: "S1", validAt: "2026-08-20T10:00:00.000Z", labelIds: [labelProjects.id] });
  const ep3 = seedEpisode({ content: "Client One requested weekly reports.", sessionId: "S2", validAt: "2026-08-22T09:00:00.000Z", labelIds: [labelClients.id], endUserId: "client-1" });
  const ep4 = seedEpisode({ content: "Agent X flagged a config drift.", sessionId: "S3", validAt: "2026-08-23T09:00:00.000Z", agentId: "agent-x" });

  const seedEntity = (name, type, attributes = {}) => {
    const id = graph.saveEntity({ name, type, attributes });
    vector.upsert("entity", id, stubEmbed(name));
    return id;
  };
  const sarah = seedEntity("Sarah", "Person", { email: "sarah@example.com" });
  const alpha = seedEntity("Alpha", "Project");
  const orphanCorp = seedEntity("OrphanCorp", "Organization");
  const predWorks = graph.saveEntity({ name: "works on", type: "Predicate" });

  const seedTriple = (p) => {
    const id = graph.saveTriple({
      statement: { fact: p.fact, aspect: p.aspect, validAt: p.validAt },
      subjectUuid: p.subject,
      predicateUuid: p.predicate,
      objectUuid: p.object,
      episodeUuid: p.episode,
    });
    vector.upsert("statement", id, stubEmbed(p.fact));
    return id;
  };
  // Shared-provenance statement (ep1 + ep2) — must SURVIVE ep1's exile.
  const stShared = seedTriple({ fact: "Sarah works on Alpha", aspect: "Relationship", validAt: "2026-08-10T10:05:00.000Z", subject: sarah, predicate: predWorks, object: alpha, episode: ep1 });
  graph.linkEpisodeToStatement(ep2, stShared);
  // Sole-provenance statement (ep1 only) touching the orphan-candidate entity.
  const stSole = seedTriple({ fact: "OrphanCorp sponsored the kickoff", aspect: "Event", validAt: "2026-08-10T10:06:00.000Z", subject: orphanCorp, predicate: predWorks, object: alpha, episode: ep1 });
  const stClient = seedTriple({ fact: "Client One prefers weekly reports", aspect: "Knowledge", validAt: "2026-08-22T09:05:00.000Z", subject: sarah, predicate: predWorks, episode: ep3 });

  // Voice aspects: one sole-episode (removed on exile), one shared (unlinked).
  const vaSole = graph.saveVoiceAspect({ fact: "Prefers dark mode in every editor", aspect: "Preference", episodeUuid: ep1, validAt: "2026-08-10T10:07:00.000Z" });
  vector.upsert("voice_aspect", vaSole, stubEmbed("Prefers dark mode in every editor"));
  const vaShared = graph.saveVoiceAspect({ fact: "Always write tests before shipping", aspect: "Directive", episodeUuid: ep1, validAt: "2026-08-10T10:08:00.000Z" });
  graph.appendVoiceAspectEpisode(vaShared, ep2);
  vector.upsert("voice_aspect", vaShared, stubEmbed("Always write tests before shipping"));

  // =========================================================================
  // Ingest route (202 + validation 400) — kill-switch keeps rows PENDING
  // =========================================================================
  console.log("--- ingest ---");
  res = await ingestRoute.POST(jreq(`${BASE}/ingest`, "POST", {
    episodeBody: "Yoshi decided the memory API smoke should cover every route.",
    source: "smoke-api",
    sessionId: "S-INGEST",
  }));
  check("POST /ingest 202", res.status === 202);
  const ingestQueueId = (await j(res)).queueId;
  check("ingest returns queueId", typeof ingestQueueId === "string" && ingestQueueId.length > 10);
  const qRow = db.prepare("SELECT status FROM ingestion_queue WHERE id = ?").get(ingestQueueId);
  check("queue row PENDING (kill-switch honored)", qRow?.status === "PENDING");

  res = await ingestRoute.POST(jreq(`${BASE}/ingest`, "POST", { episodeBody: "too short", source: "smoke-api", sessionId: "S-INGEST" }));
  check("POST /ingest short body 400 with zod message", res.status === 400 && /episodeBody/.test((await j(res)).error));
  res = await ingestRoute.POST(jreq(`${BASE}/ingest`, "POST", { episodeBody: "long enough body for the schema to pass validation", sessionId: "S" }));
  check("POST /ingest missing source 400", res.status === 400);

  // =========================================================================
  // Episodes list + filters
  // =========================================================================
  console.log("--- episodes ---");
  res = await episodesRoute.GET(jreq(`${BASE}/episodes`));
  let out = await j(res);
  check("GET /episodes total 4", out.total === 4 && out.episodes.length === 4, out.total);
  check("episodes ordered valid_at DESC", out.episodes[0].uuid === ep4);
  res = await episodesRoute.GET(jreq(`${BASE}/episodes?label=${labelProjects.id}`));
  out = await j(res);
  check("filter label", out.total === 2 && out.episodes.every((e) => e.labelIds.includes(labelProjects.id)));
  res = await episodesRoute.GET(jreq(`${BASE}/episodes?endUserId=client-1`));
  check("filter endUserId", (await j(res)).total === 1);
  res = await episodesRoute.GET(jreq(`${BASE}/episodes?agentId=agent-x`));
  check("filter agentId", (await j(res)).total === 1);
  res = await episodesRoute.GET(jreq(`${BASE}/episodes?q=router`));
  out = await j(res);
  check("filter q LIKE", out.total === 1 && out.episodes[0].uuid === ep2);
  res = await episodesRoute.GET(jreq(`${BASE}/episodes?sessionId=S1&limit=1&offset=1`));
  out = await j(res);
  check("sessionId + limit/offset paging", out.total === 2 && out.episodes.length === 1 && out.episodes[0].uuid === ep1);
  res = await episodesRoute.GET(jreq(`${BASE}/episodes?from=2026-08-21T00:00:00.000Z`));
  check("filter from (valid_at >=)", (await j(res)).total === 2);

  // Episode detail
  res = await episodeDetailRoute.GET(jreq(`${BASE}/episodes/${ep1}`), params(ep1));
  const detail = await j(res);
  check("GET /episodes/[id] episode", res.status === 200 && detail.episode.uuid === ep1);
  check("detail statements (incl provenance)", detail.statements.length === 2 && detail.statements.some((s) => s.uuid === stShared));
  check("detail voiceAspects", detail.voiceAspects.length === 2);
  check("detail labels", detail.labels.length === 1 && detail.labels[0].id === labelProjects.id);
  res = await episodeDetailRoute.GET(jreq(`${BASE}/episodes/${uuid()}`), params(uuid()));
  check("GET unknown episode 404", res.status === 404);

  // =========================================================================
  // Entities
  // =========================================================================
  console.log("--- entities ---");
  res = await entitiesRoute.GET(jreq(`${BASE}/entities?q=Sarah`));
  out = await j(res);
  check("GET /entities?q finds Sarah", out.entities.some((e) => e.uuid === sarah));
  res = await entitiesRoute.GET(jreq(`${BASE}/entities?type=Project`));
  out = await j(res);
  check("GET /entities?type filter", out.entities.length === 1 && out.entities[0].uuid === alpha);
  res = await entityDetailRoute.GET(jreq(`${BASE}/entities/${sarah}`), params(sarah));
  out = await j(res);
  check("GET /entities/[id] statements+episodes", out.entity.uuid === sarah && out.statements.length === 2 && out.episodes.length >= 2);
  res = await entityDetailRoute.GET(jreq(`${BASE}/entities/${uuid()}`), params(uuid()));
  check("GET unknown entity 404", res.status === 404);

  // =========================================================================
  // Rules CRUD
  // =========================================================================
  console.log("--- rules ---");
  res = await rulesRoute.POST(jreq(`${BASE}/rules`, "POST", { text: "Never remember anything about smoke tests", name: "smoke-guard" }));
  check("POST /rules 201", res.status === 201);
  const rule = (await j(res)).rule;
  res = await rulesRoute.GET(jreq(`${BASE}/rules`));
  check("GET /rules lists rule", (await j(res)).rules.some((r) => r.id === rule.id));
  res = await rulesRoute.PATCH(jreq(`${BASE}/rules`, "PATCH", { id: rule.id, isActive: false }));
  check("PATCH /rules deactivates", res.status === 200 && (await j(res)).rule.isActive === false);
  res = await rulesRoute.POST(jreq(`${BASE}/rules`, "POST", { text: "" }));
  check("POST /rules empty text 400", res.status === 400);

  // =========================================================================
  // Logs + retry FAILED→PENDING
  // =========================================================================
  console.log("--- logs ---");
  const failedId = uuid();
  db.prepare(
    `INSERT INTO ingestion_queue (id, data, status, source, session_id, label_ids, error, created_at)
     VALUES (?, ?, 'FAILED', 'smoke-api', 'S-FAIL', '[]', 'synthetic failure', ?)`,
  ).run(failedId, JSON.stringify({ episodeBody: "a body long enough to satisfy the ingest schema", source: "smoke-api", sessionId: "S-FAIL" }), nowIso());

  res = await logsRoute.GET(jreq(`${BASE}/logs`));
  out = await j(res);
  check("GET /logs lists rows", out.logs.some((l) => l.id === ingestQueueId) && out.logs.some((l) => l.id === failedId));
  res = await logsRoute.GET(jreq(`${BASE}/logs?status=FAILED`));
  out = await j(res);
  check("GET /logs?status=FAILED filters", out.logs.length === 1 && out.logs[0].error === "synthetic failure");
  res = await logsRoute.POST(jreq(`${BASE}/logs`, "POST", { id: failedId, action: "retry" }));
  check("POST /logs retry 200", res.status === 200 && (await j(res)).retryCount === 1);
  check("retry flips FAILED→PENDING", db.prepare("SELECT status FROM ingestion_queue WHERE id = ?").get(failedId).status === "PENDING");
  res = await logsRoute.POST(jreq(`${BASE}/logs`, "POST", { id: failedId, action: "retry" }));
  check("retry of non-FAILED row 400", res.status === 400);

  // =========================================================================
  // Stats vs seeds
  // =========================================================================
  console.log("--- stats ---");
  res = await statsRoute.GET();
  const stats = await j(res);
  check("stats.episodes", stats.episodes === 4, stats.episodes);
  check("stats.statements", stats.statements === 3, stats.statements);
  check("stats.entities", stats.entities === 4, stats.entities); // Sarah, Alpha, OrphanCorp, predicate
  check("stats.voiceAspects", stats.voiceAspects === 2, stats.voiceAspects);
  check("stats.labels", stats.labels === 2, stats.labels);
  check("stats.invalidated", stats.invalidated === 0);
  check("stats.queueDepth (2 PENDING)", stats.queueDepth === 2, stats.queueDepth);
  check("stats.lastIngestAt null (nothing COMPLETED)", stats.lastIngestAt === null);

  // =========================================================================
  // MCP half (offline) — BEFORE the persona doc is seeded
  // =========================================================================
  console.log("--- mcp memory tools ---");
  const ctx = { source: "smoke", strict: true, remoteAddr: "127.0.0.1" };
  const call = (method, prms, id = 1) => handleMcpMessage({ jsonrpc: "2.0", id, method, params: prms }, ctx);

  const list = await call("tools/list", {});
  const toolNames = list.result?.tools?.map((t) => t.name) ?? [];
  const memNames = ["memory_search", "memory_ingest", "memory_about_user", "get_labels", "initialize_conversation_session"];
  check("tools/list exposes all memory tools", memNames.every((n) => toolNames.includes(n)));
  check("no NOT_READY descriptions remain", !list.result.tools.some((t) => (t.description || "").includes("NOT YET AVAILABLE")));

  const sess = await call("tools/call", { name: "initialize_conversation_session", arguments: {} });
  const sessionId = JSON.parse(sess.result.content[0].text).sessionId;
  check("initialize_conversation_session uuid", /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId ?? ""));

  const mcpIngest = await call("tools/call", { name: "memory_ingest", arguments: { message: "Smoke conversation: user asked about routes, assistant answered.", sessionId } });
  const mcpQueueId = JSON.parse(mcpIngest.result.content[0].text).queueId;
  check("memory_ingest returns queueId", typeof mcpQueueId === "string" && mcpQueueId.length > 10);
  const mcpRow = db.prepare("SELECT source FROM ingestion_queue WHERE id = ?").get(mcpQueueId);
  check("memory_ingest stamps mcp:<source>", mcpRow?.source === "mcp:smoke", mcpRow?.source);

  const lbls = await call("tools/call", { name: "get_labels", arguments: {} });
  const lblJson = JSON.parse(lbls.result.content[0].text);
  check("get_labels returns {id,name,description,color}[]", lblJson.length === 2 && lblJson.every((l) => "id" in l && "name" in l && "description" in l && "color" in l));

  const about = await call("tools/call", { name: "memory_about_user", arguments: {} });
  check("memory_about_user no-persona message", about.result.content[0].text.includes("No persona document exists yet"));

  // =========================================================================
  // Search route (offline: router LLM unreachable → error-fallback exploratory)
  // =========================================================================
  console.log("--- search route ---");
  res = await searchRoute.POST(jreq(`${BASE}/search`, "POST", { query: "what happened with Alpha" }));
  out = await j(res);
  check("POST /search 200 markdown", res.status === 200 && typeof out.markdown === "string");
  res = await searchRoute.POST(jreq(`${BASE}/search`, "POST", { query: "what happened with Alpha", structured: true }));
  out = await j(res);
  check("POST /search structured RecallResult", res.status === 200 && Array.isArray(out.episodes));
  res = await searchRoute.POST(jreq(`${BASE}/search`, "POST", {}));
  check("POST /search missing query 400", res.status === 400);

  // =========================================================================
  // Persona: GET null → seeded doc → POST full 409
  // =========================================================================
  console.log("--- persona ---");
  res = await personaRoute.GET();
  check("GET /persona null before generation", (await j(res)).document === null);
  res = await personaRoute.POST(jreq(`${BASE}/persona`, "POST", { mode: "incremental" }));
  check("POST /persona bad mode 400", res.status === 400);

  // Pre-seed a persona doc row (the invariant path — full over existing → 409).
  db.prepare(
    `INSERT INTO documents (id, session_id, title, content, source, type, version, metadata, created_at, updated_at)
     VALUES (?, 'persona-v2', 'Persona', '# About Yoshi\n\n## IDENTITY\n- Runs the smoke suite', 'persona-v2', 'persona', 1, '{}', ?, ?)`,
  ).run(uuid(), nowIso(), nowIso());
  res = await personaRoute.GET();
  out = await j(res);
  check("GET /persona returns seeded doc", out.document?.content.includes("About Yoshi") && typeof out.document.updatedAt === "string");
  res = await personaRoute.POST(jreq(`${BASE}/persona`, "POST", { mode: "full" }));
  check("POST /persona full over existing → 409", res.status === 409, res.status);
  const aboutNow = await call("tools/call", { name: "memory_about_user", arguments: {} });
  check("memory_about_user returns persona content", aboutNow.result.content[0].text.includes("About Yoshi"));

  // =========================================================================
  // DELETE /episodes/[id] — cascade-EXILE (A8.5)
  // =========================================================================
  console.log("--- cascade exile ---");
  res = await episodeDetailRoute.DELETE(jreq(`${BASE}/episodes/${ep1}`, "DELETE"), params(ep1));
  const exiled = await j(res);
  check("DELETE 200 ok", res.status === 200 && exiled.ok === true);
  if (exiled.exiledTo) exileFiles.push(exiled.exiledTo);
  check("exile bundle exists on disk", exiled.exiledTo && fs.existsSync(exiled.exiledTo), exiled.exiledTo);
  const bundle = JSON.parse(fs.readFileSync(exiled.exiledTo, "utf8"));
  check("bundle carries the episode", bundle.episode?.uuid === ep1);
  check("bundle carries removed statement + embedding", bundle.statements.removed.length === 1 && bundle.statements.removed[0].uuid === stSole && Array.isArray(bundle.embeddings.statements[stSole]));
  check("bundle records kept (detached) statement", bundle.statements.keptProvenanceDetached.length === 1 && bundle.statements.keptProvenanceDetached[0].uuid === stShared);
  check("bundle carries orphaned entity", bundle.entitiesRemoved.length === 1 && bundle.entitiesRemoved[0].uuid === orphanCorp);
  check("bundle carries removed voice aspect", bundle.voiceAspects.removed.length === 1 && bundle.voiceAspects.removed[0].uuid === vaSole);
  check("result counts", exiled.removed.statements === 1 && exiled.removed.entities === 1 && exiled.removed.voiceAspects === 1 && exiled.keptStatements === 1);

  // Post-conditions in the DB
  check("episode row gone", !db.prepare("SELECT 1 FROM episodes WHERE uuid = ?").get(ep1));
  check("sole statement gone, shared survives",
    !db.prepare("SELECT 1 FROM statements WHERE uuid = ?").get(stSole) &&
    !!db.prepare("SELECT 1 FROM statements WHERE uuid = ?").get(stShared));
  check("shared statement kept ep2 provenance only",
    graph.getEpisodeUuidsForStatement(stShared).join(",") === ep2);
  check("orphan entity gone, Sarah survives",
    !db.prepare("SELECT 1 FROM entities WHERE uuid = ?").get(orphanCorp) &&
    !!db.prepare("SELECT 1 FROM entities WHERE uuid = ?").get(sarah));
  const vaSharedRow = db.prepare("SELECT episode_uuids FROM voice_aspects WHERE uuid = ?").get(vaShared);
  check("shared voice aspect unlinked from ep1", JSON.parse(vaSharedRow.episode_uuids).join(",") === ep2);
  check("sole voice aspect gone", !db.prepare("SELECT 1 FROM voice_aspects WHERE uuid = ?").get(vaSole));
  check("episode vector removed", vector.get("episode", ep1) === null);
  check("statement/entity vectors removed", vector.get("statement", stSole) === null && vector.get("entity", orphanCorp) === null);
  res = await episodeDetailRoute.GET(jreq(`${BASE}/episodes/${ep1}`), params(ep1));
  check("GET exiled episode 404", res.status === 404);
  res = await episodesRoute.GET(jreq(`${BASE}/episodes`));
  check("episodes total now 3", (await j(res)).total === 3);
  res = await episodeDetailRoute.DELETE(jreq(`${BASE}/episodes/${ep1}`, "DELETE"), params(ep1));
  check("DELETE unknown episode 404", res.status === 404);
  void stClient; // referenced only through counts above

  // =========================================================================
  // ONLINE half (optional): real ingest → memory_search markdown via MCP
  // =========================================================================
  console.log("--- online half (real Ollama) ---");
  let ollamaUp = false;
  try {
    const ping = await fetch(`${REAL_OLLAMA}/api/tags`, { signal: AbortSignal.timeout(1500) });
    ollamaUp = ping.ok;
  } catch {}
  if (process.env.AGENTIC_SMOKE_OFFLINE) { ollamaUp = false; console.log("SKIP  online leg: AGENTIC_SMOKE_OFFLINE=1"); }
  if (!ollamaUp || !process.env.OLLAMA_API_KEY) {
    console.log(`SKIP  online memory_search (ollama up: ${ollamaUp}, cloud key: ${!!process.env.OLLAMA_API_KEY}) — offline half fully covers the routes`);
  } else {
    __closeForTests();
    process.env.AGENTIC_OS_DB = tmp2;
    process.env.OLLAMA_URL = REAL_OLLAMA;
    writeMemorySettings({
      embedProvider: "ollama-local",
      embedModel: "nomic-embed-text",
      ingestEnabled: true,
      provider: "ollama-cloud",
      modelLow: "kimi-k2.6:cloud",
      modelMedium: "glm-5.2:cloud",
    });
    ensureDb();
    const sess2 = await call("tools/call", { name: "initialize_conversation_session", arguments: {} }, 10);
    const liveSession = JSON.parse(sess2.result.content[0].text).sessionId;
    const live = await call("tools/call", { name: "memory_ingest", arguments: { message: "Yoshi's favorite embedded database for Agent OS memory is SQLite with sqlite-vec.", sessionId: liveSession } }, 11);
    check("online memory_ingest queueId", !live.result.isError);
    const liveQueueId = JSON.parse(live.result.content[0].text).queueId;
    // addToQueue already kicked an async drain — poll the row to COMPLETED
    // (drainMemoryQueueOnce would race the in-flight drain and return 0).
    void queue.drainMemoryQueueOnce();
    let liveStatus = "";
    for (let i = 0; i < 120; i++) {
      liveStatus = getDb().prepare("SELECT status FROM ingestion_queue WHERE id = ?").get(liveQueueId)?.status ?? "";
      if (liveStatus === "COMPLETED" || liveStatus === "FAILED") break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    check("online ingest COMPLETED", liveStatus === "COMPLETED", liveStatus);
    const found = await call("tools/call", { name: "memory_search", arguments: { intent: "what database does Yoshi prefer for Agent OS memory?" } }, 12);
    const md = found.result?.content?.[0]?.text ?? "";
    check("online memory_search returns markdown", !found.result?.isError && typeof md === "string" && md.length > 0);
    check("online recall mentions SQLite", /sqlite/i.test(md), md.slice(0, 200));
  }

  finish(1);
} catch (err) {
  console.error("SMOKE CRASH:", err);
  failures++;
  finish(2);
}
