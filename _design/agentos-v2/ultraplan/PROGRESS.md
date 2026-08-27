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

## Phases 1-9: not started
