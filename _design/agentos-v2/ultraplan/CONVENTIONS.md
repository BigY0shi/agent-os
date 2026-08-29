# ULTRAPLAN CONVENTIONS — binding cross-spec contracts

Status: NORMATIVE. Written 2026-08-27 from the adversarial-review findings (2 critics, 33 findings).
**Where any SPEC-A..F text conflicts with this page, THIS PAGE WINS.** Specs are otherwise unchanged; implementers read their spec + this page.

---

## 1. Database (resolves risk-blocker #1, completeness findings on migrations/env)

1. **Single driver: `better-sqlite3`** (+ `sqlite-vec`). Correction of record: `kanbanDb.ts` uses built-in `node:sqlite`, NOT better-sqlite3 — the master plan's "proven in kanbanDb" claim was wrong. We still choose better-sqlite3 (mature extension loading for sqlite-vec, synchronous txns); it is a NEW dependency added in F1.1 with `serverExternalPackages`.
2. **Only `src/lib/v2/db.ts` may open `~/.agentic-os/agentos.db`.** Every per-spec DB shim is DELETED from scope: SPEC-B B0.2/B0.3 shim, SPEC-C C0.2 minimal runner, SPEC-D G2.1 self-open, SPEC-F I1.1 openDb(). **F1 (db.ts + migration runner) is a hard prerequisite for ALL v2 store code.** No exceptions.
3. **No `getDb()` at module import time.** DB opens only inside `register()` (instrumentation.ts) or request handlers. Code-review checklist item alongside "no Date.now() in a column".
4. **All timestamp columns are TEXT UTC ISO-8601** — this includes SPEC-E's four tables (browser_sessions, browser_tool_audit, harnesses, agent_status_events), which are hereby amended from INTEGER epoch ms.
5. **Migration version ranges** (integer-keyed array in dbSchema.ts, code-ordered):
   - 001–019 SPEC-A / foundations · 020–029 SPEC-B · 030–039 SPEC-C (jarvis+webmcp) · 040–049 SPEC-D (integrations/widgets/home) · 050–059 SPEC-E (browser/agents) · 060–069 SPEC-F (anynotes/newsletter/marketing/3d). `registerMigration()` does NOT exist; contribute entries to the MIGRATIONS array within your range.
6. **Test-DB override env var: `AGENTIC_OS_DB`** (only). SPEC-B's `AGENTOS_V2_DB` and SPEC-D's `AGENTOS_DB_PATH` are void.
7. **`ingestion_rules` is owned by SPEC-A** (schema: id, name, text, source nullable, is_active, created_at, + `pre_filter_json` column added by a SPEC-A migration). SPEC-D writes rows here with `source = <integration account id>`; its own `ingestion_rules` DDL is void. The single seam `getActiveRuleTexts(source)` lives in SPEC-A and is called by A2.5/A2.8 prompt assembly.

## 2. Scheduler — F2 contract (resolves completeness blocker #2)

