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

## Phases 2-9: not started
