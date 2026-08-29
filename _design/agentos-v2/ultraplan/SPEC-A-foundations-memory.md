# SPEC A — Foundations (F1–F4) + Memory V2 (A1–A10)

Status: IMPLEMENTATION-READY. Written 2026-08-27 against MASTER-PLAN.md + DOCS-CHEATSHEET.md + AgentOSCore recon.
Reference repo (READ-ONLY): `C:/Users/Yoshi/Documents/JulianGolde - AgenticOS/AgentOSCore` (below: `REF/`).
Target repo: `C:/Users/Yoshi/Documents/JulianGolde - AgenticOS/agent-os` (below: repo root).

---

## 1. Scope & goals

This spec covers the entire Phase-0 foundation plus Phase-1 Memory V2:

| ID | Item | Delivered by |
|---|---|---|
| F1 | SQLite data layer: `better-sqlite3` + `sqlite-vec`, `~/.agentic-os/agentos.db`, hand-rolled migrations in `src/lib/v2/db.ts` | §2, §7 tasks F1.* |
| F2 | Typed in-process event bus + persisted event log; RRULE scheduler with DB-persisted jobs, boots from `instrumentation.ts` | §2, §3, §7 F2.* |
| F3 | Capability layer skeleton: slots `coding`/`exec`/`files` (+`browser` stub), manifests, allow/deny globs, folder scopes in settings | §3, §7 F3.* |
| F4 | Internal MCP endpoint `/api/mcp`: `get_actions`/`execute_action` on-demand loading, `?source=` tagging, memory tools | §5, §7 F4.* |
| A1 | Memory schema: episodes / entities (11 types) / statements (12 aspects) / edges / labels / documents / voice aspects / 6 vector namespaces | §2 |
| A2 | Ingestion pipeline with queue statuses + logs UI | §3, §7 A2.* |
| A3 | Contradiction handling: temporal chains (`invalidAt`/`invalidatedBy`), "currently X, previously Y" rendering | §2 DDL, ingest resolution + formatter tasks |
| A4 | Search V2: router (label vector match + extractAspects LLM, confidence gate 0.2) → 6 handlers → merge/rerank/token-budget | §3, §7 A4.* |
| A5 | Session compaction (per-episode incremental, `coveredUntil` watermark), searchable via exploratory handler | §7 A5.* |
| A6 | Persona document generator (full + incremental modes, worthiness gate, tombstones) | §7 A6.* |
| A7 | API + MCP tools: `memory_search`, `memory_ingest`, `memory_about_user` + REST mirrors under `/api/v2/memory/*` | §5, §7 A7.* |
| A8 | Memory page UI overhaul (episode browser, entity view, aspect filters, labels manager, ingestion logs, manual upload, gear) | §6, §7 A8.* |
| A9 | One-shot migration: `.memsearch/memory/*.md`, `~/.agentic-os/jarvis-memory.jsonl`, agents `memory/*.md` → `legacy`-labeled episodes | §7 A9.* |
| A10 | MemOS evaluation checkpoint: measurable criteria before freezing Memory V2 APIs | §7 A10.* |

Non-goals here: Tasks (B), Jarvis omnipresence (C), WebMCP builder (D), browser slot implementation (E), integrations (G). This spec only guarantees the surfaces those consume: db.ts, events, scheduler, capability gate, `/api/mcp` registry, memory read/write APIs.

### Ground-rule bindings (from MASTER-PLAN §0 + AGENTS.md)
- Rule 16: every knob below ships in a `ConfigMenu` gear backed by `src/lib/settings.ts` (`settings.memory`, `settings.capability`, `settings.mcp`, `settings.scheduler` subtrees).
- Rule 17: ALL prompts are data files (`src/lib/v2/memory/prompts/*.ts` exporting plain strings), injected into whichever provider is selected. Never provider-branched prompt code.
- Rule 11 (provider routing): all LLM calls go through a single `modelCall()` in `src/lib/v2/memory/llm.ts` that dispatches to `cliComplete` / Ollama (cloud or local) / MiniMax per `settings.memory.provider`. Empty output throws. No silent fallback.
- Append-never-destroy: statements/voice-aspects get `invalid_at`, never DELETE (the two sanctioned deletes are: a *duplicate* statement/aspect whose provenance was first moved to the survivor, and orphaned entity embeddings — both per upstream semantics; everything else is invalidation).
- Windows-first: no `fs.watch`, all spawns via `sanitizeSpawnEnv`, ISO-string UTC timestamps compared lexically (never mix representations — upstream had this bug).

---

## 2. Data model — SQLite DDL

DB file: `~/.agentic-os/agentos.db` (path helper `dbPath()` honors `AGENTIC_OS_DB` env override for tests). `PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;`

**Timestamps:** every `*_at` column is a UTC ISO-8601 string (`new Date().toISOString()`). Lexical order == chronological order. Never store epoch ms.

**Single-user collapse:** upstream `workspaceId` is dropped. `user_id TEXT NOT NULL DEFAULT 'owner'` is KEPT (future agent-scoped views), `end_user_id TEXT` (counterparty scoping) is KEPT and threaded through every episode/document query.

### 2.1 Migration harness (F1)

```sql
CREATE TABLE IF NOT EXISTS migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- meta rows written by migration 1: schema_version, embed_model, embed_dim, created_at
```

`db.ts` runs `MIGRATIONS: {version, name, up(db)}[]` inside a transaction at first open per process; migrations are forward-only (no down — recovery is restore-from-backup, matching exile philosophy).

### 2.2 Foundations tables (F2)

```sql
-- F2 event log (Homepage feed + audit)
CREATE TABLE events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,              -- 'memory.ingested','memory.invalidated','job.fired','task.created',...
  source     TEXT,                       -- module/agent that emitted
  payload    TEXT NOT NULL DEFAULT '{}', -- JSON
  created_at TEXT NOT NULL
);
CREATE INDEX idx_events_type_time ON events(type, created_at DESC);
CREATE INDEX idx_events_time ON events(created_at DESC);

-- F2 scheduler jobs (RRULE or one-shot)
CREATE TABLE jobs (
  id          TEXT PRIMARY KEY,          -- uuid
  kind        TEXT NOT NULL,             -- handler key registered in code: 'memory.compaction.sweep','db.backup',...
  name        TEXT NOT NULL,
  payload     TEXT NOT NULL DEFAULT '{}',
  rrule       TEXT,                      -- RRULE string; NULL = one-shot
  run_at      TEXT,                      -- next fire (ISO); recomputed after each run
  last_run_at TEXT,
  last_status TEXT,                      -- 'ok'|'error'|'skipped'
  last_error  TEXT,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_jobs_due ON jobs(enabled, run_at);

-- A2 ingestion queue (mirrors upstream IngestionQueue)
CREATE TABLE ingestion_queue (
  id           TEXT PRIMARY KEY,         -- uuid
  data         TEXT NOT NULL,            -- JSON IngestBody
  output       TEXT,                     -- JSON per-episode results
  status       TEXT NOT NULL DEFAULT 'PENDING', -- PENDING|PROCESSING|COMPLETED|FAILED
  stage        TEXT,                     -- 'preprocess'|'ingest'|'resolution'|'labels'|'compaction'|'persona'
  priority     INTEGER NOT NULL DEFAULT 0,
  source       TEXT NOT NULL,            -- 'mcp:claude-code','jarvis','manual','migration:memsearch',...
  title        TEXT,
  session_id   TEXT,
  graph_ids    TEXT NOT NULL DEFAULT '[]', -- JSON episode uuids
  label_ids    TEXT NOT NULL DEFAULT '[]',
  error        TEXT,
  retry_count  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  processed_at TEXT
);
CREATE INDEX idx_iq_status ON ingestion_queue(status, created_at DESC);

CREATE TABLE ingestion_rules (
  id         TEXT PRIMARY KEY,
  name       TEXT,
  text       TEXT NOT NULL,              -- free NL rule injected into normalize prompt
  source     TEXT,                       -- NULL = all sources
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
```

### 2.3 Memory graph tables (A1)

