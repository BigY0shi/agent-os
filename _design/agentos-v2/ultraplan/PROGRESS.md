# V2 Build Progress

## Phase 0 — Foundations: ✅ COMPLETE (2026-08-27, inline)

| Task | Status | Verified by |
|---|---|---|
| F1.1 deps (better-sqlite3 13, sqlite-vec 0.1.9, rrule, gpt-tokenizer, zod **4.4**, tsx) + serverExternalPackages | ✅ | load-gate check |
| F1.2 db.ts singleton + migration runner (001 full DDL, 002 vec tables) | ✅ | smoke-db (34) |
| F1.3 vector.ts 6-namespace provider (search/batchScore/upsert/remove/get/count) | ✅ | smoke-vector (16) |
| F1.4 Windows load-gate | ✅ native path works — cosine metric confirmed, **sim = 1 − d**, NO JS fallback needed | smoke-db hand-computed |
| F1.5 embed.ts (Ollama, L2-norm, dim hard-fail) | ✅ code; smoke SKIPs until Ollama is running | smoke-embed |
| F1.6 nightly backup job (03:30, keep 14, exile older; .99 push = TODO stub) | ✅ | registered in boot.ts |
| F2.1 events.ts + eventTypes.ts (persist + listeners + SSE ring) | ✅ | smoke-events-scheduler (23) |
| F2.2 scheduler.ts (RRULE tick, tickOnce, cronToRrule, task wrappers, debounce) | ✅ | smoke-events-scheduler |
| F2.3 boot wiring (instrumentation → ensureV2) + /api/v2/events[/stream] + /api/v2/jobs | ✅ | tsc + routes |
| F3.1-3.3 capability types/manifest/gate/slots (exec/coding/files, browser stub) | ✅ | smoke-capability (35) |
| F3.4 settings.capability subtree (+AGENTIC_OS_SETTINGS test override added to settings.ts) | ✅ code; gear UI panel lands with A8.6 | — |
| F4.1 mcp/registry.ts (registerAction, searchActions keyword, zod4 toJSONSchema) | ✅ | smoke-mcp (16) |
| F4.2 server.ts stateless JSON-RPC (initialize/tools/list/tools/call) + /api/mcp route | ✅ | smoke-mcp |
| F4.3 proxy handling (header-present pass-through, route validates secret OR cookie; strict gates) | ✅ | smoke-mcp deny/allow |
| F4.4 capability actions (exec_command, read/write/list/grep files, coding_ask) | ✅ | smoke-mcp full round trip |

**Suite:** `scripts/v2/smoke-{db,vector,events-scheduler,capability,mcp,embed}.mjs` — all PASS (embed SKIP w/o Ollama). `npx tsc --noEmit` clean.

### Decisions made during build (deltas vs spec/conventions)
1. **zod pinned ^4.4, NOT ^3.25** — installed `claude-agent-sdk@0.3.220` peer-REQUIRES zod ^4; MCP SDK 1.29 accepts ^3.25||^4. Schema conversion via zod4-native `z.toJSONSchema` (round-trip asserted in smoke-mcp). CONVENTIONS §10 first line superseded by this entry.
2. **vec0 rowid binds need BigInt** through better-sqlite3 (encoded in vector.ts).
3. **MCP transport hand-rolled stateless JSON-RPC** instead of SDK `StreamableHTTPServerTransport` (Node req/res impedance vs Next route handlers). GET/DELETE → 405. Conformance covered in smoke-mcp; revisit only if a client demands SSE.
4. **exec spawns its own child** (cmd.exe /c + sanitizeSpawnEnv + taskkill tree) — runner.run() only launches registered agent CLIs, not arbitrary commands.
5. **settings.ts gained `AGENTIC_OS_SETTINGS` env override** so smokes never touch the live settings.json.
6. NOT YET COMMITTED — Yoshi decides commit points.

### Handoff notes for Phase 1 (Memory V2, harness-loop candidate)
- Consume: `getDb/tx` (db.ts), `emit/on` (events.ts), `registerJobHandler/scheduleJob` (scheduler.ts), `vector.ts`, `embed.ts`, `registerAction` (mcp/registry.ts). Replace the memory_search/memory_ingest NOT_READY branches in `mcp/server.ts` when A7 lands.
- Next tasks: A1.1 constants+types → A1.2 graph.ts → A2.1 llm.ts → A2.2 prompts port → A2.3 chunker → A2.4-8 queue+ingest+resolution+labels → A3 → A4 router/handlers/formatter → A5 compaction → A6 persona → A7 tools → A8 UI → A9 migration.
- Yoshi must have Ollama running (local embed) before A-phase ingest testing; `ollama pull nomic-embed-text`.

