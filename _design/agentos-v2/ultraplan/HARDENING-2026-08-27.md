# HARDENING-2026-08-27 — adversarial-review hardening backlog

Branch: `feat/v2-phase7-browser-agents` · Executed 2026-08-27/28 by the hardening agent.
Builds ON TOP of commit `1125654 fix(v2): independent-review fixes` (read via `git show` first — none of these items overlap its fixes; the sync tx, approval atomic-claim, and taint-persistence work from that commit is extended here, not redone).
Scope discipline: no `src/lib/v2/browser/*`, no `src/components/v2/browser|home`, no `src/app/browser`, no `Sidebar.tsx`, no jarvis hotkey files, no `PROGRESS.md` (concurrent writers). Never staged/committed — orchestrator owns git.

**Every one of the 13 items was VERIFIED REAL against the current code before fixing. None refuted.** One sub-claim nuance on item 10 (BYHOUR-path COUNT) documented below.

---

## Per-item record

### 1. Taint fail-closed — FIXED
**Verified:** `recallIntegrationLabels` (src/lib/v2/jarvis/tools.ts) read labels off `result.episodes` only. `entity_lookup` (attribute mode) and `relationship` queries return `episodes: []` with statements/entity — integration-derived facts recalled with ZERO taint signal.
**Fix:**
- `src/lib/v2/memory/graph.ts` — new `integrationLabelsForProvenance({statementUuids, voiceAspectUuids, entityUuid})`: batch-resolves `integration:%` labels on the provenance episodes behind statements (provenance edges), voice aspects (`episode_uuids` JSON), and entities (via their valid+invalidated statements' provenance). Returns `{labels, unresolved}`; ANY unattributable fact (no provenance edge, empty `episode_uuids`, unknown uuid, lookup failure) sets `unresolved`.
- `RecallStatement` gains optional `uuid` (src/lib/v2/memory/types.ts), populated in `normalizeToRecallResult` (search/handlers.ts).
- `recallIntegrationLabels` now unions (a) episode labels with (b) provenance-resolved labels; unresolved provenance FAILS CLOSED via the sentinel `UNRESOLVED_PROVENANCE_LABEL = "integration:unresolved-provenance"` (matches the `/^integration:/i` taint test, so `applyRecallTaint` arms the gate).
- Documented residual: an entity with zero traceable statements fails closed (may over-taint a pure-attribute lookup on a hand-assembled entity) — safe by default, per the brief.
**Smoke:** smoke-jarvis-brain new legs — integration-provenance statement taints with empty episodes; clean provenance stays clean; orphan statement / missing uuid / empty voice `episode_uuids` / untraceable entity ALL fail closed; entity + voice-aspect provenance lanes resolve; `applyRecallTaint` arms the session on the fail-closed path.

### 2. Tainted-exchange laundering — FIXED
**Verified:** `ingestExchange` (src/lib/v2/jarvis/brain.ts) always ingested with `labelNames: ["jarvis"]` — a tainted turn's third-party content re-entered memory under a trusted label; future recall would NOT re-taint.
**Fix:** `ingestExchange(conversationId, userText, agentText, tainted)`; a tainted turn ingests with `["jarvis", "integration:jarvis-relay"]` (matches the §9.4 label shape → recall of it re-taints). Ingestion is KEPT (memory of the conversation is wanted) — labeled honestly. Caller passes `run.tainted` (covers sdk + cli lanes and history-inherited taint).
**Smoke:** smoke-jarvis-brain — a follow-up turn in a conversation with a tainted history row lands its queue row with the `integration:jarvis-relay` label id; a clean exchange does not.

### 3. Persona provenance — FIXED
**Verified:** `getStatementsByAspectWithEpisodes()` (full mode) and `fetchEpisodeFactsForPersona()` (incremental/trigger) consumed statements + voice aspects + episode content with no provenance filter — integration-planted Identity/Preference/Directive facts could enter the persistent persona system prompt.
**Fix (query-level, src/lib/v2/memory/persona.ts):** three shared SQL fragments — statement-has-integration-provenance, voice-aspect-has-integration-provenance, episode-is-integration — applied to: the full-mode statements query (its episode join then only ever surfaces clean statements' episodes), the full-mode voice merge, both valid-fact queries in `fetchEpisodeFactsForPersona`, PLUS a top-of-function `isIntegrationEpisode()` short-circuit so an integration episode neither triggers nor feeds persona (invalidated-tombstone side included by the short-circuit).
**Smoke:** smoke-jarvis-brain — `isIntegrationEpisode` both ways; integration episode contributes nothing; clean episode's facts still flow.

### 4. OAuth callback error hygiene — FIXED
**Verified:** `exchangeCode` threw `token exchange failed: HTTP <status> <body.slice(0,300)>` and `handleCallback` URL-encoded that (and raw setup/provider errors) into the redirect query string.
**Fix (src/lib/v2/integrations/oauth.ts):** redirect carries ONLY an allowlisted code — `oauth_state_invalid | provider_denied | no_code | token_exchange_failed | account_setup_failed` (`OAUTH_ERROR_CODES` exported). Full detail goes to `console.error` server-side, redacted of the definition `clientSecret` and (setup path) any token values. Callback route unchanged (it just follows the redirect).
**Smoke:** smoke-int-oauth updated — provider error → exactly `?error=provider_denied` (no raw description in the URL); token 400 → exactly `?error=token_exchange_failed` (no body/status leakage).

### 5. WebMCP http-lane error redaction — FIXED
**Verified:** `runHttp` threw errors embedding up to 1KB of the provider body; `run()` persisted that verbatim to `webmcp_call_logs` and returned it. A provider echoing the Authorization header lands the resolved secret in SQLite + model context.
**Fix:** new `redactText(text, secretValues)` in src/lib/v2/redact.ts (replaces occurrences of each resolved secret value, ≥4 chars, with `[redacted]`); applied in execute.ts `run()` to ALL handler errors before log/return, and to http-lane SUCCESS output as well (a 200 echoing the header is the same leak).
**Smoke:** smoke-hardening item-5 legs — local echo server; 500-with-secret → error redacted in the result AND the persisted call-log row; 200-with-secret → output redacted; `redactText` units.

### 6. Approval snapshot pinning — FIXED
**Verified:** `resolveApproval` → `executeApproved` ran `getPublishedSnapshot()` at APPROVE time — a republish between request and approve executed unreviewed behavior.
**Fix:** migration **034 `webmcp_approval_pinning`** (next free 03x slot) adds `webmcp_approvals.pinned_version INTEGER`. `createApproval` pins the package's `current_version` (via the published snapshot) at request time; approve compares before the atomic claim and refuses **409 "package '<slug>' was republished (vN → vM) since this approval was requested"**; the row stays pending (expires naturally). Registry-lane rows (`slug='registry'`) are version-less — `pinned_version NULL`, check skipped (documented: plain F4 actions have no versioned snapshot to pin; their handlers resolve at execute time by design). Residual ms-scale window between check and execute documented in-code (the fixed hole was the minutes-scale approval window).
**Smoke:** smoke-hardening item-6 legs — pin recorded (v1); republish → approve 409 naming the republish; row stays pending; fresh approval executes v2; registry-lane pin is NULL. smoke-approvals regression green.

### 7. Watermark tail-loss + dedupe — VERIFIED TRUE, FIXED
**Verified:** gmail watermark = `latest internalDate + 20s`; next run's `after:` + `internalDate <= lastSyncMs` filter treats anything timestamped inside that 20s window as already-seen → mail genuinely DROPPED (e.g. delivered after the list call with internalDate < newest+20s).
**Fix:**
- gmail/sync.ts: watermark = EXACT newest internalDate; skip filter `<` (boundary second re-processed); dedupe keys `gmail-received:<id>` / `gmail-sent:<id>`.
- Migration **043 `integrations_hardening`** (04x): `activities.dedupe_key TEXT` + partial `UNIQUE(account_id, dedupe_key)`; `insertActivity` gains `dedupeKey` + `INSERT OR IGNORE` → returns `null` on a dupe; `applySyncResult` skips null rows (no `activity.created` emit, no re-ingest — completes the crash-duplication fix whose tx already landed). `NewActivity.dedupeKey` added.
- Keys per connector: github `gh-notif:<id>@<updatedAt>` / `gh-issue:<repo>#<n>@<updatedAt>` (id@updated so a NEW thread update still lands); gcal `gcal-changed:<id>@<updated>` / `gcal-soon:<id>`; slack poll `slack-im:<channel>:<ts>`; slack webhook `slack-mention|im:<channel>:<ts>` (colliding with the poll lane on purpose — one activity per message however it arrived) with `slack-evt:<event_id>` fallback + reaction keys — also closes the documented Slack retry-duplication gap. Buzz connector left keyless (no stable per-item id in wave-1 scope; NULL keys are inert).
**Smoke:** smoke-gmail-gcal updated (exact-watermark assert, dedupe-key asserts, and a NEW tail-window leg: a message 5s after the previous newest — LOST under the old code — is captured, no duplicates, watermark advances). smoke-hardening item-7 unit legs (OR-IGNORE semantics, single emit on replay, NULL keys never collide). smoke-int-sync/connectors-wave1 regressions green.

### 8. Ingest durable retry — FIXED
**Verified:** `ingestActivity` set `ingest_status='failed'` with no retry path anywhere.
**Fix:** `activities.ingest_attempts` (migration 043); `markActivityIngestFailed` (status + attempts++); `INGEST_MAX_ATTEMPTS = 5`; `listRetryableIngestFailures`; hourly scheduler job **`integration.ingest.retry`** (id `integration:ingest-retry`, `FREQ=HOURLY`) registered in `ensureIntegrationSync` (already boot-wired — boot.ts untouched), whose handler runs `retryFailedIngests()` (+ the item-11 inbox sweep as a belt).
**Smoke:** smoke-hardening item-8 legs — failure bumps attempts; sweep caps at 5 and stops listing; a transient failure recovers to 'ingested'; the hourly job row exists with `FREQ=HOURLY`.

### 9. Memory queue leases — FIXED
**Verified:** `nextPending()` SELECT + separate PROCESSING UPDATE (non-atomic, double-claimable across processes); a crash mid-`processQueueItem` stranded the row PROCESSING forever.
**Fix:** migration **003 `memory_queue_leases`** (free 001-019 slot; range checked) adds `ingestion_queue.processing_started_at`. `claimNextPending()` (exported for the smoke): candidate SELECT then `UPDATE … WHERE status='PENDING'`, `changes===1` wins, losers loop (bounded). `processQueueItem` no longer self-flips status. `recoverStaleProcessing()`: PROCESSING older than 10 min (`PROCESSING_STALE_MS`) or with a NULL lease → PENDING with `retry_count+1`, or FAILED-loudly at the retry cap (3); called at `ensureMemoryQueue` boot and at each drain tick (touches PROCESSING rows only).
**Smoke:** smoke-hardening item-9 legs — claim flips + stamps lease; second claim finds nothing; fresh lease untouched; stale lease → PENDING + retry bump; stale at cap → FAILED loud; NULL lease treated stale.

### 10. Recurrence gaps — VERIFIED TRUE, FIXED
**Verified:** the no-BYHOUR branch of `computeNextRun` treated every rule as a bare relative interval — `FREQ=WEEKLY;BYDAY=MO` fired every 7 days from `after` on any weekday; COUNT and UNTIL were ignored entirely (never-terminating schedules). Additionally verified: in the BYHOUR path, COUNT can never exhaust either (the probe rule's dtstart rotates per call).
**Fix:** no-BYHOUR shapes carrying BYDAY/COUNT/UNTIL now delegate to the rrule library in wall-clock space, anchored at a persisted DTSTART — an inline `DTSTART` wins, else the new `anchor` parameter, which every caller (applySchedule / scheduleTask / advanceAfterFire / nextOccurrence) passes as **the task's `created_at`** (a genuinely persisted anchor; no schema change needed). COUNT with no anchor at all → loud warn + `null` (deactivation — never a silent misfire). Exhausted COUNT/UNTIL → `null` → existing deactivation path.
**Documented residuals (in-code):** BYHOUR-path COUNT still can't exhaust — bounded by `maxOccurrences` instead (out of the brief's stated scope, which names the no-BYHOUR branch); delegated-lane UNTIL comparison is offset-approximate (≤ tz offset) — fine for day-granularity UNTILs. The "do NOT fix" REF-parity comment was superseded for these shapes by the never-silently-misfire rule.
**Smoke:** smoke-hardening item-10 legs — BYDAY-without-BYHOUR lands on the actual next Monday (not after+7d); COUNT returns the 3rd occurrence then exhausts to null; COUNT with no anchor rejects loudly; UNTIL past → null / future → fires; regression legs prove plain `FREQ=DAILY` and the BYHOUR path unchanged. smoke-tasks / smoke-tasks-api green.

### 11. Webhook inbox — FIXED
**Verified:** `/api/hooks/[slug]` fired `dispatchWebhook` fire-and-forget after the 200 — a crash between them lost the delivery.
**Fix:** `webhook_inbox` table (migration 043). The route inserts a row (status 'pending') AFTER verification/challenge and BEFORE the 200; the fire-and-forget marks it done/error; an inbox-write failure degrades loudly to the old behavior rather than turning deliveries away. **Sensitive headers are stripped before persisting** (`x-hook-secret`, `authorization`, `cookie`, `x-slack-signature`) — verification happens at receipt, never on replay, so persisting a webhook secret into SQLite would have been a NEW leak. Boot sweep `sweepWebhookInbox()` (pending rows >1 min) wired from `ensureIntegrationSync` (+ the hourly retry job as a belt); replays are idempotent via the item-7 dedupe keys.
**Smoke:** smoke-hardening item-11 legs — pending-before-dispatch, header stripping, 1-min sweep window, sweep settles to done, done rows never re-swept, error marking.

### 12. Automations durable cursor — FIXED
**Verified:** dispatch was purely in-memory (`on("*")`); events persisted while the engine was down never fired rules.
**Fix:** `automation_runs.event_id` + partial `UNIQUE(rule_id, event_id)` (migration 043); runs record their bus event id; `fireRule` skips a (rule, event) pair that already ran (guard + `INSERT OR IGNORE` backstop). Durable cursor in `meta['automations_event_cursor']`, advanced monotonically after EVERY processed event (skips included, so the window shrinks). `ensureAutomations` chains `replayMissedEvents()` (cap 1000) onto the serial pipeline — live events queue behind it; first boot initializes the cursor to `MAX(events.id)` so pre-feature history never spuriously fires.
**Smoke:** smoke-hardening item-12 legs — first-boot no-replay init; live fire records event id + advances cursor; event emitted while engine down is not dispatched, then boot replay fires it exactly once; a forced re-replay window does NOT double-fire.

### 13. Proxy session tokens — FIXED (stateless lane)
**Verified:** cookie = `sha256("agentos.v1:" + password)` — deterministic; theft = indefinite replay + an offline dictionary oracle against the password.
**Lane choice (per the brief's own escape hatch):** the brief said to VERIFY whether proxy.ts can import db.ts under the Next 16 proxy runtime, else go stateless. Verifying the native better-sqlite3 driver inside the separately-bundled proxy would require running the dev server (forbidden by the brief), and a per-request synchronous DB hit in the gate is undesirable regardless — **the stateless signed-token lane was chosen and is documented in `src/lib/authSessions.ts`**. No sessions table/migration needed.
**Fix:** new `src/lib/authSessions.ts` — boot secret `~/.agentic-os/session-secret.json` (32 random bytes; override `AGENTIC_OS_SESSION_SECRET_FILE` for smokes) with an embedded `legacyAcceptUntil` (creation + 7 days). Token `v2.<id>.<exp>.<sig>`: 16-random-byte id, 30-day expiry, HMAC-SHA256 signature; nothing password-derived. `src/proxy.ts` validates statelessly, **slides** the expiry (re-mints once <½ lifetime remains), accepts the legacy hash cookie only inside the grace window and **upgrades it to a signed token on sight** (Yoshi's existing sessions survive). Login route mints the token (timing-safe password check kept); `/api/mcp`'s cookie lane updated to the same validator + grace. Degraded lane on an unwritable secret file: legacy behavior, loudly logged.
**Smoke:** smoke-hardening item-13 legs — secret file shape + grace deadline; token shape / nothing password-derived; verify / tamper / wrong-secret / expiry / near-expiry-refresh; legacy accepted inside grace, rejected after, wrong cookie rejected; **proxy e2e via direct import**: valid token passes, no-cookie 401, tampered 401, legacy passes + Set-Cookie carries the upgraded `v2.` token. (The login ROUTE itself can't be direct-imported outside a Next request scope — `next/headers cookies()` — its minting path is the exact unit-tested pair.)

---

## Migrations added
| Version | Name | Contents |
|---|---|---|
| 003 | memory_queue_leases | `ingestion_queue.processing_started_at` |
| 034 | webmcp_approval_pinning | `webmcp_approvals.pinned_version` |
| 043 | integrations_hardening | `activities.dedupe_key` + partial UNIQUE, `activities.ingest_attempts`, `webhook_inbox` table, `automation_runs.event_id` + partial UNIQUE |

(Ranges per CONVENTIONS §1.5; runner applies by applied-set so out-of-order version numbers land cleanly on existing DBs — smoke-db/smoke-migrate green.)

## Files touched
**src:** `lib/v2/dbSchema.ts` · `lib/v2/redact.ts` · `lib/v2/memory/{graph,types,persona,queue}.ts` · `lib/v2/memory/search/handlers.ts` · `lib/v2/jarvis/{tools,brain}.ts` · `lib/v2/webmcp/{execute,approvals}.ts` · `lib/v2/integrations/{oauth,store,sync,ingest,schedule,webhooks,types}.ts` · `lib/v2/integrations/connectors/gmail/sync.ts` · `connectors/github/sync.ts` · `connectors/gcal/sync.ts` · `connectors/slack/{sync,webhook}.ts` · `lib/v2/automations/{engine,types}.ts` · `lib/v2/tasks/recurrence.ts` · `lib/authSessions.ts` (NEW) · `proxy.ts` · `app/api/hooks/[slug]/route.ts` · `app/api/auth/login/route.ts` · `app/api/mcp/route.ts` · `app/api/v2/integrations/oauth/callback/route.ts` (untouched — lib-level fix).
**scripts:** `v2/smoke-hardening.mjs` (NEW, 60 checks) · `v2/smoke-jarvis-brain.mjs` (+18 legs: items 1/2/3) · `v2/smoke-gmail-gcal.mjs` (item-7 watermark/dedupe/tail legs) · `v2/smoke-int-oauth.mjs` (item-4 allowlist legs).
**Deliberately untouched:** boot.ts (all new boot work rides `ensureIntegrationSync`/`ensureAutomations`/`ensureMemoryQueue`, already wired — zero merge surface with the concurrent browser agent), everything in the browser agent's file list, PROGRESS.md.

## Verification matrix (final run, offline, AGENTOS_MOCK_LLM where applicable)
| Smoke | Result |
|---|---|
| smoke-jarvis-brain (incl. items 1/2/3 legs + existing taint/SDK legs) | ALL PASS |
| smoke-int-sync | ALL PASS |
| smoke-int-api | ALL PASS |
| smoke-gmail-gcal (incl. item-7 tail-loss leg) | ALL PASS |
| smoke-connectors-wave1 | ALL PASS |
| smoke-approvals | ALL PASS |
| smoke-automations | ALL PASS |
| smoke-attention | ALL PASS |
| smoke-tasks | ALL PASS |
| smoke-mcp | ALL PASS |
| smoke-hardening (NEW — items 5,6,7u,8,9,10,11,12,13) | ALL PASS |
| smoke-int-oauth (item-4 legs) | ALL PASS |
| Secondary regressions: smoke-db · smoke-migrate · smoke-ingest · smoke-memory-api · smoke-search · smoke-graph · smoke-compaction · smoke-webmcp · smoke-int-store · smoke-int-runtime · smoke-int-metatools · smoke-automations-ui · smoke-jarvis-conversations · smoke-getactions · smoke-tasks-api · smoke-events-scheduler | ALL PASS |
| `npx tsc --noEmit` | clean (exit 0) |

## Notes for the orchestrator
- The gmail `+20s` upstream rule and the recurrence "do NOT fix" REF-parity comment were both deliberately superseded — the header comments in gmail/sync.ts and recurrence.ts record why.
- `AGENTIC_OS_SESSION_SECRET_FILE` joins the AGENTIC_OS_DB/SETTINGS/WEBMCP_DIR family of test overrides.
- After deploy, first login (or first request with the old cookie) creates `~/.agentic-os/session-secret.json`; legacy cookies die 7 days later.
- Rule-1 compliance: nothing deleted/exiled; all changes additive or in-place edits.