```sql
CREATE TABLE episodes (
  uuid             TEXT PRIMARY KEY,
  content          TEXT NOT NULL,        -- normalized (LLM-enriched)
  original_content TEXT NOT NULL,        -- verbatim, never mutated
  metadata         TEXT NOT NULL DEFAULT '{}',
  source           TEXT NOT NULL,
  type             TEXT NOT NULL DEFAULT 'CONVERSATION', -- CONVERSATION|DOCUMENT|IMAGE
  session_id       TEXT NOT NULL,        -- REQUIRED: groups chunks/conversation
  queue_id         TEXT,
  chunk_index      INTEGER,
  total_chunks     INTEGER,
  version          INTEGER NOT NULL DEFAULT 1,
  content_hash     TEXT,
  chunk_hashes     TEXT,                 -- JSON string[]
  user_id          TEXT NOT NULL DEFAULT 'owner',
  end_user_id      TEXT,
  recall_count     INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  valid_at         TEXT NOT NULL         -- reference time of the content
);
CREATE INDEX idx_ep_session ON episodes(session_id, valid_at);
CREATE INDEX idx_ep_valid ON episodes(valid_at DESC);
CREATE INDEX idx_ep_enduser ON episodes(end_user_id);

CREATE TABLE entities (
  uuid       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  type       TEXT,                       -- Person|Organization|Place|Event|Project|Task|Technology|Product|Standard|Concept|Predicate
  attributes TEXT NOT NULL DEFAULT '{}', -- lookup data: email/phone/role/company
  user_id    TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_ent_name ON entities(name COLLATE NOCASE);

CREATE TABLE statements (
  uuid           TEXT PRIMARY KEY,
  fact           TEXT NOT NULL,          -- natural sentence, <=15 words, subject-first
  aspect         TEXT NOT NULL,          -- Identity|Knowledge|Decision|Event|Problem|Relationship|Task
  attributes     TEXT NOT NULL DEFAULT '{}', -- holds event_date for Event aspect
  user_id        TEXT NOT NULL DEFAULT 'owner',
  created_at     TEXT NOT NULL,
  valid_at       TEXT NOT NULL,
  invalid_at     TEXT,                   -- NULL = current (temporal chain; NEVER delete on contradiction)
  invalidated_by TEXT                    -- episode uuid that invalidated it
);
CREATE INDEX idx_st_valid ON statements(valid_at DESC);
CREATE INDEX idx_st_aspect ON statements(aspect, invalid_at);

-- Replaces Neo4j entirely. 4 edge types.
CREATE TABLE edges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL CHECK (type IN ('provenance','subject','predicate','object')),
  from_uuid  TEXT NOT NULL,              -- provenance: episode uuid; others: statement uuid
  to_uuid    TEXT NOT NULL,              -- provenance: statement uuid; others: entity uuid
  created_at TEXT NOT NULL,
  UNIQUE(type, from_uuid, to_uuid)       -- MERGE semantics
);
CREATE INDEX idx_edges_from ON edges(from_uuid, type);
CREATE INDEX idx_edges_to ON edges(to_uuid, type);

CREATE TABLE labels (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT,
  color       TEXT NOT NULL,             -- auto OKLCH on create
  created_at  TEXT NOT NULL
);

-- SQLite has no array-overlap: junction tables replace labelIds[]
CREATE TABLE episode_labels (
  episode_uuid TEXT NOT NULL,
  label_id     TEXT NOT NULL,
  PRIMARY KEY (episode_uuid, label_id)
);
CREATE INDEX idx_eplab_label ON episode_labels(label_id);
CREATE TABLE document_labels (
  document_id TEXT NOT NULL,
  label_id    TEXT NOT NULL,
  PRIMARY KEY (document_id, label_id)
);

-- Voice aspects (Directive|Preference|Habit|Belief|Goal|Task) — stored WHOLE, never SPO
CREATE TABLE voice_aspects (
  uuid           TEXT PRIMARY KEY,
  fact           TEXT NOT NULL,
  aspect         TEXT NOT NULL,
  episode_uuids  TEXT NOT NULL DEFAULT '[]', -- JSON; duplicates append survivor's list
  user_id        TEXT NOT NULL DEFAULT 'owner',
  created_at     TEXT NOT NULL,
  valid_at       TEXT NOT NULL,
  invalid_at     TEXT,
  invalidated_by TEXT
);
CREATE INDEX idx_va_aspect ON voice_aspects(aspect, invalid_at, valid_at DESC);

-- Compacted sessions + persona doc + ingested documents (upstream Document)
CREATE TABLE documents (
  id           TEXT PRIMARY KEY,
  session_id   TEXT,                     -- UNIQUE for type='conversation'
  title        TEXT NOT NULL,
  content      TEXT NOT NULL,            -- markdown
  source       TEXT,
  type         TEXT NOT NULL,            -- 'conversation' (session compact) | 'document' | 'persona'
  version      INTEGER NOT NULL DEFAULT 1,
  content_hash TEXT,
  chunk_hashes TEXT,
  end_user_id  TEXT,
  metadata     TEXT NOT NULL DEFAULT '{}', -- {episodeCount, compactedAt, coveredUntil}
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_doc_session ON documents(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX idx_doc_type ON documents(type, updated_at DESC);

CREATE TABLE recall_logs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  query            TEXT NOT NULL,
  query_type       TEXT,
  search_method    TEXT NOT NULL DEFAULT 'search_v2',
  result_count     INTEGER NOT NULL DEFAULT 0,
  response_time_ms INTEGER,
  context          TEXT NOT NULL DEFAULT '{}', -- full router output JSON
  created_at       TEXT NOT NULL
);
```

### 2.4 Vector namespaces (A1, sqlite-vec)

Six namespaces, one `vec0` virtual table each, dimension pinned at migration time from `meta.embed_dim` (default **768** — `nomic-embed-text` via Ollama). rowids are managed integers; a sibling map table binds rowid ↔ domain uuid so KNN joins are plain SQL.

```sql
-- repeated for ns in: episode, statement, entity, label, voice_aspect, compacted_session
CREATE VIRTUAL TABLE vec_episode USING vec0(embedding float[768]);
CREATE TABLE vecmap_episode (
  rowid INTEGER PRIMARY KEY,             -- == vec_episode rowid
  uuid  TEXT NOT NULL UNIQUE             -- episode uuid / statement uuid / entity uuid / label id / voice uuid / document id
);
```

**Query pattern (port of pgvector CTE two-stage):** KNN with `expandedLimit = max(limit*2, 100)`:

```sql
SELECT m.uuid, (1.0 - v.distance/2.0) AS score   -- vec0 cosine distance ∈ [0,2] when using vec_distance_cosine ordering
FROM vec_episode v JOIN vecmap_episode m ON m.rowid = v.rowid
WHERE v.embedding MATCH :query AND k = :expandedLimit
ORDER BY v.distance;
```

then filter `score >= threshold` AND metadata filters (labels via junction join, `session_id`, `end_user_id`, exclude-ids) **outside** the KNN, in a wrapping SELECT or JS — sqlite-vec has the same no-threshold-pushdown property as pgvector HNSW. `vector.ts` exposes the upstream provider contract: `search(ns, embedding, {limit, threshold, filters})`, `batchScore(ns, embedding, uuids) → Map<uuid,score>`, `upsert(ns, uuid, embedding)`, `remove(ns, uuid)`, `get(ns, uuid)`.