## Phase 1 — Memory V2: in progress

### Chunk 3 (A2.4–A2.8): ✅ ingestion pipeline (2026-08-27)

| Task | Status | Verified by |
|---|---|---|
| A2.4 queue.ts (addToQueue/ensureMemoryQueue/retryQueueItem/ingestFromModule seam, kill-switch, stages, events) | ✅ | smoke-ingest |
| A2.5 ingest.ts (addEpisode: normalize → extract×2 ∥ → reflect×2 ∥ → classify×2 ∥ → triples/voice + embeddings; REF race-fix ordering kept) | ✅ | smoke-ingest online |
| A2.6 resolution.ts (entity dedupe/merge, statement duplicate/contradiction, aspect duplicate/evolution/new, orphan cleanup) | ✅ | smoke-ingest contradiction leg |
| A2.7 labels.ts + prompts/label-assignment.ts (exact → 0.85 semantic → create, OKLCH, Persona excluded, 20k budget) | ✅ | smoke-ingest |
| A2.8 rules.ts (getActiveRuleTexts seam + CRUD; injected into normalize) | ✅ | smoke-ingest offline |
| Boot: ensureMemoryQueue() added to boot.ts ensureV2() | ✅ | tsc |

**Deltas vs spec/REF made during build:**
1. **llm.ts hardened (A2.1 follow-up):** Ollama Cloud models (observed live: glm-5.2:cloud) sometimes ignore the `format` JSON-schema param — structured calls now ALSO append the textual JSON-schema instruction for ollama providers, and `modelCall` does ONE corrective retry feeding the validation errors back. Without this the pipeline hard-fails on schema drift.
2. Statement-resolution contradictions are filtered to the offered candidate set (REF trusts the LLM's uuids blindly) — defensive, prevents an episode invalidating its own new statements.
3. Title-generation + compaction (A5) + persona-trigger (A6) are TODO seams in queue.ts stage chain — land with their chunks.
4. Label-assignment stage failure is non-fatal (warn + COMPLETED), matching REF's try/catch around label/title jobs.
5. Document versioning/diffing (REF EpisodeVersioning/Differ) deferred per port map (S) — DOCUMENT type uses normalizeDocumentPrompt without previousVersionContent.

### Chunk 4 (A4.1–A4.4): ✅ Search V2 (2026-08-27)

| Task | Status | Verified by |
|---|---|---|
| A4.1 search/router.ts (searchLabels 0.7 via label ns, extractAspects structured medium call, gate <0.2/shouldSearch, error fallback exploratory/0.3, getMatchedLabelIds 0.5) + prompts/router.ts (both variants + cache-key constants, AspectExtractionSchema reused from types.ts) | ✅ | smoke-search online (router classified, gate short-circuit) |
| A4.2 search/handlers.ts part 1 (aspect_query / entity_lookup attr+broad / relationship; 3-path merge; Cypher→SQL over edges/episode_labels) | ✅ | smoke-search offline |
| A4.3 search/handlers.ts part 2 + post (temporal w/ event_date OR-branch + rerank-skip-without-topic, temporal_facets graph+voice split, exploratory over documents, batchScore rerank 0.1/0.2, voice search 0.5, replaceWithCompacts ≥3, token budget) | ✅ | smoke-search offline (all 6 handlers + compact replacement + budget) |
| A4.4 search/formatter.ts (markdown verbatim incl. 📦/📄 + Invalidated Facts + truncation warning) + search/index.ts (searchV2 entry, recall_logs write, recall_count bump, executeSearch export for LLM-free testing) | ✅ | smoke-search offline+online; smoke-ingest regression ALL PASS; tsc clean |
| SearchV2Options gained `agentId?` (episodes.agent_id filter, CONVENTIONS §4) | ✅ | smoke-search agentId scope check |

**Deltas vs REF made during build (A4):**
1. **Cohere rerank + V1 broad-recall backstop stripped** per port map (S) — vector `batchScore` IS the rerank. DOCUMENT-type rows are scored against the `compacted_session` ns (REF's vector-fallback scored them against the episode ns where they have no vector and silently dropped every compact — our version matches the Cohere-path intent instead).
2. **Temporal bounds Cypher→SQL fix:** REF compares `s.validAt >= $startTime` even when startTime is null (a 'before'-only window silently returns nothing); our `statementTemporalFilter` emits each bound only when present. Event `event_date` compared lexically via `json_extract` (date-only strings order correctly against full ISO).
3. **endUserIds:** NULL `end_user_id` EXCLUDED when the filter is set — enforced in SQL (`IS NOT NULL AND IN (...)`) AND re-applied in JS on vector-sourced episodes. relationship/facets thread it through an EXISTS over provenance→episodes.
4. **labelIds force-scope** (`options.labelIds`) bypasses router label selection in every label-scoped handler (REF declared the option but never consumed it).
5. **Anti-hallucination hardened:** routeIntent filters `selectedLabels` to actually-matched label names (REF trusted the LLM).
6. **REF quirk kept deliberately:** `getAspectsForFacets` statementCount caps at 20 (REF counts after LIMIT 20); facet voice-aspect list is the 5-item set WITHOUT Task (REF aspectStore ALL_VOICE_ASPECTS), while the recall voice filter uses all 6 VOICE_ASPECTS incl. Task (REF handlers) — both mirrored.
7. **Gate short-circuit writes no recall_logs row** (REF behavior — returns before logging).
8. Structured mode returns `RecallResult` directly — REF's `formatForV1Compatibility` only existed to map Dates; our types are already ISO strings.

**Verification:** `scripts/v2/smoke-search.mjs` — offline half needs NO Ollama (local stub `/api/embed` server + deterministic synthetic 768-d vectors, handlers driven via `executeSearch()` with hand-built RouterOutput); online half ran against Ollama cloud (kimi-k2.6/glm-5.2): ALL PASS both halves. `smoke-ingest.mjs` regression ALL PASS. `npx tsc --noEmit` clean.

### Handoff notes for chunk 5 (A5 compaction + A6 persona)
- The TODO seams are still in `queue.ts`: `TODO(A5)` in preprocess (enqueue compaction in parallel with ingest — the episodes-saved-first ordering is already in place) and `TODO(A6)` persona-trigger after COMPLETED.
- A5 must write `documents` rows type='conversation' with `session_id` + `document_labels` junction rows + `end_user_id` + embed the content into the **`compacted_session`** vec ns — exploratory (`handleExploratory`), `replaceWithCompacts`, temporal_facets compactSessions, AND the rerank doc-scoring path in `search/handlers.ts` all already consume exactly that shape (smoke-search seeds it by hand; A5 replaces the hand-seed).
- `settings.memory.compactionEnabled` gate exists in settings; not yet consulted anywhere.
- A6 persona: `documents` type='persona'; "Persona" label exclusion already honored in labels.ts.
- searchV2 API surface for A7: `searchV2(query, opts)` (markdown | RecallResult), `executeSearch(routerOutput, opts)`, `analyzeQuery(query)` from `src/lib/v2/memory/search/index.ts`; replace the memory_search NOT_READY branch in `mcp/server.ts` with searchV2 when A7 lands.

### Chunk 5 (A5.1 + A6.1–A6.2): ✅ compaction + persona (2026-08-27)

| Task | Status | Verified by |
|---|---|---|
| A5.1 compaction.ts (compactSession: incremental fold, coveredUntil monotonic watermark, title ladder, Document upsert + document_labels + end_user_id + version bump, compacted_session embed, `memory.compacted` event) + prompts/compaction.ts (system/user prompts + `<output>` fallback parse, verbatim REF) | ✅ | smoke-compaction offline+online |
| A6.1 persona.ts trigger + full mode (checkPersonaUpdateThreshold worthiness gate on Identity/Preference/Directive across BOTH stores incl. invalidated side, Persona label auto-create #009CF3, personaAutoUpdate gate, generateAspectBasedPersona: SKIPPED_ASPECTS=all-but-Identity, 30/20 recency chunking, userName synthetic) + prompts/persona.ts (gate/section-map/section/chunk/merge/placement prompts + zod placement schemas, verbatim REF) | ✅ | smoke-compaction online |
| A6.2 incremental mode (tombstones pure-code first → LLM placement single+batched → section-surgical bullet ops → ONE save; full-regen-over-existing-doc throws PersonaExistsError status 409) | ✅ | smoke-compaction offline (deterministic tombstone) + online (bullet placement) |
| queue.ts seams wired: compaction kicked post-preprocess in parallel with ingest (settled at stage 'compaction' pre-COMPLETED), persona-trigger post-COMPLETED at stage 'persona'; BOTH non-fatal (warn, row stays COMPLETED) | ✅ | smoke-ingest regression |

**REF findings / deltas (chunk 5):**
1. **Trigger threshold is 1/1, not 3** — REF CONFIG `minEpisodesForCompaction: 1, compactionThreshold: 1`: compaction fires after EVERY conversation episode (docs' "after 3 exchanges" doesn't match shipped code). `maxEpisodesPerBatch: 50` is declared but unused in REF's run path — mirrored as an unused constant.
2. **Two watermarks, kept separate as in REF:** FETCH watermark = `documents.updated_at` (`created_at > updatedAt` — catches backdated-referenceTime episodes, important for A9 raw migration); COVERAGE watermark = `metadata.coveredUntil` = monotonic max(valid_at) (lexical ISO max — never regresses).
3. **Title ladder step 3 (LLM title generation) skipped** — title-generation module doesn't exist here (chunk-3 TODO); ladder is queue-title → episode metadata.title → summary-prefix munging (verbatim REF fallback).
4. **Persona doc row is `type='persona'` / session_id 'persona-v2'** (spec schema; REF used type "skill") — NOT embedded into any vector ns (REF parity; exploratory only reads type='conversation' anyway). `lastPersonaGenerationAt` lives in the `meta` table (REF: workspace.metadata).
5. **Placement calls use modelCallText + tolerant local parse** (REF contract: null = "skip this run, retry on next episode") — modelCall's throw+corrective-retry would break that semantics; strict zod validation still applied per decision (batch entries dropped individually, REF parity).
6. All REF batch-API code (createBatch/pollBatchCompletion/USE_BATCH) deleted; direct-call branch only.
7. `documents.version` bumps on every compaction update AND persona save (schema column; Prisma hid this upstream).

**Verification:** `scripts/v2/smoke-compaction.mjs` ALL PASS (offline: watermark math, `<output>` parse, all bullet ops, disabled/insufficient gates, 409 refusal, deterministic tombstone-only incremental; online vs Ollama cloud kimi-k2.6/glm-5.2: 4-episode session → doc v4, coveredUntil advancing == max(valid_at), labels mirrored, compacted_session vector, exploratory executeSearch surfaces the compact, persona full-gen via queue trigger, second full-gen 409, incremental bullet+tombstone). Regressions: smoke-ingest ALL PASS, smoke-search ALL PASS (both now exercise the live seams). `npx tsc --noEmit` clean.

### Handoff notes for chunk 6 (A7 MCP tools + REST API)
- Swap `mcp/server.ts` NOT_READY branches: memory_search → `searchV2(query, opts)` (`src/lib/v2/memory/search/index.ts`), memory_ingest → `addToQueue`/`ingestFromModule` (`memory/queue.ts`), memory_about_user → `getPersonaDocument()` (`memory/persona.ts`, returns `{content, updatedAt, …} | null`).
- REST per SPEC §5.2: `/persona` GET = getPersonaDocument(); POST mode:"full" = `generatePersonaFull()` — catch `PersonaExistsError` (has `.status === 409`) → HTTP 409.
- `personaTrigger(episodeUuid)` / `updatePersonaIncremental(episodeUuid)` / `compactSession(sessionId)` are all exported and idempotent-safe for manual routes if wanted.
- Tool descriptions come verbatim from `REF/apps/webapp/app/utils/mcp/memory.ts` into `memory/mcpTools.ts`, registered via F4 `registerAction` + first-class tools on server.ts; stamp `?source=`.

### Chunk 6 (A7.1–A7.2): ✅ MCP memory tools + REST API (2026-08-27)

| Task | Status | Verified by |
|---|---|---|
| A7.1 memory/mcpTools.ts (5 tools, descriptions VERBATIM from REF utils/mcp/memory.ts; schemas per SPEC §5.1 — search gains labelIds/endUserIds/structured, ingest gains referenceTime, about_user + init_session take {}) registered BOTH as first-class server.ts tools AND F4 registry actions (module "memory"); `?source=` stamped as `mcp:<source>` on every ingest; first-class calls audited via the same `mcp.execute` emit as execute_action | ✅ | smoke-memory-api + smoke-mcp |
| server.ts NOT_READY branches deleted (toolDefs spreads memoryToolDefs(); tools/call default → isMemoryTool dispatch; ensureMemoryActions() beside ensureCoreActions()) | ✅ | smoke-mcp |
| A7.2 REST routes (all §5.2 shapes): ingest 202/400-zod · search {markdown}\|RecallResult · episodes list (label/sessionId/endUserId/agentId/source/from/to/q LIKE/limit/offset → {episodes,total}) · episodes/[id] GET {episode,statements(incl invalidated),voiceAspects,labels,compact?} + DELETE cascade-exile · entities (?q = entity-ns 0.65 vector + name LIKE, ?type) · entities/[id] {entity,statements,episodes} · labels GET(+episodeCount)/POST/PATCH (new labels.ts updateLabel, re-embeds) · logs GET/POST retry · rules GET/POST/PATCH · persona GET/POST(mode:full→409 via PersonaExistsError.status) · stats {episodes,statements,entities,voiceAspects,labels,invalidated(graph+voice),queueDepth,lastIngestAt} | ✅ | smoke-memory-api |
| A8.5 cascade-EXILE landed early in `memory/exile.ts` (exileEpisodeCascade): REF deleteEpisodeWithRelatedNodes semantics — sole-provenance statements removed, shared-provenance KEPT (lose only this episode's provenance edge), entities orphaned by the removed statements removed, voice aspects unlinked / removed when episode list empties; full JSON bundle (episode+labels+statements+entities+voice+embeddings) written to `~/.agentic-os/.exile/memory/<stamp>-<uuid>.json` and VERIFIED on disk BEFORE any row is touched; vec rows for exiled rows removed (§8.10); emits `memory.exiled` | ✅ | smoke-memory-api cascade leg |

**Deltas/notes (chunk 6):**
1. Exile bundle path follows SPEC A8.5 (`.exile/memory/<stamp>-<uuid>.json`), not the older per-timestamp-folder shape.
2. memory_about_user returns a clear "No persona document exists yet…" message when the doc is absent (REF returned the raw profile handler output).
3. entities?q vector leg degrades gracefully to LIKE-only when the embedder is unreachable (warn, no 500).
4. smoke-mcp updated for the live-tools contract (NOT_READY assertions replaced with live session-init/get_labels/about_user/ingest-validation checks).
5. Smoke direct-imports the Next route handlers via tsx (tsconfig paths resolve `@/`), driving them with constructed NextRequest objects — first script to do so; pattern reusable for future route smokes.

**Verification:** `scripts/v2/smoke-memory-api.mjs` ALL PASS (offline: stub embeds + ingestEnabled:false; online vs local Ollama + Ollama cloud: MCP memory_ingest → COMPLETED → memory_search markdown recalling the fact). Regressions: smoke-mcp / smoke-ingest / smoke-search ALL PASS (online halves live). `npx tsc --noEmit` clean.

### Handoff notes for chunk 7 (A8 Memory page UI)
Endpoints live (all nodejs/force-dynamic/no-store, ensureV2 first):
- `POST /api/v2/memory/ingest` {episodeBody≥20, source, sessionId, referenceTime?, type?, title?, labelIds?, endUserId?, agentId?, metadata?} → 202 {queueId} (400 zod text)
- `POST /api/v2/memory/search` {query, limit?, maxEpisodes?, tokenBudget?, labelIds?, endUserIds?, agentId?, startTime?, endTime?, structured?} → {markdown} | RecallResult
- `GET /api/v2/memory/episodes?label=&sessionId=&endUserId=&agentId=&source=&from=&to=&q=&limit=(50/200)&offset=` → {episodes: EpisodicNode[] (incl labelIds), total}, valid_at DESC
- `GET /api/v2/memory/episodes/[id]` → {episode, statements:{uuid,fact,aspect,validAt,invalidAt,invalidatedBy}[], voiceAspects:{uuid,fact,aspect,validAt,invalidAt,invalidatedBy}[], labels:{id,name,description,color}[], compact?:{id,title,content,updatedAt}} · `DELETE` → {ok, episodeUuid, exiledTo, removed:{statements,entities,voiceAspects}, keptStatements} — UI confirm dialog must name `exiledTo`'s dir (A8.5)
- `GET /api/v2/memory/entities?q=&type=&limit=` → {entities: EntityNode[]} · `GET /entities/[id]` → {entity, statements (incl invalidated — strike-through), episodes (valid_at DESC)}
- `GET /api/v2/memory/labels` → {labels: LabelRow&{episodeCount}[]} · POST {name,description?,color?} → 201 {label} · PATCH {id,…} → {label}
- `GET /api/v2/memory/logs?status=&limit=` → {logs: camelCase queue rows incl stage/error/retryCount/output} · POST {id, action:"retry"} → {queueId, retryCount}
- `GET /api/v2/memory/rules(?source=&activeOnly=)` → {rules} · POST {text,name?,source?,isActive?} → 201 · PATCH {id,…}
- `GET /api/v2/memory/persona` → {document: PersonaDocument|null} · POST {mode:"full"} → 201 {document} | 409 when doc exists (full-gen button disabled then)
- `GET /api/v2/memory/stats` → {episodes, statements, entities, voiceAspects, labels, invalidated, queueDepth, lastIngestAt} (header strip)
Remaining for A8: exile old memory page (A8.1), components per SPEC §6, MemorySettings gear (A8.6 incl. capability section F3.4), migrate route+UI is A9 (route `/api/v2/memory/migrate` NOT yet built).

## Phases 2-9: not started