SPEC-A publishes ALL of:
- Core: `registerJobHandler(kind, fn)` + `scheduleJob({kind, name, rrule|runAt, payload})` over the single **`jobs`** table (SPEC-B's `v2_jobs` is void).
- SPEC-B compat wrappers (thin, over the core): `enqueueScheduledTask`, `removeScheduledTask`, `enqueueTask`, `cancelTaskJob`, `enqueueDebounced` (in-process debounce map).
- `registerCron(id, cronExpr, handlerKind)` — converts cron→RRULE for SPEC-D/F consumers. **No inline `run` closures** (they don't survive DB rehydration): SPEC-D/F register handler kinds at boot instead.
- Fallback scaffolding rule: **foundations (F1/F2) and Memory V2 are prerequisites; consumers throw loudly instead of buffering.** Deleted from scope: `v2_ingest_outbox` (B), both `pending-*.jsonl` files (C3.6, F I2.2), croner fallbacks (D, F), B0.3 shim. The ONE sanctioned interim seam is SPEC-D's `activities.ingest_status='pending'`. (If a pending-JSONL somehow ships anyway, SPEC-A A9.1's importer must drain it.)

## 3. /api/mcp + WebMCP hub (resolves completeness blocker #3)

- **SPEC-A's Action registry is the single mount point.** `execute_action` input: `{key: string, args: object}` (args as OBJECT, not JSON string). `get_actions` input: `{intent: string, limit?: number}`.
- WebMCP integration: on **publish**, SPEC-C's hub calls `registerAction()` for each tool with key **`<packageSlug>/<toolName>`**; on archive it unregisters. F4's route never talks to `globalThis.__agentosMcpHub` directly. Drafts run only in the WebMCP Test tab.
- Exact-advertised-tool-name invariant holds (no prefix stripping).

## 4. Memory ingest seam (resolves the four-signature drift)

SPEC-A §5.2 exports the one cross-module wrapper — everyone else's invented names are void:

```ts
ingestFromModule({
  episodeBody: string,
  source: string,                  // e.g. 'anynotes', 'integration:notion', 'task'
  sourceURL?: string,              // stored in metadata
  sessionId?: string,              // default: `${source}-${YYYY-MM-DD}` bucket
  labelNames?: string[],           // NAMES, resolved/created via labels.ts ladder
  endUserId?: string,
  metadata?: Record<string, string|number|boolean>,
})
```

- Label taxonomy confirmed: `integration:<slug>`, `anynotes`, `task`, `legacy`, plus free names.
- **Agent scoping:** episodes get an indexed **`agent_id` column** (SPEC-A migration), NOT endUserId (endUserId = counterparties). `/api/v2/memory/episodes` accepts `?agentId=`. SPEC-E's agent Memory tab and master-plan F5 are "agentId-scoped".

## 5. Events / attention (resolves H4 gaps)

- `/api/v2/events/stream` supports `?types=` CSV filtering (SPEC-A amendment; SPEC-F's `hermes.state` subscription is then valid).
- **`attention.flag` is a published event contract**: payload `{kind, severity, title, route, dedupeKey}`. SPEC-D's attention system subscribes generically and upserts `attention_items`. SPEC-B B2.4 (task blockers) and SPEC-F I4.1 (@jarvis note replies) emit `attention.flag` — no bespoke collectors needed.

## 6. StatusBand (resolves the three-way fork of Yoshi's status-band requirement)

- **Single file: `src/components/v2/StatusBand.tsx`, owned by SPEC-E (F6.1).** SPEC-B B4.6 and SPEC-D H3.1 IMPORT it (their create-tasks are void). If E hasn't landed when B needs it, B creates it AT THAT PATH with the palette below and E adopts.
- **Single palette** (matches existing sidebar accents): running `#34d399` · idle `#60a5fa` · waiting-on-me `#fbbf24` · error `#f87171` · offline `#9ca3af`.
- **Single derivation:** `statusFeed.ts` (SPEC-E) `getStatusSnapshot()`; `/api/v2/tasks/board` consumes it, never re-derives.

## 7. Gmail / Newsletter (resolves duplicate-stack finding)

- **One Gmail stack.** Newsletter (K) consumes SPEC-D's gmail CONNECTOR: the agent Gmail account is a normal `integration_accounts` row; K3.1 is a newsletter-specific sync consumer over the connector's tokens/tools (shared oauth.ts, shared schedule.ts port). SPEC-F's parallel OAuth pair + token store + second gmail.ts are void. Build order: G3.1/G3.2 land before K.
- Gmail newsletter query: NO `*` wildcards (unsupported). Use an explicit OR of known alias addresses (chunked) or a Gmail filter that labels addy-domain mail + `label:` query. K3.1 verify covers the unknown-alias case.
- K1.3's Google consent screen is a **BLOCKED-ON-YOSHI checkpoint** (like the L1.3 Blender pass) — implementing agents park, not spin.

## 8. Widgets (resolves slug collisions)

- **SPEC-D's registry is the single catalog.** Slugs: `newsletter-edition` (NOT newsletter-latest) and `anynotes-recent` exist ONCE — SPEC-F fills SPEC-D's placeholder data routes/components rather than registering seconds.

## 9. Security (resolves risk-blocker #2 + minors) — ALL NORMATIVE

1. **/api/mcp**: NOT blanket proxy-exempt. Auth = session cookie OR the MCP secret header (either suffices). Through the MCP path, **exec defaults to deny-all** (empty allowlist = nothing runs) and **files defaults to deny** (zero folders = no writes) — opt in via the settings gear. In-app UI callers may keep permissive-first-run semantics. Every `execute_action` via /api/mcp is logged to `events` with source + remote address.
2. **CDP ws bridge (E2.2): binds 127.0.0.1 by default**; `settings.browser.wsBind: 'local'|'lan'`, firewall instructions surface only for 'lan'. Ticket HMAC keyed primarily from a random persisted secret, not AGENTOS_PASSWORD.
3. **One `redactArgs()` helper** (shared by webmcp execute, integrations runtime, browser audit): masks values whose keys match /pass|token|secret|key|auth/i and any value equal to a resolved secret. `browser_fill`/`browser_type` audit rows store field NAME only, never values.
4. **Prompt-injection guard in Jarvis (C3.2):** recalled memory is wrapped `<recalled_memory untrusted="true">` with a standing system rule (data, never instructions); when a turn's recall includes `integration:*`-labeled episodes, destructive/spawning actions require approval regardless of settings.
5. `browser_evaluate` requires approval for `ask`-mode agents (Fd3 wire-in).
6. addy.io key: already delivered to `~/.agentic-os/newsletter/config.json`; **recommend rotating it** in the addy dashboard (it transited chat) — one-file edit.

## 10. Dependencies + gotchas (normative one-liners)

- **`zod` pinned `^3.25`** (zod 4 breaks @modelcontextprotocol/sdk + claude-agent-sdk + zod-to-json-schema). smoke-mcp.mjs asserts a registered tool's inputSchema round-trips to JSON Schema.
- **vec0 DDL declares `distance_metric=cosine`** (`embedding float[768] distance_metric=cosine`); if the installed sqlite-vec lacks it, keep L2 + normalized vectors with sim = 1 − d²/2. F1.3's verify asserts a HAND-COMPUTED cosine value through distToSim, not just ordering.
- `tsx` added to F1.1's dev-dependency install line. Smoke harness: `scripts/v2/_lib.mjs` exports baseUrl + cookie + tempDb; env names: `AGENTIC_OS_DB`, `SMOKE_BASE_URL`.
- **Timezone single source: `settings.tasks.timezone`** (Intl fallback only). SPEC-B's `v2_meta` timezone seed is void. (Key typo fixed: `scratchpad.mentionDebounceSec`.)
- AHK helper (C1.4): POST via `ComObject('WinHttp.WinHttpRequest.5.1')` — AHK v2 `Download` cannot POST. Fronting: try WinActivate; on miss still POST (SSE-connected page fronts itself via window.focus); open a new tab only when the hotkey POST reports zero SSE subscribers.
- E3.3 route-interception guard installs **iff** `allowedDomains?.length`.
- Synty path has a SPACE: `E:\Game Assets\SyntyStudio\Unreal\POLYGON_Office_SourceFiles_v4.zip` — quote it in every shell-out.
- `googleapis` (~100 MB) accepted for the verbatim Gmail port. `@monaco-editor/react` approved with textarea fallback. `playwright` + `ws` are new deps (E).
- Tasks marked **size L (1–2 days, never chained same-day):** A2.5, A4.2, A4.3, B2.5, E2.2. Human checkpoints: K1.3 (Google consent), L1.3 (Blender pass).

## 11. Scope rulings

- **Skills-as-policies (master-plan addition 3) is ASSIGNED to SPEC-B as task group B7** (small): `skills` table (id, title, policy_md, description, is_active), `/skills` page (list + editor + gear), `withSkills()` injection consumed by task execution (B2) and Jarvis context (C4 already reads a skills seam). If B's schedule is tight, B7 may land in Phase 5 alongside G — but it is owned, not dropped.
- Master-plan §4 Phase 3/4 refinement (per SPEC-C's real dependency graph): **Phase 3 = C1–C2 (omnipresence + capture UI) ∥ D1–D2 (WebMCP core), then C3 (brain), then D3–D5.**
- A8 ships EntityBrowser (list+detail); the **graph visualization** is an explicit phase-2 task (1-hop SVG force layout), not silently dropped.
- SPEC-C verification adds the cross-page recall check: ingest a fact from the overlay on /pipeline, recall it on /marketing and /jarvis.
- memsearch/jarvisMemory retirement: read-only 2 weeks post-A9, then decide (unchanged).
- Deploy-gate (SPEC-E open question): ~~default = warning, not hard gate~~ — **RESOLVED 2026-08-28 (Yoshi): the hard gate is the default.** Promoting to `deployed` without a `done` run is a 409. `agents.requireTestRun=false` downgrades it to a warning banner; the ≥1-trigger requirement stays hard in both modes. One implementation only: `checkDeployGuard()` in `src/lib/v2/agents/lifecycle.ts`, consulted by both `transitionLifecycle()` and `PATCH /api/agents/[id]`.
- **Trigger lifecycle gating — RESOLVED 2026-08-28 (Yoshi): ALL trigger paths obey `lifecycleAllowsTriggers()`**, not just the scheduled tick. `POST /api/agents/hook/[id]` returns 403 for an agent in {ideation, forge, test, retired}. The secret check runs FIRST so an unauthenticated caller gets 401 and cannot probe lifecycle state. Any future trigger surface inherits this rule — call the predicate, never re-derive the skip set.