**Distance→similarity:** store L2-normalized vectors and use `distance_metric=cosine`; similarity = `1 - distance`. Exclude NaN. (Verify exact vec0 distance semantics in F1.4's smoke test before locking the formula — the constant is isolated in one function `distToSim()`.)

**Fallback (decision gate F1.4):** if `sqlite-vec` prebuilt fails to load on this Windows/Node build, `vector.ts` swaps to a brute-force JS cosine over a plain `embeddings(ns, uuid, vector BLOB)` table behind the same interface. Measure at 10k vectors; only then consider alternatives.

---

## 3. Module layout

All new server code under `src/lib/v2/`; client-safe types in files with NO node imports (convention from `agentsTypes.ts`).

```
src/lib/v2/
  db.ts                      # F1: open/migrate singleton (globalThis.__agentosDb), dbPath(), tx helpers
  dbSchema.ts                # F1: MIGRATIONS array (DDL strings above)
  ids.ts                     # uuid + now() ISO helpers
  events.ts                  # F2: typed bus on globalThis.__agentosBus + persist to events table + SSE fanout
  eventTypes.ts              # F2: client-safe event name/payload types
  scheduler.ts               # F2: RRULE tick loop (30s), jobs table CRUD, handler registry, rehydrate on boot
  capability/
    types.ts                 # F3: client-safe Slot/Manifest/Scope types
    manifest.ts              # F3: slot manifests (coding/exec/files/browser-stub)
    gate.ts                  # F3: allow/deny glob eval + folder-scope check (settings.capability)
    slots.ts                 # F3: execSlot→runner.run, codingSlot→cliComplete/spawnStream, filesSlot→scoped fs
  mcp/
    registry.ts              # F4: Action {key,module,description,inputSchema(zod),handler}; register/get/search
    server.ts                # F4: MCP server factory (@modelcontextprotocol/sdk), tools: get_actions/execute_action + memory tools
  memory/
    constants.ts             # every numeric threshold (verbatim from upstream — see task A4.1)
    types.ts                 # client-safe: nodes, aspects, RouterOutput, RecallResult, SearchV2Options
    embed.ts                 # Ollama embeddings (local 127.0.0.1:11434 or cloud per settings), dim guard vs meta.embed_dim
    llm.ts                   # modelCall(complexity 'low'|'medium', messages, {schema?}) → provider-routed; <output>-tag + JSON fallbacks
    graph.ts                 # node/edge CRUD: saveTriple, moveAllProvenanceToStatement, invalidateStatements, orphan cleanup
    vector.ts                # 6-namespace provider (see §2.4)
    chunker.ts               # gpt-tokenizer; 1800 needsChunking / 1250 target / 750 min / 100 minParagraph; sha256 hashes
    queue.ts                 # A2: in-process job chain runner on globalThis (concurrency 1), status writes to ingestion_queue
    ingest.ts                # A2: preprocess → normalize → extract×2 → reflect×2 → classify×2 → save triples/voice
    resolution.ts            # A2/A3: entity dedupe, statement duplicate/contradiction, aspect-resolution (duplicate/evolution/new)
    labels.ts                # label extraction + exact→0.85-semantic→create ladder, OKLCH color gen
    compaction.ts            # A5: incremental session compact + coveredUntil watermark + Document upsert
    persona.ts               # A6: trigger + full + incremental generation, tombstones, worthiness gate
    search/
      router.ts              # A4: searchLabels (0.7) + extractAspects structured call, gate confidence<0.2
      handlers.ts            # A4: 6 handlers, 3-path merge, rerank (batchScore), replaceWithCompacts, token budget
      formatter.ts           # A4: markdown + structured RecallResult output (incl. Invalidated Facts section)
      index.ts               # A4: searchV2() entry + recall_logs write
    mcpTools.ts              # A7: memory_ingest/memory_search/memory_about_user/get_labels/initialize_conversation_session defs
    migrate.ts               # A9: memsearch/.remember/jarvisMemory/agents-memory importers
    prompts/
      normalize.ts extract-world.ts extract-voice.ts reflect-world.ts reflect-voice.ts
      classify-world.ts classify-voice.ts statements.ts nodes.ts aspect-resolution.ts
      label-assignment.ts compaction.ts router.ts persona.ts   # ported near-verbatim from REF (rule 17: plain string data)

src/app/api/
  mcp/route.ts                           # F4 (POST/GET/DELETE per Streamable HTTP)
  v2/events/route.ts                     # GET recent events (poll)
  v2/events/stream/route.ts              # GET SSE live feed
  v2/jobs/route.ts                       # GET list / POST create / PATCH toggle
  v2/memory/ingest/route.ts              # POST → queue
  v2/memory/search/route.ts              # POST → searchV2
  v2/memory/episodes/route.ts            # GET list (filters: label, session, endUser, time, q)
  v2/memory/episodes/[id]/route.ts       # GET detail (+facts), DELETE = cascade-exile (see A8.5)
  v2/memory/entities/route.ts            # GET list/search
  v2/memory/entities/[id]/route.ts       # GET entity + statements + episodes
  v2/memory/labels/route.ts              # GET/POST/PATCH
  v2/memory/logs/route.ts                # GET ingestion_queue rows / POST retry
  v2/memory/rules/route.ts               # GET/POST/PATCH ingestion_rules
  v2/memory/persona/route.ts             # GET doc / POST regenerate(full, only when absent)
  v2/memory/migrate/route.ts             # POST run importer {source, dryRun}
  v2/memory/stats/route.ts               # GET counts for page header + golden dashboards

src/components/v2/memory/                # §6
scripts/v2/                              # §9
```

Every route: `export const runtime = "nodejs"; export const dynamic = "force-dynamic";` + `cache-control: no-store` (repo convention).

**Boot wiring:** `src/instrumentation.ts` `register()` adds (after existing `ensureScheduler()`/`ensureIdeaDaily()`): `const { ensureDb } = await import("./lib/v2/db"); ensureDb();` then `ensureV2Scheduler()` and `ensureMemoryQueue()`. All idempotent via globalThis flags.

**settings.ts additions** (typed subtrees, all surfaced in gears):

```ts
memory: {
  provider: "ollama-cloud" | "ollama-local" | "cli" | "minimax";  // default "ollama-cloud"
  modelLow: string;    // cheap tier (default: kimi-k2.6 cloud tag; user-editable)
  modelMedium: string; // default glm-5.2:cloud
  embedProvider: "ollama-local" | "ollama-cloud";                 // default local
  embedModel: string;  // default "nomic-embed-text" (768d) — change requires re-embed script
  ingestEnabled: boolean;           // master kill-switch, default true
  compactionEnabled: boolean;       // default true
  personaAutoUpdate: boolean;       // default true
  tokenBudget: number;              // default 10000
  labelRouterThreshold: number;     // default 0.7 (mirrors SEARCH_LABEL_VECTOR_THRESHOLD)
}
capability: {
  folders: { path: string; scopes: ("files"|"coding"|"exec")[] }[];  // empty = permissive first-run
  execAllow: string[];  // "Bash(<glob>)" style; empty = all non-denied
  execDeny: string[];   // ALWAYS additive to built-in deny (rm/Remove-Item/del/force-push/hard-reset/git clean)
  browserEnabled: boolean; // stub, default false
}
mcp: { secret?: string }                 // shown as "configured ✓" only
scheduler: { tickSeconds: number }       // default 30
```

---

## 4. Port map

Strategies: **V** = verbatim-adapt (copy, swap providers/db calls), **P** = pattern-only (reimplement to the same contract), **S** = skip.

| REF file (AgentOSCore) | Our file | Strategy | Notes |
|---|---|---|---|
| `apps/webapp/app/services/search-v2/types.ts` | `src/lib/v2/memory/types.ts` | V | interfaces, zod schemas, ASPECT_DEFINITIONS, QUERY_TYPE_DEFINITIONS |
| `apps/webapp/app/services/search-v2/router.ts` | `memory/search/router.ts` | V | keep both prompt variants (with/without label matches) + separate cache keys |
| `apps/webapp/app/services/search-v2/handlers.ts` | `memory/search/handlers.ts` | V | Cypher→SQL joins over `edges`; keep 3-path merge, replaceWithCompacts (>2 episodes), token budget |
| `apps/webapp/app/services/search-v2/formatter.ts` | `memory/search/formatter.ts` | V | markdown sections verbatim incl. 📦/📄 markers + Invalidated Facts |
| `apps/webapp/app/services/knowledgeGraph.server.ts` | `memory/ingest.ts` | V | addEpisode orchestration; swap makeModelCall→llm.ts |
| `apps/webapp/app/services/prompts/*.ts` (normalize, extract-world/voice, reflect-*, classify-*, statements, nodes, aspect-resolution) | `memory/prompts/*.ts` | V | copy near-verbatim; strings only |
| `apps/webapp/app/jobs/ingest/preprocess-episode.logic.ts` | `memory/queue.ts` + `ingest.ts` | V | episodes saved to graph BEFORE ingest jobs (compaction race fix) — keep ordering |
| `apps/webapp/app/jobs/ingest/ingest-episode.logic.ts` | `memory/ingest.ts` | V | |
| `apps/webapp/app/jobs/ingest/graph-resolution.logic.ts` | `memory/resolution.ts` | V | strip contact-sync, credits, multi-tenant |
| `apps/webapp/app/jobs/ingest/aspect-resolution.logic.ts` + `services/aspectStore.server.ts` | `memory/resolution.ts` | V | duplicate/evolution/new; Prisma→better-sqlite3 |
| `apps/webapp/app/jobs/labels/label-assignment.logic.ts` | `memory/labels.ts` | V | exact→0.85 semantic→create ladder; 20k token context budget; "Persona" label excluded |
| `apps/webapp/app/jobs/session/session-compaction.logic.ts` | `memory/compaction.ts` | V | coveredUntil watermark math + Document upsert; `<output>`-tag fallback kept |
| `apps/webapp/app/jobs/spaces/{persona-trigger,persona-generation,aspect-persona-generation}.ts` + `persona-bullet-ops.ts` + `persona-llm-placement.ts` | `memory/persona.ts` | V | direct-call branch only (USE_BATCH=false); delete batch-API code; full-regen-over-existing-doc stays forbidden |
| `apps/webapp/app/services/episodeChunker.server.ts` | `memory/chunker.ts` | V | gpt-tokenizer thresholds 1800/1250/750 |
| `packages/types/src/graph/graph.entity.ts` | `memory/types.ts` | V | node interfaces, 11 entity types, 12 aspects, voice/graph split |
| `packages/providers/src/vector/pgvector.ts` + `constants.ts` | `memory/vector.ts` | P | same interface; CTE two-stage → KNN + outer filter (§2.4) |
| `packages/providers/src/graph/neo4j/domains/{searchV2,triple,entity,episode,statement}.ts` | `memory/graph.ts` (+ SQL inside handlers) | P | every Cypher becomes joins over `edges`; string-datetime convention → ISO strings |
| `apps/webapp/app/services/agent/memory.ts` (searchMemoryWithAgent) | `memory/search/index.ts` | P | V2-only path; V1 memoryAgent fallback S (keep its query-decomposition prompt as `prompts/deep-search.ts`, unused for now) |
| `apps/webapp/app/utils/mcp/memory.ts` | `memory/mcpTools.ts` | V | keep battle-tested tool descriptions verbatim |
| `apps/webapp/app/services/ingestionLogs.server.ts` | `api/v2/memory/logs` + `queue.ts` | P | cascade delete → cascade-EXILE (A8.5) |
| `apps/webapp/app/services/localEmbeddings.server.ts` | `memory/embed.ts` | P | we call Ollama instead of transformers.js; keep dim-guard idea |
| `apps/webapp/app/services/{episodeVersioning,episodeDiffer}.server.ts` | — (phase 2) | S | document re-ingestion diffing deferred; schema columns already present |
| BullMQ / Trigger.dev job infra (`app/bullmq/`, `app/trigger/`) | `memory/queue.ts` + `scheduler.ts` | P | in-process chain, statuses on ingestion_queue |
| Cohere rerank path | — | S | keep vector `batchScore` rerank (built-in fallback); `RERANK_PROVIDER` pattern later |
| `MEMORY_SEARCH_V2_BROAD_RECALL_BACKSTOP` / V1 SearchService | — | S | legacy-data only |
| credits/BYOK/town-webhooks/contact-sync/multi-tenant | — | S | strip |
| `packages/gateway-protocol/` README + src | `capability/types.ts`+`manifest.ts` | P | slot/manifest/folder-scope shapes only; server stays in-process (no Fastify:7787) |
| gateway exec validation (3-layer deny/allow `Bash(<glob>)`) | `capability/gate.ts` | V | merge with agentsRuntime constitution deny list |
| `services/mcp.server.ts` + toolkit `get_integration_actions`/`execute_integration_action` | `mcp/{registry,server}.ts` | P | on-demand loading contract; our transport = Streamable HTTP via SDK |

---

## 5. API contracts

### 5.1 `/api/mcp` (F4)

- Transport: Streamable HTTP (`@modelcontextprotocol/sdk` `StreamableHTTPServerTransport`), **stateless mode** (new server+transport per POST — fits Next route-handler lifecycle; no session store needed).
- Auth: `x-agentos-mcp-secret` header must equal `settings.mcp.secret` (401 otherwise; 503 with setup hint when unset). Add `/api/mcp` to `src/proxy.ts` exempt list (pattern: `/api/agents/hook/`).
- `?source=<name>` (default `"unknown"`): stamped onto every `memory_ingest` episode source and every `events` emit.

Tools (initial):

| Tool | Input | Output |
|---|---|---|
| `get_actions` | `{intent: string, limit?: 1-3}` | 1–3 matching action schemas `{key, module, description, inputSchema}` (keyword + label-style embedding match over registry) |
| `execute_action` | `{key: string, args: object}` | handler result (JSON text content) |
| `memory_search` | `{intent: string, labelIds?, endUserIds?, structured?}` | markdown recall (or RecallResult JSON) |
| `memory_ingest` | `{message: string, sessionId: string, labelIds?, referenceTime?}` | `{queueId}` |
| `memory_about_user` | `{}` | persona document markdown |
| `get_labels` | `{}` | `{id,name,description,color}[]` |
| `initialize_conversation_session` | `{}` | `{sessionId}` (uuid; one conversation = one session) |

### 5.2 REST `/api/v2/memory/*`

| Route | Method | Request | Response |
|---|---|---|---|
| `/ingest` | POST | `{episodeBody: string(min 20), referenceTime?: ISO, source: string, sessionId: string, type?: "CONVERSATION"\|"DOCUMENT", title?, labelIds?: string[], endUserId?, metadata?}` | `{queueId}` 202 |
| `/search` | POST | `{query: string, limit?, maxEpisodes?, tokenBudget?, labelIds?, endUserIds?, startTime?, endTime?, structured?: boolean}` | `{markdown}` or `RecallResult` |
| `/episodes` | GET | `?label=&sessionId=&endUserId=&from=&to=&q=&limit=&offset=` | `{episodes: EpisodeListItem[], total}` |
| `/episodes/[id]` | GET | — | `{episode, statements: {fact,aspect,validAt,invalidAt}[], voiceAspects[], labels[], compact?}` |
| `/entities` | GET | `?q=&type=&limit=` | `{entities[]}` (q → vector search 0.65 + name LIKE) |
| `/entities/[id]` | GET | — | `{entity, statements[], episodes[]}` |
| `/labels` | GET/POST/PATCH | POST `{name, description?, color?}`; PATCH `{id, ...}` | label rows |
| `/logs` | GET | `?status=&limit=` | ingestion_queue rows (incl. stage, error) |
| `/logs` | POST | `{id, action: "retry"}` | re-enqueues FAILED row |
| `/rules` | GET/POST/PATCH | `{name?, text, source?, isActive}` | rule rows |
| `/persona` | GET | — | `{document: {content, updatedAt} \| null}` |
| `/persona` | POST | `{mode: "full"}` | 409 if doc exists (invariant); else triggers full gen |
| `/migrate` | POST | `{source: "memsearch"\|"jarvis"\|"agents"\|"remember", dryRun?: boolean, full?: boolean}` | `{found, queued, skipped, sample[]}` |
| `/stats` | GET | — | `{episodes, statements, entities, voiceAspects, labels, invalidated, queueDepth, lastIngestAt}` |

`RecallResult` (client-safe type, verbatim upstream): `{episodes: [{uuid, content, createdAt, labelIds, isCompact?, isDocument?, relevanceScore?}], invalidatedFacts: [{fact, validAt, invalidAt}], statements: [{fact, validAt, attributes, aspect}], voiceAspects: [{uuid, fact, aspect, score}], entity: {uuid,name,attributes}|null, facets?}`.

### 5.3 Foundations APIs

| Route | Method | Shape |
|---|---|---|
| `/api/v2/events` | GET | `?type=&since=&limit=` → `{events: {id,type,source,payload,createdAt}[]}` |
| `/api/v2/events/stream` | GET | SSE `data: {event}\n\n` (repo SSE pattern from `/api/jarvis/brain`) |
| `/api/v2/jobs` | GET | `{jobs[]}` · POST `{kind, name, rrule?, runAt?, payload?}` · PATCH `{id, enabled?}` |

`events.ts` exported API: `emit(type, payload, source?)` (persists + fans out to SSE subscribers + in-process listeners), `on(type, fn)`, `recent(filter)`. Bus lives on `globalThis.__agentosBus` (Next per-bundle module instantiation).

`scheduler.ts` exported API: `registerJobHandler(kind, fn)`, `ensureV2Scheduler()`, `scheduleJob({kind,name,rrule|runAt,payload})`. Tick: every `settings.scheduler.tickSeconds`, `SELECT * FROM jobs WHERE enabled=1 AND run_at <= now` → run handler (errors → `last_status='error'` + `job.failed` event, never throw out of tick) → recompute `run_at` via `rrule.after(new Date())` or disable one-shots. Missed-while-down runs fire once on boot (run_at in past → run once, don't backfill repeats). Coexists with `agentsTriggers.ts` (untouched).

`capability/slots.ts` (F3 skeleton contract, consumed later by B/C/D/E):

```ts
type SlotResult = { ok: boolean; output: string; error?: string; meta?: Record<string, unknown> };
execSlot({ command, cwd, timeoutMs })      // gate.ts check → runner.run via cmd; deny/allow evaluated pre-spawn
codingSlot({ agent, prompt, cwd, mode })   // gate folder-scope on cwd → cliComplete/spawnStream
filesSlot({ op: "read"|"write"|"glob"|"grep", path, ... })  // path resolved+prefix-checked vs settings.capability.folders (kanbanWorkspace pattern); write to existing file ⇒ exile copy first
browserSlot(...)                            // throws NOT_IMPLEMENTED (E owns it); manifest entry present so /api/mcp can list it disabled
```

---

## 6. UI (A8 + foundations surfaces)

Match muted-neobrutalist dashboard style: CSS vars (`--fg`, `--panel-border`), per-module accent hex, framer-motion, lucide icons, `usePollWhileVisible` for all polling (3–5s).

**Page:** overwrite `src/app/memory/page.tsx` (exile the current vault-grep page copy first per Rule 3 — it renders `MemoryView` replacement). Sidebar: `/memory` already exists in NAV; verify it stays in the intended section Set (Sidebar gotcha).

```
src/components/v2/memory/
  MemoryView.tsx          # tabs: Episodes | Entities | Aspects | Labels | Logs | Persona; header = /stats strip; ConfigMenu gear
  EpisodeBrowser.tsx      # virtualized list; filters: label chips, source, session, endUser, date range, text q
  EpisodeDetail.tsx       # slide-over: original vs normalized toggle, extracted facts (aspect-badged),
                          #   invalidated facts rendered "currently X — previously Y (until <date>)" (A3), session compact link
  EntityBrowser.tsx       # search + type filter; detail: attributes table, statements (valid + struck-through invalidated), episodes
  AspectExplorer.tsx      # 12 aspect cards w/ counts (graph + voice queried SEPARATELY — load-bearing split); click → filtered facts
  LabelsManager.tsx       # CRUD name/color/description; per-label episode counts; color swatch = label color
  IngestLogs.tsx          # ingestion_queue table: status pill (PENDING amber/PROCESSING blue/COMPLETED green/FAILED red),
                          #   stage, error expand, Retry button (A2 logs UI)
  ManualIngest.tsx        # textarea + source/label/session pickers → POST /ingest; drop a .md/.txt file
  PersonaPanel.tsx        # renders persona doc markdown; updatedAt; "auto-update" toggle; full-gen button (only when absent)
  RulesEditor.tsx         # ingestion_rules list + free-text add (in gear or Logs tab)
  MemorySettings.tsx      # ConfigMenu children: provider, modelLow/medium, embed model (with re-embed warning),
                          #   toggles (ingest/compaction/persona), tokenBudget, label threshold, MCP secret "configured ✓"
```

Foundations UI (minimal this phase): an **Event feed strip** component `src/components/v2/EventFeed.tsx` (consumes `/api/v2/events`, reused later by Homepage H) and a **Jobs table** inside the Memory gear's "System" section (list `/api/v2/jobs`, enable/disable). Full pages come with H.

Every configurable thing above maps to a `settings.memory`/`settings.mcp`/`settings.capability` key via the shared `ConfigMenu` + `useSettings` (rule 16). No config-file-only options (addy-style keys render as "configured ✓").

---

## 7. Granular task list

Rules: each ≤ ~half-day; dependencies noted; every task ends with a verification step an implementing agent runs itself. Never restart the dev server (Rule 12); use `npx tsc --noEmit` + node scripts.

### F1 — Data layer

- **F1.1 Add deps + native config.** `npm i better-sqlite3 sqlite-vec rrule gpt-tokenizer zod` (+`npm i -D @types/better-sqlite3`). Add `serverExternalPackages: ["better-sqlite3", "sqlite-vec"]` to `next.config.ts` (Next 16 — confirm key name in `node_modules/next/dist/docs/`, per AGENTS.md read-the-docs rule). Deps: none. Verify: `node -e "const db=require('better-sqlite3')(':memory:'); const sv=require('sqlite-vec'); sv.load(db); console.log(db.prepare('select vec_version() v').get())"` prints a version.
- **F1.2 `db.ts` + `dbSchema.ts`.** Singleton on `globalThis.__agentosDb`; `dbPath()` = `AGENTIC_OS_DB` env || `~/.agentic-os/agentos.db` (mkdir -p); WAL + busy_timeout + foreign_keys pragmas; `sqliteVec.load(db)`; migration runner (§2.1); migration 001 = ALL DDL in §2.2–2.3 (not vec tables). Export `getDb()`, `tx(fn)`. Deps: F1.1. Verify: `scripts/v2/smoke-db.mjs` — opens temp DB via env override, asserts tables exist, re-runs idempotently.
- **F1.3 Vec tables + `vector.ts`.** Migration 002 creates 6 `vec0` + `vecmap_*` tables with dim from `meta.embed_dim` (write `embed_model`/`embed_dim` meta first, from settings at migration time). Implement provider contract (§2.4): search/batchScore/upsert/remove/get, two-stage KNN, `distToSim()` isolated. Deps: F1.2. Verify: extend smoke-db.mjs — insert 3 fake 768-d vectors, KNN returns nearest-first, threshold filter works, batchScore returns Map.
- **F1.4 Windows load-gate + fallback decision.** Run F1.1 verify on the real machine; if `sqlite-vec` fails to load: implement brute-force JS fallback in `vector.ts` (same interface, `embeddings` BLOB table), benchmark 10k×768 (<50ms target), record decision in `_design/agentos-v2/ultraplan/DECISIONS.md`. Deps: F1.3. Verify: `scripts/v2/bench-vec.mjs` prints backend + timing.
- **F1.5 `embed.ts`.** `getEmbedding(text)` / `getEmbeddings(texts[])` → Ollama `/api/embed` (local `127.0.0.1:11434` or cloud base per `settings.memory.embedProvider`), model `settings.memory.embedModel`; L2-normalize; hard-fail with actionable message if response dim ≠ `meta.embed_dim` ("run scripts/v2/reembed.mjs"). Deps: F1.2, settings task A8.6 stub (or read defaults). Verify: `scripts/v2/smoke-embed.mjs` embeds two strings, asserts dim + cosine("dog","puppy") > cosine("dog","spreadsheet").
- **F1.6 Nightly backup job.** Scheduler job kind `db.backup`: `db.backup()` API → `~/.agentic-os/backups/agentos-YYYYMMDD.db` (keep 14, older moved to `.exile/` not deleted); push-to-.99 left as a stub hook with TODO (network creds out of scope). Deps: F1.2, F2.2. Verify: run handler directly in smoke script, snapshot file exists and opens.

### F2 — Event bus + scheduler

- **F2.1 `events.ts` + `eventTypes.ts`.** Typed emit/on/recent per §5.3; persist every emit; ring buffer (last 200) in memory for SSE catch-up. Deps: F1.2. Verify: `scripts/v2/smoke-events.mjs` — emit 3, `recent()` returns them newest-first, listener fired.
- **F2.2 `scheduler.ts`.** Jobs CRUD + tick loop + `registerJobHandler` + rehydrate-on-boot per §5.3; emits `job.fired`/`job.failed` events. Deps: F1.2, F2.1, `rrule` dep (F1.1). Verify: `scripts/v2/smoke-scheduler.mjs` — schedule one-shot 1s out with a test handler, tick manually (export `tickOnce()` for tests), assert ran + disabled; schedule `FREQ=MINUTELY` job, assert `run_at` advances.
- **F2.3 Boot wiring + APIs.** `instrumentation.ts` additions (§3); routes `/api/v2/events`, `/api/v2/events/stream` (SSE), `/api/v2/jobs`. Deps: F2.1, F2.2. Verify: `npx tsc --noEmit`; smoke script hits route handlers directly via exported GET/POST functions with mock Request (repo has no route-test harness — direct-import pattern).
- **F2.4 `EventFeed.tsx`.** Poll `/api/v2/events` via `usePollWhileVisible`; compact list, type-colored dots. Deps: F2.3. Verify: tsc clean; component renders with mock data (storybook-less: temporary render on /memory page behind `?debug=events`).

### F3 — Capability layer skeleton

- **F3.1 Types + manifest.** `capability/types.ts` (client-safe) + `manifest.ts`: 4 slots with `{key, enabled, description, actions[]}`; browser slot `enabled:false`. Deps: none. Verify: tsc.
- **F3.2 `gate.ts`.** `checkExec(command)` — built-in deny list (union of gateway docs + agentsRuntime constitution: rm/rmdir/Remove-Item/del/force-push/hard-reset/git clean/curl|bash/sudo) + `settings.capability.execDeny` + allow globs (`Bash(<glob>)` matcher; empty allow = all non-denied); `checkPath(path, scope)` — resolve + prefix check vs `settings.capability.folders` (kanbanWorkspace traversal-guard pattern), zero folders = permissive. Deny reasons name the exile alternative. Deps: F3.1. Verify: `scripts/v2/smoke-capability.mjs` — table of 10 commands/paths asserting allow/deny incl. `Remove-Item` denied, traversal `..\..` denied.
- **F3.3 `slots.ts`.** exec→`runner.run` (through `sanitizeSpawnEnv`, timeout default 120s), coding→`cliComplete` (one-shot mode; streaming session mode = TODO stub for B/E), files→scoped read/write/glob/grep with exile-before-overwrite. Deps: F3.2. Verify: smoke script runs `execSlot({command:"node -v"})` ok, denied command returns `{ok:false}` without spawning, filesSlot write outside folders denied when a folder is configured.
- **F3.4 Settings surface.** `settings.capability` subtree + a "Capabilities" section in MemorySettings gear (folders list editor, allow/deny textareas, browser toggle disabled w/ "coming with E"). Deps: F3.3, A8.6. Verify: PATCH via `/api/settings` round-trips; gate reads new values without rebuild (request-time reads).

### F4 — Internal MCP endpoint

- **F4.1 `mcp/registry.ts`.** `registerAction({key, module, description, inputSchema, handler})`, `listActions()`, `searchActions(intent, limit)` — score = keyword hits + (once labels exist) embedding sim over description; module registration happens at import in each lib (memory registers in `mcpTools.ts`). Deps: F1.5 (embedding optional first pass — ship keyword-only, TODO embedding). Verify: unit-style smoke — register 5 fake actions, `searchActions("send an email")` ranks the mail one first.
- **F4.2 `mcp/server.ts` + `/api/mcp/route.ts`.** SDK `McpServer` factory registering `get_actions`/`execute_action` + memory tools (from A7.1); stateless Streamable HTTP per POST; `?source=` threading; secret auth; GET → 405 JSON hint (stateless mode has no SSE stream), DELETE → 405. Deps: F4.1, A7.1 (can land with memory tools stubbed as NOT_READY). Verify: `scripts/v2/smoke-mcp.mjs` — raw JSON-RPC POST (initialize → tools/list → tools/call get_actions) against handler imported directly; asserts tool list + auth 401 without secret.
- **F4.3 Proxy exemption + secret settings.** Add `/api/mcp` to `src/proxy.ts` exempt list; generate `settings.mcp.secret` on first GET of settings if absent (crypto random, shown once in gear, then "configured ✓"). Deps: F4.2. Verify: tsc; smoke asserts request without secret 401, with secret 200.
- **F4.4 Capability actions on registry.** Register `exec_command`, `read_file`, `write_file`, `list_files` actions wrapping F3 slots (browser absent). Deps: F3.3, F4.1. Verify: smoke-mcp calls `execute_action{key:"exec_command", args:{command:"node -v"}}` through the full MCP round trip.

### A1 — Schema (mostly done in F1; remaining)

- **A1.1 Constants + types.** `memory/constants.ts` — every threshold as named export with the upstream value in a comment: LABEL_ROUTER 0.7, CONFIDENCE_GATE 0.2, ENTITY_HINT 0.65, ENTITY_LOOKUP 0.7, ENTITY_DEDUPE 0.7, STATEMENT_SIMILAR 0.7, VOICE_SIMILAR 0.75, LABEL_SEMANTIC_MATCH 0.85, RELATED_MEMORIES 0.75, RERANK_KEEP 0.1 / EXPLORATORY 0.2, VOICE_SEARCH 0.5, EPISODE_FALLBACK 0.3, TOKEN_BUDGET 10000, CHUNK 1800/1250/750/100, COMPACT_REPLACE_MIN 3, HINTS_MAX 5, HINT_TOP 3. `memory/types.ts` — port `REF/apps/webapp/app/services/search-v2/types.ts` + `REF/packages/types/src/graph/graph.entity.ts` (verify against actual files, not just digest). Deps: none. Verify: tsc; enum spot-check vs REF (Task appears in BOTH voice and graph lists).
- **A1.2 `graph.ts`.** saveEpisode/saveTriple (statement + 3 entity edges + provenance, UNIQUE-merge), getSessionEpisodes(last 5), entity CRUD, `moveAllProvenanceToStatement`, `invalidateStatements(uuids, episodeUuid)`, `deleteStatementAsDuplicate` (only after provenance move), orphan-entity cleanup (no edges → remove entity + embedding), `getEpisodesInvalidFacts`. All statement reads filter `(invalid_at IS NULL OR invalid_at > :now)` unless explicitly asked for invalidated. Deps: F1.2. Verify: `scripts/v2/smoke-graph.mjs` — build 2 triples, contradiction-invalidate one, assert current/invalidated splits + provenance move + orphan cleanup.

### A2 — Ingestion pipeline

- **A2.1 `llm.ts`.** `modelCall(messages, complexity, {schema?, temperature?, cacheKey?})`: provider dispatch per `settings.memory.provider` (ollama-cloud/local via `/api/chat` `format:"json"` when schema, cli via `cliComplete`, minimax via `minimaxComplete`); model = modelLow/modelMedium by tier; structured path: zod→JSON-schema when provider supports, else `<output>`-tag parse with raw-response fallback (keep BOTH — local models ignore tags); empty output throws with stderr tail. Deps: F1.1(zod). Verify: `scripts/v2/smoke-llm.mjs` — one low + one medium structured call round-trips a trivial schema against the configured provider (skips with loud message if provider unreachable).
- **A2.2 Prompts port.** Copy all ingestion prompt texts from `REF/apps/webapp/app/services/prompts/{normalize,extract-world,extract-voice,reflect-world,reflect-voice,classify-world,classify-voice,statements,nodes,aspect-resolution}.ts` into `memory/prompts/*.ts` as exported strings/template-fns; substitute userName from config; keep NOTHING_TO_REMEMBER contract and `<output>` tags. Deps: none. Verify: each file exports non-empty string; grep confirms NOTHING_TO_REMEMBER present in normalize.
- **A2.3 `chunker.ts`.** Port thresholds + sha256 content/chunk hashes; gpt-tokenizer counts. Deps: F1.1. Verify: smoke — 3k-token text chunks to 2–3 chunks within min/max bounds; hash stable.
- **A2.4 `queue.ts`.** In-process chain on `globalThis.__agentosMemQueue` (concurrency 1): dequeue PENDING ingestion_queue → **preprocess** (chunk, save episodes to graph FIRST — race-fix ordering; enqueue compaction in parallel) → per-episode **ingest** → **graph-resolution** → **aspect-resolution** → **label-assignment** → title → **persona-trigger**; each stage updates `stage` column; failure → status FAILED + error + `memory.ingest.failed` event; retry endpoint resets to PENDING (max retry 3). `ensureMemoryQueue()` boots a 5s poll (no fs.watch). NOTHING_TO_REMEMBER ⇒ COMPLETED, no episode. Deps: F1, F2.1, A1.2, A2.1–A2.3. Verify: covered by A2.7 round-trip.
- **A2.5 `ingest.ts`.** Port addEpisode orchestration: context fetch (last 5 session episodes; related memories episode-ns 0.75 top5 + top10 statements), normalize (rules injected), store normalized + episode embedding, comprehendAndClassify (parallel extract-world/voice → parallel reflect ×2 with graceful unfiltered fallback → parallel classify ×2), build triples (name-keyed lowercase entity map, predicates as Entity type "Predicate", auto-create missing subject/object, event_date into attributes), saveVoiceAspects, batch-embed statements/entities. ~6–8 LLM calls/episode — tier per upstream (normalize/extract/classify=medium, reflect=low). Deps: A2.1–A2.4. Verify: A2.7.
- **A2.6 `resolution.ts`.** Port graph-resolution: exact-name dedupe → entity vector 0.7 → single dedupe LLM (low) → merge; statement candidates (same subj+pred / same subj+obj / semantic 0.7 / prev-session) → single resolve LLM (low) → duplicates (provenance move THEN delete) + contradictions (invalidate, A3); orphan cleanup; aspect-resolution (voice 0.75 same-aspect, duplicate=append episodeUuid+delete new / evolution=invalidate old / new=keep). Deps: A2.5. Verify: `scripts/v2/smoke-contradiction.mjs` — ingest "lives in NYC" then "moved to LA": assert old statement invalid_at set + invalidated_by = second episode, both facts retrievable, nothing deleted.
- **A2.7 Labels + round-trip.** `labels.ts` port (skip when labelIds explicit; 1–3 labels, exact→0.85→create, OKLCH color, write to queue+documents+session episodes+episode-ns metadata... in our schema: junction rows; "Persona" excluded). End-to-end: `scripts/v2/smoke-ingest.mjs` ingests 3 conversation messages via POST handler, polls queue to COMPLETED, asserts episodes+statements+voice+labels+embeddings counts > 0 and events emitted. Deps: A2.4–A2.6. Verify: script green.
- **A2.8 Ingestion rules.** `ingestion_rules` CRUD route + injection into normalize prompt (active rules for matching source or NULL); veto path (NOTHING_TO_REMEMBER) tested. Deps: A2.5. Verify: smoke — rule "never remember anything about testing" + ingest a testing message ⇒ COMPLETED with no episode.

### A3 — Contradiction chains (cross-cutting; explicit deliverables)

- **A3.1 Invalidation surfacing.** `extractInvalidatedFacts` in search post-processing (episodes → their invalidated statements) + formatter "## Invalidated Facts (Valid <date> → Invalidated <date>)" section + EpisodeDetail/EntityBrowser "currently X — previously Y" rendering. Deps: A2.6, A4.3. Verify: smoke-contradiction extended — search "where does Yoshi live" returns LA current + NYC in invalidated section.

### A4 — Search V2

- **A4.1 `search/router.ts`.** Port: searchLabels (label-ns, limit 8, threshold `settings.memory.labelRouterThreshold` default 0.7) → extractAspects structured call (medium; exact zod shape from types.ts — `.nullable()` not `.optional()`, flat temporal shape; both prompt variants w/ separate cacheKeys; anti-hallucination selectedLabels⊆matches); gate `!shouldSearch || confidence<0.2`; error fallback exploratory/0.3; `getMatchedLabelIds` (LLM names else score≥0.5). Deps: A2.1, A1.1, F1.3. Verify: `scripts/v2/smoke-router.mjs` — "what are my coding preferences" → aspects contains Preference, queryType aspect_query; "hey" → shouldSearch false.
- **A4.2 `search/handlers.ts` part 1.** Graph SQL for the 3-path merge: label path (episodes ⋈ provenance ⋈ statements filtered aspect/valid/label/temporal — Event `attributes->>'event_date'` OR-branch in temporal WHEREs), entity-hint path (embed ≤5 hints, entity-ns top3 0.65 → episodes touching entities), raw episode-vector fallback ONLY when no labels (0.3). Handlers: `aspect_query`, `entity_lookup` (attribute substring-in-attributes mode + broad), `relationship` (≥2 entities, statement pairs both directions). Deps: A4.1, A1.2. Verify: golden subset (§9) for these 3 types.
- **A4.3 `search/handlers.ts` part 2 + post.** `temporal` (default 7d; skip rerank when no topic focus — sort recency; JS post-filter for entity/vector paths), `temporal_facets` (topics/entities/aspects counts, graph + voice queried separately, compacts for top-10 labels truncated 2000 chars, stats), `exploratory` (documents type='conversation' by label, updatedAt desc, take maxEpisodes||40, mapped to DOCUMENT episodes). Post-chain: rerank via `batchScore` (keep 0.1 / 0.2 exploratory), parallel voice-aspect search (0.5, filter to router aspects if named), `replaceWithCompacts` (>2 episodes/session, endUserId re-filtered, first position, max member score), token budget trim from tail, recall_logs write (non-blocking). Deps: A4.2. Verify: golden subset for these 3 + compaction-replacement case.
- **A4.4 `search/formatter.ts` + `index.ts`.** Markdown output verbatim (Memory Overview / Entity Information / Voice Aspects / Statements / Recalled Relevant Context with 📦/📄 / Invalidated Facts; truncation warning) + structured mode; `searchV2(query, options)` entry threading endUserIds through EVERY path (vector filters, graph WHEREs, compact/document lookups — one miss leaks counterparty memory). Deps: A4.3. Verify: `scripts/v2/golden-queries.mjs` full run (§9.2).

### A5 — Compaction

- **A5.1 `compaction.ts`.** Port: triggered from preprocess for every conversation episode (min 1); fetch session episodes since compact.updatedAt; merge prompt (Context/Details/Next per topic, decision-status capture, `<output>` fallback); upsert documents row type='conversation' + labels from first episode + endUserId + `metadata.coveredUntil = max(valid_at)` monotonic; title ladder queue→metadata→generated→prefix; embed into compacted_session ns. Runs from queue.ts in PARALLEL with ingest stages. Deps: A2.4, A2.1. Verify: smoke-ingest extended — after 3 messages one document exists, coveredUntil == last valid_at, second run only consumes new episodes.

### A6 — Persona generator

- **A6.1 Trigger + full mode.** persona-trigger after each COMPLETED ingestion: PERSONA_ASPECTS = Identity(graph) + Preference,Directive(voice); fire iff ≥1 new OR invalidated persona-relevant fact; auto-create "Persona" label; `settings.memory.personaAutoUpdate` gate. Full mode (doc absent only): all valid Identity statements + provenance (+ user identity synthetics from config userName), SKIPPED_ASPECTS = everything else (upstream current behavior — doc intentionally tiny), chunking 30/20 recency-first, PERSONA_WORTHINESS_GATE prompt in every call; save as documents type='persona' with Persona label. Deps: A2.7. Verify: after smoke-ingest with an identity fact ("Yoshi runs a Proxmox homelab"), GET /persona returns doc containing an IDENTITY section referencing it.
- **A6.2 Incremental mode.** Port bullet-ops: tombstones for invalidated facts appended pure-code; new facts → LLM placement (single + batched) → section-surgical edit; one save; full-regen over existing doc returns 409 (invariant — user edits live in doc). Deps: A6.1. Verify: smoke — invalidate an identity fact, doc gains tombstone line; add new fact, doc gains bullet without rewriting other sections (diff check).

### A7 — APIs + MCP tools

- **A7.1 `mcpTools.ts`.** Tool defs with upstream descriptions verbatim (`REF/apps/webapp/app/utils/mcp/memory.ts`): memory_ingest (sessionId required), memory_search (→ searchV2 markdown), memory_about_user (persona doc), get_labels, initialize_conversation_session; registered into F4 registry AND as first-class MCP tools on server.ts; source stamped from `?source=`. Deps: A4.4, A6.1, F4.1. Verify: smoke-mcp extended — full JSON-RPC ingest→(wait queue)→search round trip returns the ingested fact.
- **A7.2 REST routes.** All §5.2 routes as thin wrappers (repo conventions: force-dynamic, no-store, `.catch` 400s, `safeId` guard on [id]). Deps: A4.4, A2.7. Verify: tsc + direct-import handler smoke for ingest/search/episodes/labels/logs/stats.

### A8 — Memory page UI

- **A8.1 Exile + shell.** Exile copy of current `src/app/memory/page.tsx` to `.exile/<stamp>/src/app/memory/page.tsx`; new page renders `MemoryView` (tabs + stats strip + gear). Deps: A7.2. Verify: tsc; page loads with empty DB (all zero-states designed, no fabricated numbers — house style).
- **A8.2 EpisodeBrowser + EpisodeDetail.** Incl. original/normalized toggle, aspect-badged facts, invalidated "previously" rendering, compact link. Deps: A8.1. Verify: seeded DB (smoke-ingest output) shows episodes; detail matches /episodes/[id] payload.
- **A8.3 EntityBrowser + AspectExplorer.** Aspect counts query graph and voice stores separately (the split is load-bearing — missing one silently loses half). Deps: A8.1. Verify: counts equal SQL spot-checks from seed.
- **A8.4 LabelsManager + IngestLogs + ManualIngest + RulesEditor.** Retry button wired; ManualIngest posts with source "manual". Deps: A8.1, A2.8. Verify: manual ingest from UI reaches COMPLETED in Logs tab (poll via usePollWhileVisible).
- **A8.5 Cascade-exile delete.** DELETE /episodes/[id]: write full episode+statements+entities-orphaned+embeddings JSON bundle to `~/.agentic-os/.exile/memory/<stamp>-<uuid>.json`, then remove rows (upstream cascade-delete semantics, exile-flavored). UI confirm dialog names the exile path. Deps: A8.2. Verify: smoke — delete, bundle file exists, search no longer returns it.
- **A8.6 MemorySettings gear.** All `settings.memory` + `settings.mcp.secret` ("configured ✓") + capability section (F3.4) via ConfigMenu/useSettings/ModelSettings; embed-model field shows re-embed warning. Deps: A8.1. Verify: PATCH round-trip; changed modelMedium used on next ingest without rebuild.
- **A8.7 PersonaPanel.** Doc render + autoUpdate toggle + full-gen button (disabled when doc exists, tooltip cites invariant). Deps: A6.2. Verify: renders seeded persona.

### A9 — Migration

- **A9.1 `migrate.ts` parsers.** (a) `.memsearch/memory/YYYY-MM-DD.md`: split timestamped bullets, strip `<!-- session:… -->` comments into metadata, session_id per file-date; (b) `~/.agentic-os/jarvis-memory.jsonl`: one episode per line, valid_at from record; (c) `~/.agentic-os/agents/<id>/memory/{facts,journal}.md`: one episode per section, end_user_id = agent id? NO — `metadata.agentId` (endUserId is counterparties, not agents); (d) `.remember/*` if present (glob; skip gracefully when absent). All → labels `["legacy", "<source>"]`, source `migration:<source>`. Deps: A2.7. Verify: `--dryRun` prints found/sample counts matching a manual `Glob` count.
- **A9.2 Modes + run.** Default mode **raw**: store episode verbatim + episode embedding ONLY (no 6–8-call LLM pipeline — hundreds of files × Ollama Cloud cost); `full:true` flag runs the pipeline for a chosen source. `/api/v2/memory/migrate` + "Import legacy" button in gear. Old stores left untouched (read-only until confidence, then retired — separate future decision). Deps: A9.1. Verify: run raw migration on real memsearch dir; `/search` (exploratory/vector fallback) recalls a known 2026-08 fact; queue shows COMPLETED rows tagged migration.

### A10 — MemOS evaluation checkpoint

- **A10.1 Checkpoint doc + criteria.** Before A7 API shapes are declared frozen (i.e., before Phase 2 consumers build against them), write `_design/agentos-v2/ultraplan/A10-memos-eval.md` evaluating MemOS (MemTensor): (1) run the §9.2 golden set on our system, record P@5/latency/LLM-call-count per query type; (2) map MemOS MemCube/memory-scheduling concepts onto our episodes/aspects/labels/temporal-chains; (3) adoption bar: a MemOS concept is adopted ONLY if it beats our numbers on ≥2 query types by ≥20% or removes ≥2 LLM calls/ingest at equal quality; (4) explicit decision log entry. Not a blocker: A-phase ships regardless; verdict gates only API freeze. Deps: A4.4, §9.2. Verify: doc exists with filled metric table + decision.

**Sequencing summary:** F1.1→F1.5 → F2.* → (F3.* ∥ A1.*) → A2.1–A2.8 → A3.1 → A5.1 → A4.1–A4.4 → A6.* → F4.* finalized with A7.1 → A7.2 → A8.* → A9.* → A10.1.

---

## 8. Risks & Windows-specific notes

1. **Native modules on Windows/Next 16.** `better-sqlite3` + `sqlite-vec` must be in `serverExternalPackages` or webpack mangles the native bindings (same class of problem `kanbanWorkspace.ts` dodges with `process.getBuiltinModule`). F1.1 verifies loadability BEFORE any schema work; F1.4 is the explicit fallback gate (JS cosine). Node version bumps (Next upgrades) require `npm rebuild better-sqlite3`.
2. **node:sqlite temptation.** `kanbanDb.ts` uses built-in `node:sqlite`; we deliberately use better-sqlite3 for mature `loadExtension` support (task constraint). Do NOT mix drivers on the same DB file with different WAL expectations; agentos.db is touched only by `db.ts`.
3. **One writer process.** Next may instantiate modules per route bundle, but `globalThis.__agentosDb` keeps a single connection per server process. WAL + busy_timeout covers the dev-server double-process edge (dev + a smoke script). Smoke scripts default to a temp DB via `AGENTIC_OS_DB` — never point them at the live DB except A9.2's deliberate run.
4. **Timestamp discipline.** ISO strings everywhere; the upstream compaction prompt documents a real bug from mixing datetime()/strings. Code review checklist item: no `Date.now()` lands in a column.
5. **Ingestion cost.** 6–8 LLM calls/episode on Ollama Cloud. Mitigations: tiering (low for reflect/resolution), `settings.memory.ingestEnabled` kill-switch, raw-mode migration (A9.2), concurrency 1. Watch queue depth on /stats.
6. **Voice/graph split regressions.** 'Task' lives in both aspect lists; temporal_facets and persona must query both stores. Golden set includes voice-only and graph-only queries to catch a silent half-loss.
7. **endUserId leak surface.** Any new query path added later MUST thread endUserIds (episodes, documents, compact-replacement, exploratory). A4.4 owns the audit; golden set has a scoped-counterparty case.
8. **Prompt/provider drift.** extractAspects zod shape was tuned for strict structured output (`.nullable()` everywhere) — keep the shape even for tag-parsing providers; local models need the `<output>` raw-fallback kept alive (A2.1).
9. **Rules 12/15 (process hygiene).** No task in §7 restarts the dev server; verification is tsc + node scripts; never end reports with "run npm run build".
10. **Deletion policy.** The only row deletions: duplicate statement/voice-aspect after provenance move, orphaned entities/embeddings, vec rows for exiled episodes. Everything user-visible goes through exile (A8.5) — matches the deny-list reality that `rm`-class commands are hard-blocked anyway.
11. **F13/AutoHotkey etc.** Out of scope here (Workstream C) — noted because `/api/mcp` proxy exemption (F4.3) is the same pattern C's `/api/jarvis/hotkey` will need; keep the exempt-list edit reviewable.

---

## 9. Verification plan (`scripts/v2/`)

All scripts: plain `node scripts/v2/<name>.mjs`, exit non-zero on failure, print PASS/FAIL table, use `AGENTIC_OS_DB=<tmp>` (scratch dir) unless flagged `--live`. Import server code via `tsx`-free dynamic import of built lib? — no: scripts import TS via `node --experimental-strip-types` if available, else keep scripts thin and re-implement asserts over the REST handlers imported from `.next`? **Decision: scripts run against source via `npx tsx`** (add `tsx` as devDependency in F1.1) — simplest reliable path on this stack.

### 9.1 Per-phase smoke scripts (created inside tasks above)

| Script | Covers |
|---|---|
| `smoke-db.mjs` | F1.2/F1.3 open+migrate idempotent, vec KNN, batchScore |
| `bench-vec.mjs` | F1.4 backend + 10k timing |
| `smoke-embed.mjs` | F1.5 dim + sanity similarity |
| `smoke-events.mjs` | F2.1 emit/persist/listen |
| `smoke-scheduler.mjs` | F2.2 one-shot + RRULE advance |
| `smoke-capability.mjs` | F3.2/F3.3 allow/deny/scope table |
| `smoke-mcp.mjs` | F4.2/F4.4/A7.1 JSON-RPC round trips + auth |
| `smoke-llm.mjs` | A2.1 provider round trip (low+medium+structured) |
| `smoke-graph.mjs` | A1.2 triples/invalidation/provenance-move |
| `smoke-ingest.mjs` | A2.4–A2.7 + A5.1 end-to-end ingest→compact |
| `smoke-contradiction.mjs` | A2.6 + A3.1 temporal chain + surfacing |
| `smoke-router.mjs` | A4.1 routing decisions |

### 9.2 `golden-queries.mjs` (the A-phase gate)

Seeds a fresh temp DB with a fixed fixture conversation set (~15 episodes across 3 sessions, incl. one contradiction, one Event with future event_date, one counterparty-scoped session, entities Person/Org/Tech), then runs a golden table:

| # | Query | Expect |
|---|---|---|
| 1 | "what are my coding preferences" | aspect_query; ≥1 voice Preference in output |
| 2 | "what do I know about <person>" | entity_lookup broad; person's episodes |
| 3 | "what's <person>'s email" | entity_lookup attribute; entity attributes only |
| 4 | "what happened this week" | temporal; recency-sorted, rerank skipped |
| 5 | "overview of my memory this month" | temporal_facets; topics+entities+aspects, both stores counted |
| 6 | "tell me about the agent-os project" | exploratory; session compact (📦) replaces >2 episodes |
| 7 | "how do <A> and <B> relate" | relationship; connecting statements |
| 8 | "where does Yoshi live" (post-contradiction) | current fact + Invalidated Facts section |
| 9 | "hey" | shouldSearch=false, no search |
| 10 | counterparty-scoped search with endUserIds | zero leakage from other sessions (asserted by absence) |
| 11 | query about future Event | event_date OR-branch hit |

Pass bar: 11/11 assertions + total LLM calls per search ≤ 2 (router + nothing else) + p50 search latency printed (target <2.5s with cloud router call). Run after A4.4, re-run at A10.1 and before any API-freeze declaration.

### 9.3 Live checks (manual, one-time)

- A9.2 live migration recall check (real memsearch data).
- `/api/mcp` from Claude Code: register `http://localhost:3737/api/mcp?source=claude-code` with the secret header, call `memory_search` — proves the F4 exemption + auth in the real proxy chain.
- Memory page walkthrough with seeded data (A8 tasks' verify steps).

---

## Open questions (carried to Ultraplan review)

1. **Embed model final pick:** spec defaults `nomic-embed-text` 768d local — confirm it's pulled on the local Ollama, or switch default to whatever memsearch already uses (dim change after data exists = re-embed).
2. **`/api/mcp` GET/SSE:** stateless mode (no server-push) is fine for tool calls; if a future consumer needs server-initiated messages we revisit with session mode.
3. **.99 backup push (F1.6):** transport (SMB share vs scp vs HTTP to a receiver on .99) undecided — stub lands, wiring needs Yoshi's call.
4. **Retirement timing for memsearch/jarvisMemory writes** (A9 leaves them read-only-but-alive): decide after 2 weeks of Memory V2 confidence.
