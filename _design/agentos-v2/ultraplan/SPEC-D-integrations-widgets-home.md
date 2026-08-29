# SPEC-D — Workstream G (Integrations) + Workstream H (Homepage & Widgets)

Status: IMPLEMENTATION-READY. Author: staff-eng spec pass, 2026-08-27.
Inputs: `_design/agentos-v2/MASTER-PLAN.md`, `_design/agentos-v2/DOCS-CHEATSHEET.md`, recon digests (AgentOSCore + target repo), verified against `package.json` and repo conventions.
Reference repo (READ-ONLY): `C:/Users/Yoshi/Documents/JulianGolde - AgenticOS/AgentOSCore` (below: `AOC/`).
Target repo: `C:/Users/Yoshi/Documents/JulianGolde - AgenticOS/agent-os` (below: repo root).

---

## 1. Scope & goals

### Covered MASTER-PLAN items (every one, by ID)

| ID | Item | Where in this spec |
|---|---|---|
| **G1** | `/integrations` page: connector card grid, connect/disconnect, per-connector settings + user rules, trigger toggles | §6.1, tasks G1.* |
| **G2** | Connector runtime honoring the upstream contract: OAuth2 / API-key auth, schedule SYNC (incremental state) via scheduler, webhook PROCESS at `/api/hooks/[slug]`, activities → Memory V2 episodes with sourceURL | §2, §3, §5, tasks G2.* |
| **G3** | Wave-1 connectors: Gmail, Notion, GitHub, Google Calendar, Slack, Buzz | §3.3, tasks G3.* |
| **G4** | Each connector exposes MCP tools through F4 (on-demand loading) + optional widgets (H2) + optional triggers feeding automations | §5.6, §3.2, tasks G4.* |
| **G5** | Automations: `When [trigger] if [conditions] then [actions]` rules page (structured builder first, NL later) | §2 (automation tables), §5.7, §6.3, tasks G5.* |
| **H1** | Rework Overview into the daily page: scratchpad surface slot (B5) + widget grid | §6.4, tasks H1.* |
| **H2** | Widget framework: in-repo registry, config schema → auto-rendered config form, per-cell config, drag/resize grid, layout persisted in settings | §3.4, §6.5, tasks H2.* |
| **H3** | Launch widget set: Newsletter latest edition (K), Tasks, AnyNotes (I), Attention/needs-me, Agent status strip, Calendar, Pipeline/Deal Desk stats | §6.6, tasks H3.* |
| **H4** | "Needs my attention" hero: aggregates approval gates, blocked tasks, errored agents, unread important items | §3.5, §5.8, tasks H4.* |

### Non-goals (owned elsewhere, consumed here)
- **F1** `src/lib/v2/db.ts` (migrations runner, better-sqlite3 + sqlite-vec at `~/.agentic-os/agentos.db`). This spec *registers migrations* with it; it does not build it. **Correction propagated from recon:** better-sqlite3 is NOT currently in `package.json` (kanbanDb uses `node:sqlite`); F1 must add `better-sqlite3` (+ prebuilt Windows binary) or standardize on `node:sqlite` + sqlite-vec via `allowExtension`. This spec's DDL is engine-agnostic SQL and works either way. If F1 slips, tasks G2.1/H4.1 include a temporary shim (see task notes).
- **F2** event bus + scheduler. We consume `events.emit/on` and `scheduler.register`. A croner-based fallback boot hook is specced (G2.8) so G ships even if F2 lands late.
- **F4** internal MCP endpoint `/api/mcp`. We provide the integration meta-tools (`get_integrations` / `get_integration_actions` / `execute_integration_action`) as a library F4 mounts (§5.6).
- **A** Memory V2 ingestion. We call a single seam: `ingestActivity(...)` — stubbed to a no-op queue table until A lands.
- **B** Tasks / **I** AnyNotes / **K** Newsletter widgets ship with graceful "not yet wired" empty states + a stable data-endpoint contract those workstreams fill in.

### Design decisions (binding)

1. **Single execution path: in-process TS connector modules.** No downloaded `main.mjs` bundles, no spawned CLI (upstream's two paths have divergent return conventions — recon gotcha). Connectors are code in `src/lib/v2/integrations/connectors/<slug>/`, typed, imported statically. The upstream CLI wire format is kept only as a future export shim (workstream D concern).
2. **Tool-name invariant:** a connector advertises tools already prefixed with its slug (`gmail_send_email`); the runtime passes the advertised name **verbatim** to `callTool`. No prefix-then-strip round-trip (upstream gotcha eliminated).
3. **Secrets encrypted at rest.** OAuth tokens + API keys stored AES-256-GCM-encrypted in SQLite; key file `~/.agentic-os/agentos.key` (32 random bytes, created on first use). Upstream stores plaintext — we don't. Settings UI shows "configured ✓" only, never values (rule 16 + LAN exposure).
4. **OAuth state persisted in SQLite** with `crypto.randomBytes(24)` state values (upstream's in-memory `Date.now().toString(36)` sessions are restart-fragile and collision-prone — recon gotcha).
5. **Honor `spec.schedule.frequency`** per connector (upstream hardcodes `*/15 * * * *` — recon gotcha).
6. **Error discipline:** integration-API failures are SOFT (tool result `{isError:true, text:"Error: ..."}`, sync returns `[]` and records the error in `integration_sync_runs`); provider-routing/config failures are LOUD (throw; rule 11). The distinction lives in the runtime, not each connector.
7. **User rules enforced twice:** deterministic pre-filter (optional include/exclude regex per rule) applied in code at activity creation, AND rule text injected into the Memory V2 normalize prompt (NOTHING_TO_REMEMBER convention) — recon gotcha: LLM-only enforcement fails silently on weak models.
8. **Widgets are in-repo React components** (upstream chat-widget registry pattern, `AOC/apps/webapp/app/services/widgets/registry.server.ts` + `components.client.ts`), NOT remote ESM bundles — no blob-URL loader, no workspace-wide PAT baked into third-party code (recon gotcha).
9. **Grid is hand-rolled** (3-column span grid, HTML5 DnD reorder per the Sidebar customize-mode exemplar, size cycle S/M/L, optional row height). `react-grid-layout` is NOT added: unverified React 19 compat, and our layout needs are span+order, not free 2-D placement. Revisit only if Yoshi asks for free placement.
10. **Timezone injection:** runtime injects `config.timezone` (from `Intl.DateTimeFormat().resolvedOptions().timeZone` server-side) into every `callTool` — Gmail date-query rewriting depends on it (recon gotcha).
11. **New npm deps (small, no infra):** `zod` + `zod-to-json-schema` (tool schemas — zod is currently only transitive), `googleapis` + `google-auth-library` (Gmail/GCal near-verbatim port; pure-JS, Windows-safe), `turndown` (HTML→Markdown in Gmail sync). Notion/Slack/GitHub use native `fetch` (a 20-line `httpJson` helper replaces upstream's axios).

---

## 2. Data model — SQLite DDL

All tables live in `~/.agentic-os/agentos.db`, registered as migrations with F1's `src/lib/v2/db.ts` (`registerMigration(id, sql)` — exact API per SPEC-A/F1; if F1 is not landed, task G2.1's shim applies these idempotently with `CREATE TABLE IF NOT EXISTS`). All timestamps are ISO-8601 TEXT (UTC). All `*_json` columns are JSON TEXT.

```sql
-- migration: v2_integrations_001
CREATE TABLE IF NOT EXISTS integration_definitions (
  slug            TEXT PRIMARY KEY,          -- 'gmail' | 'notion' | ... (matches in-repo connector)
  enabled         INTEGER NOT NULL DEFAULT 1,
  config_enc      TEXT,                      -- AES-GCM blob: { clientId, clientSecret, webhookSecret, ...defaults }
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integration_accounts (
  id              TEXT PRIMARY KEY,          -- crypto.randomUUID()
  definition_slug TEXT NOT NULL REFERENCES integration_definitions(slug),
  account_id      TEXT NOT NULL,             -- external identity (email addr, workspace id, npub, login)
  display_name    TEXT,
  config_enc      TEXT NOT NULL,             -- AES-GCM blob: tokens / api key / per-account config
  settings_json   TEXT NOT NULL DEFAULT '{}',-- { state: {...sync watermarks}, autoActivityRead: bool,
                                             --   scheduleId: string|null, triggersEnabled: bool }
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (definition_slug, account_id)       -- upsert semantics preserved from upstream
);

CREATE TABLE IF NOT EXISTS activities (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES integration_accounts(id),
  text            TEXT NOT NULL,
  source_url      TEXT,
  event_type      TEXT,                      -- connector-declared trigger key, e.g. 'GMAIL_MESSAGE_RECEIVED'
  payload_json    TEXT,                      -- structured event payload for automations
  rejection_reason TEXT,                     -- set when a user-rule pre-filter rejects it
  ingest_status   TEXT NOT NULL DEFAULT 'pending', -- pending|ingested|rejected|failed (Memory V2 updates)
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activities_account ON activities(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activities_ingest ON activities(ingest_status);

CREATE TABLE IF NOT EXISTS integration_call_logs (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL,
  tool_name       TEXT NOT NULL,
  source          TEXT,                      -- '?source=' tag from /api/mcp, or 'ui' | 'automation:<ruleId>'
  ok              INTEGER NOT NULL,
  error           TEXT,
  duration_ms     INTEGER,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integration_sync_runs (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL,
  trigger         TEXT NOT NULL,             -- 'schedule' | 'manual' | 'webhook'
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  ok              INTEGER,
  activities_count INTEGER NOT NULL DEFAULT 0,
  error           TEXT
);

CREATE TABLE IF NOT EXISTS ingestion_rules (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES integration_accounts(id),  -- NOTE: account row id, not slug
  name            TEXT NOT NULL,
  text            TEXT NOT NULL,             -- natural-language rule, injected into normalize prompt
  pre_filter_json TEXT,                      -- optional { include?: string[], exclude?: string[] } regex, deterministic
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_sessions (
  state           TEXT PRIMARY KEY,          -- crypto.randomBytes(24).toString('base64url')
  definition_slug TEXT NOT NULL,
  code_verifier   TEXT,                      -- PKCE
  redirect_url    TEXT NOT NULL,             -- app page to bounce back to
  created_at      TEXT NOT NULL              -- rows older than 15 min are purged on read
);
```

```sql
-- migration: v2_automations_001
CREATE TABLE IF NOT EXISTS automation_rules (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  trigger_slug    TEXT NOT NULL,             -- connector slug or 'system'
  trigger_event   TEXT NOT NULL,             -- e.g. 'GMAIL_MESSAGE_RECEIVED', 'sync.failed'
  conditions_json TEXT NOT NULL DEFAULT '[]',-- [{ field, op: eq|neq|contains|not_contains|regex|gt|lt, value }]
  actions_json    TEXT NOT NULL DEFAULT '[]',-- [{ kind: run_tool|create_attention|ingest_memory|create_task,
                                             --    ...kind-specific fields }]
  is_active       INTEGER NOT NULL DEFAULT 1,
  last_fired_at   TEXT,
  fire_count      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id              TEXT PRIMARY KEY,
  rule_id         TEXT NOT NULL REFERENCES automation_rules(id),
  activity_id     TEXT,                      -- triggering activity, if any
  status          TEXT NOT NULL,             -- ok | condition_miss | action_failed
  detail_json     TEXT,                      -- per-action results / error strings
  created_at      TEXT NOT NULL
);
```

```sql
-- migration: v2_attention_001
CREATE TABLE IF NOT EXISTS attention_items (
  id              TEXT PRIMARY KEY,
  dedupe_key      TEXT NOT NULL UNIQUE,      -- e.g. 'approval:<agentId>:<approvalId>', 'sync-fail:<accountId>'
  kind            TEXT NOT NULL,             -- approval|blocked_task|agent_error|sync_failed|automation|important_item
  severity        TEXT NOT NULL DEFAULT 'info', -- info|warn|urgent
  title           TEXT NOT NULL,
  body            TEXT,
  route           TEXT,                      -- in-app link, e.g. '/agents?id=...' ; external URLs allowed
  source_module   TEXT NOT NULL,             -- 'agents'|'integrations'|'automations'|'tasks'|...
  status          TEXT NOT NULL DEFAULT 'open', -- open|done|dismissed
  created_at      TEXT NOT NULL,
  resolved_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_attention_open ON attention_items(status, severity, created_at);
```

Settings subtrees (in `~/.agentic-os/settings.json` via `src/lib/settings.ts` — extend the `Settings` interface):

```ts
integrations?: {
  callbackOrigin?: string;        // default http://localhost:3737 — must match Google/Notion app registration
  syncEnabled?: boolean;          // master kill switch, default true
};
home?: {
  cells?: HomeCell[];             // widget grid layout (see §3.4)
  showScratchpad?: boolean;       // B5 slot toggle, default true
};
attention?: {
  pollMs?: number;                // collector cadence, default 60000
  muteKinds?: string[];           // e.g. ['sync_failed']
};
```

---

## 3. Module layout

All new server code under `src/lib/v2/`, UI under `src/components/v2/`, routes under `src/app/`. Client-safe type files contain NO node imports (repo convention, cf. `agentsTypes.ts`).

### 3.1 Integrations core — `src/lib/v2/integrations/`

```
src/lib/v2/integrations/
  types.ts            # client-safe: ConnectorSpec, ConnectorTool, WidgetConfigField, TriggerDef,
                      #   AccountSummary, ActivityRow, RuleRow — near-verbatim port of
                      #   AOC packages/types/src/integration.ts + oauth/params.ts (TUI variants dropped)
  crypto.ts           # sealSecret/openSecret: AES-256-GCM, key at ~/.agentic-os/agentos.key
  store.ts            # all SQL for §2 integration tables (defs/accounts/activities/logs/rules/sync runs)
  registry.ts         # static map slug -> ConnectorModule (imports ./connectors/*); listConnectors()
  runtime.ts          # execution seam: setup(), getTools(), callTool() [timezone injection, verbatim
                      #   tool-name invariant, call logging, soft/loud error split], runSync(), runProcess()
  oauth.ts            # startOAuth(slug) -> authorize URL (PKCE S256, persisted oauth_sessions),
                      #   handleCallback(params) -> token exchange (basic auth opt-in, token_params,
                      #   interpolateString templates) -> runtime.setup -> account upsert
  sync.ts             # per-account sync driver: watermark state read/merge, activity creation,
                      #   pre-filter application, events.emit('activity.created'), sync-run rows
  webhooks.ts         # dispatch for /api/hooks/[slug]: secret check, identify() -> accounts -> process()
  rules.ts            # ingestion_rules CRUD + getActiveRuleTexts(accountId) [Memory V2 consumes]
  ingest.ts           # ingestActivity(activity): seam to Memory V2; until A lands: mark 'pending' only
  metaTools.ts        # get_integrations / get_integration_actions / execute_integration_action
                      #   (schemas + descriptions ported verbatim from AOC utils/mcp/memory.ts;
                      #   LLM filter via cliComplete with prompt from AOC utils/mcp/prompts.ts)
  connectors/
    gmail/     { index.ts, spec.ts, tools.ts, sync.ts }
    notion/    { index.ts, spec.ts, tools.ts }
    github/    { index.ts, spec.ts, tools.ts, sync.ts }
    gcal/      { index.ts, spec.ts, tools.ts, sync.ts }
    slack/     { index.ts, spec.ts, tools.ts, webhook.ts }
    buzz/      { index.ts, spec.ts, tools.ts, sync.ts }
  httpJson.ts         # tiny fetch wrapper (baseURL, headers, JSON, error->text) replacing axios
```

**ConnectorModule interface** (in `types.ts`, implemented by every `connectors/<slug>/index.ts`):

```ts
export interface ConnectorModule {
  spec: ConnectorSpec;                     // name, slug, description, icon, category,
                                           // auth: { oauth2?: OAuth2Params; apiKey?: { fields: Param[] }; local?: true },
                                           // schedule?: { frequency: string /* cron */ },
                                           // triggers?: TriggerDef[],  // e.g. { key:'GMAIL_MESSAGE_RECEIVED', label }
                                           // widgets?: string[]        // H2 widget slugs this connector powers
  setup(input: SetupInput): Promise<AccountCreate>;      // OAuth tokens or api-key fields -> { accountId,
                                                          //   displayName, config, settings? }
  getTools(): ConnectorTool[];             // [{ name (slug-prefixed), description, inputSchema (JSON Schema),
                                           //    annotations?: { readOnlyHint, destructiveHint } }]
  callTool(name: string, args: any, ctx: CallCtx): Promise<ToolResult>;  // ctx = { config, defConfig, timezone }
                                           // ToolResult = { text: string; isError?: boolean }
  sync?(ctx: SyncCtx): Promise<SyncResult>;               // ctx = { config, state } ->
                                           // { activities: NewActivity[], state?: Record<string,string> }
  identify?(webhook: WebhookInput): Promise<string[]>;    // -> external accountIds
  process?(webhook: WebhookInput, ctx: CallCtx): Promise<SyncResult>;
}
```

Rules enforced by `runtime.ts`, not by connectors: call logging, timezone injection, decrypt/encrypt of config, soft-vs-loud error classification (connector throws → runtime converts API-layer errors to `{isError:true}` and rethrows config errors: missing clientId/secret, missing key file, malformed args).

### 3.2 Scheduling glue — `src/lib/v2/integrations/schedule.ts`
- `ensureIntegrationSync()`: called from `src/instrumentation.ts` (alongside `ensureScheduler()`); for every active account whose connector has `spec.schedule` and `settings.autoActivityRead !== false`, registers a job.
- Primary path: F2 `scheduler.register({ id: 'integration-sync:'+accountId, cron: spec.schedule.frequency, run })`.
- Fallback path (if F2 absent): direct `croner` (already a dep) jobs held on `globalThis.__agentosIntSync` — same pattern as `agentsTriggers.ts`; module documents the swap point in one place.
- Overlap guard: per-account in-flight flag; a firing while a sync runs is skipped (watermark state means nothing is lost).

### 3.3 Wave-1 connectors (per-connector notes — see Port map §4 for sources)

| Slug | Auth | Tools (initial set) | SYNC | Webhook | Triggers emitted |
|---|---|---|---|---|---|
| `gmail` | OAuth2 Google (PKCE off — Google web-app flow; `access_type=offline&prompt=consent`) | port upstream's hand-written 20 (send/draft/read/search/labels/filters/batch/attachment); generated discovery tools deferred | port `schedule.ts` verbatim: `in:inbox is:important` + `in:sent`, 24h default window, +20s watermark, state only on progress, Turndown HTML→MD | none (poll-only wave 1) | `GMAIL_MESSAGE_RECEIVED` (from sync results) |
| `notion` | OAuth2, `token_request_auth_method: basic`, `owner=user`, PKCE disabled | port all 16 upstream tools (create/get/update page, databases, search, users, comments) — axios→`httpJson`, keep zod schemas + long prompt-descriptions verbatim | none wave 1 | none | — |
| `github` | API key (PAT, `fields:[{key:'token'}]`) | repos list, issues list/create/comment, PRs list/get, search code/issues, notifications list/mark-read | notifications + assigned-issues poll (30 min), watermark = `last_read_at`/updated cursor | none wave 1 (webhooks wave 2) | `GITHUB_NOTIFICATION`, `GITHUB_ISSUE_ASSIGNED` |
| `gcal` | OAuth2 Google (same Google app as gmail — definition config shared via settings hint) | list calendars, list/search events, create/update/delete event, respond | today+7d events poll (30 min) → activities for new/changed events, watermark = `updated` cursor | none | `GCAL_EVENT_CREATED`, `GCAL_EVENT_SOON` (15 min before, emitted by sync pass) |
| `slack` | API key wave 1 (bot token `xoxb-`; fields: token, defaultChannel) | post message, list channels, read channel history, add reaction, search | mentions/DM poll (15 min) if Events API not configured | `/api/hooks/slack`: URL-verification challenge answered inline; signing-secret verification; events → process() | `SLACK_MESSAGE_RECEIVED`, `SLACK_REACTION_ADDED` |
| `buzz` | local (no auth fields; bridge key already at `~/.agentic-os/buzz.env`) | post to channel, read channel, list channels — thin wrappers over existing `src/lib/buzzBridge.ts` | channel poll (15 min) → activities for new inbound messages | none | `BUZZ_MESSAGE_RECEIVED` |

Google OAuth note: clientId/clientSecret are **entered in-app** (definition settings, stored encrypted) — never seeded in code. Redirect URI shown in the UI verbatim for pasting into Google Console: `<callbackOrigin>/api/v2/integrations/oauth/callback`.

### 3.4 Widget framework — `src/lib/v2/widgets/` + `src/components/v2/home/`

```
src/lib/v2/widgets/
  types.ts            # client-safe: WidgetDef { slug, title, description, icon, minSize, defaultSize,
                      #   configSchema: WidgetConfigField[], dataKind: 'endpoint'|'none', sourceModule }
                      # WidgetConfigField = { key, label, type:'input'|'select'|'toggle', placeholder?,
                      #   required?, options?: {label,value}[], default? }   // port of AOC WidgetMeta.configSchema
                      # HomeCell = { id, widgetSlug, size:'S'|'M'|'L', order: number, config?: Record<string,unknown> }
  registry.ts         # server registry: WIDGETS: WidgetDef[] (metadata only) + getWidget(slug)
src/components/v2/home/
  widgetComponents.tsx# client map: slug -> React.ComponentType<{ config, cellId }>  (upstream components.client.ts pattern)
```

Data flow: each widget component fetches its own data from a stable endpoint (`/api/v2/widgets/<slug>/data`) using `usePollWhileVisible` — no server props, matches every existing dashboard panel. Layout lives in `settings.home.cells`, saved via the existing `useSettings().save()` PATCH.

### 3.5 Attention aggregator — `src/lib/v2/attention/`

```
src/lib/v2/attention/
  store.ts            # attention_items CRUD; upsertByDedupeKey(); autoResolve(dedupe_key) when source clears
  collectors.ts       # pull-collectors run on a 60s tick (globalThis singleton, boot via instrumentation):
                      #   - agents approvals pending  (read agents/<id>/approvals.json via agentsStore paths)
                      #   - agents failed runs        (runs/*.meta.json status=error, last 24h)
                      #   - integration sync failures (integration_sync_runs ok=0, latest per account)
                      #   - automation action_failed  (automation_runs)
                      #   - tasks blocked             (SELECT from v2 tasks table IF it exists — feature-detect)
  index.ts            # ensureAttention(): tick + event-bus subscriptions (event push beats polling when F2 lands:
                      #   on 'run.failed'/'approval.requested'/'sync.failed' upsert immediately)
```

Honest-metrics house rule: collectors only report what they actually read; a collector that can't read its source reports itself as `unavailable` in the API payload (never fabricates zero).

---

## 4. Port map

Strategy legend: **verbatim-adapt** = copy file, mechanical substitutions only (imports, axios→httpJson, Prisma→store.ts). **pattern-only** = re-implement the shape/logic fresh. **skip** = deliberately not ported.

| AOC reference file | Our file | Strategy | Notes |
|---|---|---|---|
| `packages/types/src/integration.ts` + `packages/types/src/oauth/params.ts` | `src/lib/v2/integrations/types.ts` | verbatim-adapt | drop TUI/widget-bundle fields, drop `Message[]` wire types (single path decision), add `TriggerDef` |
| `packages/sdk/src/integrations/integration-cli.ts` | — | **skip** | CLI wire format is workstream D's export shim, not runtime |
| `integrations/notion/src/mcp/index.ts` (1007 ln) | `connectors/notion/tools.ts` | verbatim-adapt | axios client → `httpJson`; keep zod schemas, annotations, prompt-grade descriptions, XML-ish page rendering, error-swallow shape verbatim |
| `integrations/notion/src/account-create.ts` | `connectors/notion/index.ts` (setup) | verbatim-adapt | `GET /v1/users/me` → accountId = workspace_id\|\|bot_id |
| `integrations/gmail/src/mcp/index.ts` (1610 ln) | `connectors/gmail/tools.ts` | verbatim-adapt | hand-written 20 tools only; needs `googleapis` + `google-auth-library`; keep tz-aware `after:`/`before:` unix rewriting |
| `integrations/gmail/src/discovery-generator.ts` + `generated-tools.ts` | — | **skip** (wave 1) | generated drafts/threads/history/settings tools deferred; revisit if agents need them |
| `integrations/gmail/src/schedule.ts` | `connectors/gmail/sync.ts` | verbatim-adapt | keep 24h default, 50-msg caps, +20s watermark, state-only-on-progress, Turndown, activity text format + sourceURL |
| `integrations/gmail/src/frontend/tools/email-tool-ui.tsx` | `src/components/v2/integrations/toolUi/EmailToolUi.tsx` | pattern-only | two-phase approve/edit shape kept for destructive tools; rendered in our UI, not a remote bundle (G4 stretch, task G4.3) |
| `integrations/github/src/*` | `connectors/github/*` | pattern-only | upstream uses their SDK conventions; we write lean fetch-based tools against REST v3 |
| `integrations/google-calendar/src/*` | `connectors/gcal/*` | pattern-only | reuse our Google OAuth client from gmail port |
| `integrations/slack/src/*` | `connectors/slack/*` | pattern-only | bot-token wave 1; port the Slack URL-verification + event mapping shapes from `webhook.server.ts` |
| `apps/webapp/app/services/integrations/integration-runner.ts` | `src/lib/v2/integrations/runtime.ts` | pattern-only | in-process only; no module cache-busting needed (static imports); keep setup/process message→row handling as typed calls |
| `apps/webapp/app/jobs/integrations/integration-run.logic.ts` | — | **skip** | spawned-CLI job path not needed (single-process, Windows) |
| `apps/webapp/app/services/oauth/oauth.server.ts` + `oauth-utils.server.ts` | `src/lib/v2/integrations/oauth.ts` | pattern-only | keep: PKCE S256, `scope_identifier`/`scope_separator`, `authorization_params` merge, basic token auth, `interpolateString`; change: SQLite state sessions, crypto-random state, no simple-oauth2 dep (hand-rolled token POST ≈ 40 lines) |
| `apps/webapp/app/services/oauth/scheduler.ts` | `src/lib/v2/integrations/schedule.ts` | pattern-only | honor `spec.schedule.frequency`; store scheduleId/autoActivityRead in `settings_json` same keys |
| `apps/webapp/app/services/webhook.server.ts` | `src/lib/v2/integrations/webhooks.ts` | pattern-only | keep IDENTIFY→accounts→PROCESS flow, autoActivityRead gate, always-200; add per-connector secret verification (upstream has none) |
| `apps/webapp/app/trigger/utils/message-utils.ts` (createActivities) | `src/lib/v2/integrations/sync.ts` | pattern-only | Activity row → `events.emit('activity.created')` → ingest seam; no Trigger.dev fanout |
| `apps/webapp/app/utils/mcp/memory.ts` (3 integration meta-tool defs) | `src/lib/v2/integrations/metaTools.ts` | verbatim-adapt | copy tool descriptions verbatim — they encode the accountId-not-slug contract agents rely on |
| `apps/webapp/app/utils/mcp/integration-operations.ts` | `src/lib/v2/integrations/metaTools.ts` | pattern-only | PQueue → simple Promise.all with 35s `AbortSignal.timeout`; LLM filter via `cliComplete` temp-equivalent prompt, parse-failure → all tools **+ loud console.warn** |
| `apps/webapp/app/utils/mcp/prompts.ts` | `src/lib/v2/integrations/metaTools.ts` (const) | verbatim-adapt | INTEGRATION_ACTION_SELECTION_SYSTEM_PROMPT copied whole |
| `apps/webapp/app/utils/mcp/custom-mcp-config.ts` + `packages/mcp-proxy/` | — | **skip** (wave 1) | user-added remote MCP servers are a wave-2 item; shape reserved in types.ts comment |
| `apps/webapp/app/services/widgets/registry.server.ts` + `components.client.ts` | `src/lib/v2/widgets/registry.ts` + `src/components/v2/home/widgetComponents.tsx` | pattern-only | the in-repo catalog + slug→component map IS our H2 |
| `apps/webapp/app/utils/bundle-loader.client.ts` | — | **skip** | remote-ESM widget loading rejected (decision 8) |
| `apps/webapp/app/components/overview/types.ts` (OverviewCell) | `src/lib/v2/widgets/types.ts` (HomeCell) | pattern-only | x/y/w/h → order/size (span grid decision 9) |
| `apps/webapp/app/services/widgets.server.ts` (widget PAT) | — | **skip** | in-repo widgets call our own APIs with the session cookie; no PAT |
| `apps/webapp/app/services/ingestionRule.server.ts` | `src/lib/v2/integrations/rules.ts` | pattern-only | keep `source = account id` semantics but NAME the column `account_id` (upstream naming confusion fixed) |

Existing target-repo files reused (no changes unless noted): `src/lib/settings.ts` (+3 subtree types), `src/components/ConfigMenu.tsx`, `src/lib/loopEngine.ts` (`cliComplete` for the LLM action filter), `src/lib/usePollWhileVisible.ts`, `src/lib/buzzBridge.ts`, `src/proxy.ts` (**edit**: add `/api/hooks/` to exempt list), `src/instrumentation.ts` (**edit**: boot `ensureIntegrationSync()` + `ensureAttention()` + `ensureAutomations()`), `src/components/Sidebar.tsx` (**edit**: NAV entries `/integrations`, `/automations`).

---

## 5. API contracts

All routes: `export const runtime = "nodejs"; export const dynamic = "force-dynamic";`, JSON responses with `cache-control: no-store`, body via `await req.json().catch(() => null)` + explicit 400 (repo convention). Password gate applies to everything except `/api/hooks/*`.

### 5.1 `/api/v2/integrations` — `src/app/api/v2/integrations/route.ts`
- **GET** → `{ connectors: Array<{ slug, name, description, icon, category, auth: 'oauth2'|'api_key'|'local', hasSchedule, triggers: TriggerDef[], configured: boolean /* def-level clientId etc. present */, accounts: AccountSummary[] }> }`
  `AccountSummary = { id, accountId, displayName, isActive, autoActivityRead, lastSync?: { at, ok, activitiesCount, error? } }`. **Never returns secrets.**

### 5.2 Definition config — `src/app/api/v2/integrations/[slug]/route.ts`
- **GET** → `{ slug, configured: { clientId: boolean, clientSecret: boolean, webhookSecret: boolean }, redirectUri: string }` (booleans only)
- **PATCH** `{ clientId?, clientSecret?, webhookSecret?, enabled? }` → merges into encrypted `config_enc`. 400 on unknown keys.

### 5.3 Connect / disconnect
- **POST** `src/app/api/v2/integrations/[slug]/connect/route.ts` — API-key/local path. Body `{ fields: Record<string,string> }` (shape from `spec.auth.apiKey.fields`). Calls `runtime.setup` → upserts account → `{ ok, account: AccountSummary }`. 422 with connector's error text when the key fails validation (setup probes the API).
- **POST** `src/app/api/v2/integrations/oauth/start/route.ts` — body `{ slug, returnTo?: string }` → `{ url }` (authorize URL; state row persisted). Client does `window.location = url`.
- **GET** `src/app/api/v2/integrations/oauth/callback/route.ts` — provider redirect. Pops state row (one-shot, 15-min TTL), exchanges code, `runtime.setup`, upserts account, then `NextResponse.redirect('/integrations?connected=<slug>'|'?error=<msg>')`. Sits behind the cookie gate (the user's own browser carries it) — no proxy exemption.
- **PATCH/DELETE** `src/app/api/v2/integrations/accounts/[id]/route.ts` — PATCH `{ autoActivityRead?, triggersEnabled?, displayName?, isActive? }`; DELETE = deactivate (`is_active=0`, schedule unregistered). Never hard-deletes (exile-equivalent: rows retained).

### 5.4 Sync + observability
- **POST** `src/app/api/v2/integrations/accounts/[id]/sync/route.ts` → runs sync now → `{ ok, activitiesCount, state, error? }` (202 with `{ running: true }` if already in flight).
- **GET** `src/app/api/v2/integrations/accounts/[id]/activity/route.ts` `?limit=50&before=<iso>` → `{ activities: ActivityRow[] }`.
- **GET** `src/app/api/v2/integrations/accounts/[id]/logs/route.ts` → `{ calls: CallLogRow[], syncs: SyncRunRow[] }` (latest 100 each).

### 5.5 User rules — `src/app/api/v2/integrations/accounts/[id]/rules/route.ts`
- **GET** → `{ rules: RuleRow[] }`
- **POST** `{ name, text, preFilter?: { include?: string[], exclude?: string[] }, isActive? }` → `{ rule }`
- **PATCH** `{ id, ...partial }` · **DELETE** `{ id }` → deactivates (`is_active=0`), never deletes.

### 5.6 Tools (F4 feed + direct)
- **GET** `src/app/api/v2/integrations/accounts/[id]/tools/route.ts` → `{ tools: ConnectorTool[] }` (all tools, unfiltered — for the UI tool browser).
- **POST** `src/app/api/v2/integrations/accounts/[id]/call/route.ts` `{ tool, args, source? }` → `{ result: { text, isError? }, durationMs }`. Logs to `integration_call_logs`.
- Library exports for **F4** (`metaTools.ts`): `integrationMetaTools(): SdkTool[]` returning the three meta-tools with upstream-verbatim descriptions:
  - `get_integrations {}` → plain-text list `name / accountId(UUID) / user identifier / slug` of active accounts.
  - `get_integration_actions { accountId /* UUID, NOT slug — description warns exactly as upstream */, query }` → LLM-filtered 1–3 tool schemas as JSON text (parse-failure → all tools + loud warn; empty selection → explicit "no matching actions" text, not silent `[]`).
  - `execute_integration_action { accountId, action, parameters }` → tool result text. Action name passed verbatim (decision 2).
  F4 mounts these; this spec's D-tasks only guarantee the exports + a direct-call smoke script.

### 5.7 Automations
- `src/app/api/v2/automations/route.ts` — **GET** → `{ rules: AutomationRule[], available: { triggers: Array<{slug, event, label}>, actionKinds: [...] } }`; **POST** (create), **PATCH** (update by id), body validated against condition-op and action-kind whitelists; **DELETE** `{ id }` → deactivate.
- `src/app/api/v2/automations/runs/route.ts` — **GET** `?ruleId=&limit=` → `{ runs: AutomationRun[] }`.
- `src/app/api/v2/automations/test/route.ts` — **POST** `{ ruleId, samplePayload }` → dry-run: evaluates conditions, returns `{ matched, wouldRun: actions[] }` without executing (builder UX).
- Engine (`src/lib/v2/automations/engine.ts`): subscribes to `activity.created` (+ `sync.failed`); for each active rule where `trigger_slug/trigger_event` match: evaluate `conditions_json` against `{ activity.text, activity.payload.*, account.slug, account.accountId }` with ops `eq|neq|contains|not_contains|regex|gt|lt`; on match execute actions sequentially, record `automation_runs`, failures → attention item. Action kinds wave 1:
  - `run_tool { accountId, tool, argsTemplate }` — `{{payload.x}}` placeholders substituted; **destructive-annotated tools require `confirm:true` on the rule** (set in builder with an explicit warning).
  - `create_attention { severity, titleTemplate, bodyTemplate }`
  - `ingest_memory { labels?: string[] }` — forces ingestion of the triggering activity even if autoRead is off.
  - `create_task { titleTemplate }` — feature-detected: no-op with `action_failed: 'tasks not available'` until workstream B lands.

### 5.8 Attention + widgets + home
- **GET** `src/app/api/v2/attention/route.ts` `?status=open` → `{ items: AttentionItem[], collectors: Array<{ name, ok, lastRunAt, unavailableReason? }> }`
- **PATCH** same route `{ id, status: 'done'|'dismissed' }`.
- **GET** `src/app/api/v2/widgets/route.ts` → `{ widgets: WidgetDef[] }` (registry metadata for the picker).
- **GET** `src/app/api/v2/widgets/[slug]/data/route.ts` `?config=<urlencoded json>` → widget-specific payload (each widget documents its own shape in the registry entry; unavailable sources return `{ available: false, reason }` — never fabricated data). Layout persistence uses the existing `/api/settings` PATCH (`home.cells`) — no new route.

### 5.9 Webhooks — `src/app/api/hooks/[slug]/route.ts`
- **POST** only. Flow: (1) connector lookup — unknown slug → 200 empty (don't leak surface); (2) secret check — Slack: signing-secret HMAC (v0 signature, 5-min timestamp skew); others: `x-hook-secret` header equals definition's `webhookSecret`; fail → 401; (3) Slack `url_verification` → echo challenge inline; (4) else fire-and-forget `webhooks.dispatch(slug, headers, body)` (identify → accounts → process, gated on `autoActivityRead`), respond 200 immediately (upstream always-200 contract).
- **`src/proxy.ts` edit:** add `/api/hooks/` to the exempt prefixes (same treatment as `/api/agents/hook/`).

---

## 6. UI

Style: existing muted-neobrutalist dashboard — CSS vars (`--fg`, `--panel-border`), per-module accent hex const, framer-motion, lucide icons, panels with hard borders. Every configurable knob has a ConfigMenu gear (rule 16). All polling via `usePollWhileVisible`.

### 6.1 `/integrations` — `src/app/integrations/page.tsx` → `src/components/v2/integrations/IntegrationsView.tsx`

```
IntegrationsView (accent: #7dd3a8 suggested — pick unused)
├─ header row: title · master sync toggle chip · ConfigMenu gear
│    └─ gear fields: callbackOrigin, syncEnabled, per-definition clientId/clientSecret/webhookSecret
│       (write via /api/v2/integrations/[slug] PATCH; render "configured ✓" only, password-type inputs)
├─ ConnectorGrid: ConnectorCard per registry entry
│    ├─ icon · name · category chip · description
│    ├─ status: Not configured / Ready to connect / n account(s) / Sync error (red)
│    └─ actions: [Connect] (opens ConnectDialog) · [Open] (accounts exist)
├─ ConnectDialog
│    ├─ oauth2: shows redirectUri to paste into the provider console (copy button),
│    │   clientId/clientSecret fields if unconfigured, then [Authorize] → oauth/start
│    ├─ api_key: fields auto-rendered from spec.auth.apiKey.fields
│    └─ local (buzz): single [Connect] button
└─ AccountDetail (slide-over or route ?account=<id>) — tabs:
     ├─ Overview: identity, lastSync status, [Sync now], autoActivityRead toggle, triggersEnabled toggle,
     │    [Disconnect] (deactivate, confirm)
     ├─ Tools: searchable list from /tools endpoint; expandable JSON Schema; [Try] → args form → /call
     │    (destructive-annotated tools render the two-phase approve UI — EmailToolUi pattern)
     ├─ Rules: user-rule list; add/edit form { name, text (textarea, NL), advanced: include/exclude regex };
     │    active toggles; explainer line: "Rules filter what gets remembered from this account"
     └─ Activity: recent activities (text, sourceURL link, ingest_status chip, rejection reason) + sync run log
```

### 6.2 Sidebar
Add NAV entries: `{ href: '/integrations', label: 'Integrations' }`, `{ href: '/automations', label: 'Automations' }`. Neither goes into `ORCHESTRATION_ROUTES` nor `AGENT_ROUTES` **only if** that yields the intended "Workspace/Self" placement — implementer must read the Set logic in `Sidebar.tsx` first and place both under **Workspace** (documented gotcha: membership is decided by the Sets, not NAV order).

### 6.3 `/automations` — `src/app/automations/page.tsx` → `src/components/v2/automations/AutomationsView.tsx`

```
AutomationsView
├─ header: title · [New rule] · ConfigMenu gear (future knobs; SkillsSection auto-appends)
├─ RuleList: row per rule — sentence rendering:
│    "When [Gmail · message received] if [text contains 'invoice'] then [Create attention (urgent)]"
│    + active toggle · fire_count · last_fired_at · [Edit] · [Runs]
├─ RuleBuilder (modal/slide-over) — three structured sections, each a sentence fragment:
│    ├─ WHEN: connector select (from registry triggers + 'System') → event select
│    ├─ IF: condition rows [field select (payload keys + text/account) · op select · value input] + add/remove
│    ├─ THEN: action rows [kind select → kind-specific fields; run_tool shows account+tool pickers and
│    │    argsTemplate JSON with {{payload.*}} hint; destructive tool → red confirm checkbox]
│    └─ footer: [Test with sample payload] (→ /automations/test, shows matched + wouldRun) · [Save]
└─ RunsDrawer: automation_runs table for a rule (status chip, detail JSON, link to triggering activity)
```

### 6.4 Homepage rework (H1) — `src/components/Overview.tsx`

Keep the file/route; restructure composition:

```
Overview
├─ HeroGreeting (existing, kept)
├─ AttentionHero (H4 — always first, full width; hidden when zero open items → thin "All clear" band)
├─ ScratchpadSlot (B5 placeholder: renders <TodayScratchpad/> if the module exists — feature-detect via
│    dynamic import try/catch — else a dashed "Today's scratchpad arrives with Tasks V2" panel;
│    toggle settings.home.showScratchpad)
├─ HomeGrid (H2 — the widget grid, replaces the hardcoded panel composition)
└─ edit mode toggle (top-right "Customize" button → drag/resize/add/remove; mirrors Sidebar customize UX)
```

Existing panels (TelemetryPanel, KPIGrid, TodoPanel, DealDeskSummary, MiniTimeline, JarvisModule, SystemMap, MissionStripe) are **wrapped as widgets** (each gets a registry entry whose component imports the existing panel unchanged) so nothing is lost — default layout reproduces today's page, so the rework is visually non-breaking until Yoshi customizes.

### 6.5 HomeGrid (H2) — `src/components/v2/home/`

```
HomeGrid.tsx        # reads settings.home.cells (default layout const if unset); 3-col CSS grid
                    # (1-col below md); size S=1col, M=2col, L=3col; renders WidgetShell per cell in `order`
WidgetShell.tsx     # panel chrome: title bar (widget title · per-cell gear · drag handle · size cycle · remove
                    #   [remove = drop from layout, never deletes data]) — controls visible in edit mode only;
                    # error boundary per cell (a crashing widget renders an inline error panel, never the page)
WidgetPicker.tsx    # edit-mode "+ Add widget" → grid of registry entries (icon/title/description);
                    # entries whose data source reports unavailable are shown greyed with the reason
WidgetConfigForm.tsx# auto-renders configSchema fields (input/select/toggle) → saves into cell.config
widgetComponents.tsx# slug → component map (client)
```

Drag/resize mechanics (decision 9): HTML5 `draggable` on the shell in edit mode, `onDragEnter` reorders a working copy, `onDrop` persists `order` — exactly the Sidebar customize pattern; size cycle button S→M→L→S persists `size`. Layout saves debounced (800 ms) via `useSettings().save({ home: { cells } })`.

### 6.6 Launch widgets (H3) — all in `src/components/v2/home/widgets/`, registry entries in `src/lib/v2/widgets/registry.ts`

| slug | Title | Data endpoint payload | Config schema | Notes |
|---|---|---|---|---|
| `attention` | Needs my attention | `/api/v2/attention` items (open) | `{ maxItems: select 5/10/20, minSeverity: select }` | also used by AttentionHero (same component, `hero` prop) |
| `tasks-upcoming` | Tasks | v2 tasks table if present else `{available:false}` | `{ scope: select new/upcoming/in-progress }` | contract for workstream B; until then renders "Tasks V2 not built yet" |
| `agent-status` | Agent status | derives from agents runs on disk (reuse `/api/fleet/runtime` shape) | `{ maxAgents }` | color-coded status bands — shared `StatusBand` component with B4/F6 (green running/blue idle/amber waiting/red error/gray offline) |
| `calendar` | Calendar | gcal connector events (today+7d) via widget data route; `{available:false, reason:'connect Google Calendar'}` when no account | `{ accountId: select (connected gcal accounts), days: select 1/7 }` | first connector-powered widget — proves G4 |
| `activity-feed` | Integration activity | latest `activities` across accounts | `{ accountId?: select all/one, maxItems }` | ships with G, gives the grid live data on day one |
| `pipeline-stats` | Pipeline / Deal Desk | wraps existing KPIGrid/DealDeskSummary data fetches | `{ view: select kpi/deals }` | wrapper widget |
| `newsletter-edition` | Newsletter | `{available:false}` until K; contract: `{ edition: { date, sections:[{topic, stories:[{title, url, sources:[]}]}] } }` | — | K fills the endpoint |
| `anynotes-recent` | AnyNotes | `{available:false}` until I; contract: `{ notes: [{id,type,title,url,capturedAt, replyCount}] }` | `{ maxItems }` | I fills the endpoint |
| `legacy-*` | (Telemetry, Todo, MiniTimeline, Jarvis, SystemMap, MissionStripe) | components fetch as they already do; data route returns `{available:true}` | — | wrappers, zero logic change |

### 6.7 AttentionHero (H4)
Full-width band atop Overview: grouped by severity (urgent red / warn amber / info neutral), each item = kind icon · title · relative time · [Go] (routes to `route`) · [✓ done] · [dismiss]. Live-updates every 30 s via `usePollWhileVisible`. Collector health line in small print when any collector is `unavailable` (honest-metrics rule).

---

## 7. Granular task list

Each task ≤ ~half-day, cold-startable. Verify = command or manual check the implementer runs. Deps reference other task IDs in this spec or external workstreams (F1/F2/F4/A/B).

### G2 — runtime foundation (build first)

- **G2.1 Types + crypto + store.**
  Files: `src/lib/v2/integrations/types.ts` (port AOC `packages/types/src/integration.ts` + `oauth/params.ts` per §4; add `ConnectorModule`, `TriggerDef`, `HomeCell` lives in widgets types), `crypto.ts` (sealSecret/openSecret AES-256-GCM, key file `~/.agentic-os/agentos.key` created 0o600 via `fs.writeFileSync(..., {mode:0o600})` — mode is advisory on Windows, note in comment), `store.ts` (DDL migration `v2_integrations_001` + typed CRUD for all §2 integration tables).
  Deps: F1 db.ts. **Shim if F1 absent:** `store.ts` opens the DB itself via `node:sqlite` `DatabaseSync` at `~/.agentic-os/agentos.db` with `CREATE TABLE IF NOT EXISTS`, behind a single `getDb()` swapped for F1's later (one-line change; document with `// F1-SHIM`).
  Verify: `node scripts/v2/int-store-smoke.mjs` — creates def+account, round-trips an encrypted config, asserts UNIQUE(definition_slug, account_id) upsert.
- **G2.2 Registry + runtime.**
  Files: `registry.ts` (static slug map, `listConnectors()`), `runtime.ts` (`setup/getTools/callTool/runSync/runProcess`; timezone injection; verbatim tool-name pass-through; call logging; soft/loud error split per decision 6), `httpJson.ts`.
  Deps: G2.1. Add deps: `zod`, `zod-to-json-schema` (`npm i` — Yoshi rebuilds; never end a session telling him to).
  Verify: unit-ish script `scripts/v2/int-runtime-smoke.mjs` with a `_test` fixture connector (echo tool) — asserts advertised name reaches `callTool` unchanged, call log row written, thrown API error → `{isError:true}`.
- **G2.3 OAuth engine.**
  Files: `oauth.ts` (startOAuth: PKCE S256 unless `disable_pkce`, `scope_identifier`/`scope_separator`, `authorization_params` merge, persisted `oauth_sessions`; handleCallback: one-shot state pop + 15-min TTL purge, token POST — form or JSON body per `body_format`, optional `Authorization: Basic`, `interpolateString` for `${...}` URL templates), routes `src/app/api/v2/integrations/oauth/start/route.ts` + `oauth/callback/route.ts` (§5.3).
  Deps: G2.1, G2.2.
  Verify: `scripts/v2/oauth-smoke.mjs` against a mock token server (node http on 127.0.0.1 ephemeral port): full start→callback→account-upsert loop; restart-resilience: state row survives process kill between start and callback (script re-opens DB).
- **G2.4 Sync driver + activities.**
  Files: `sync.ts` (watermark state read/merge — state only overwritten by keys the connector returns; pre-filter regex application → `rejection_reason`; activity rows; `events.emit('activity.created', ...)` with local no-op bus fallback `src/lib/v2/integrations/busShim.ts` if F2 absent; `integration_sync_runs` row per run incl. error), `ingest.ts` (seam: if Memory V2 module exists → enqueue episode with label `integration:<slug>` + sourceURL; else leave `ingest_status='pending'`).
  Deps: G2.1–G2.2.
  Verify: fixture connector emits 3 activities + state; script asserts rows, watermark persisted, second run with same fixture emits 0 (watermark respected), one activity matching an exclude pre-filter is rejected with reason.
- **G2.5 Webhook endpoint.**
  Files: `webhooks.ts`, `src/app/api/hooks/[slug]/route.ts` (§5.9), **edit `src/proxy.ts`** exempt list (pattern-match how `/api/agents/hook/` is exempted).
  Deps: G2.2, G2.4.
  Verify: `scripts/v2/hooks-smoke.mjs` — POST without secret → 401; with secret + fixture connector identify/process → activity row; unknown slug → 200 empty; run with `AGENTOS_PASSWORD` set to prove the exemption (curl without cookie).
- **G2.6 Account/def API routes.**
  Files: §5.1–5.5 routes (7 files). No secrets in any GET.
  Deps: G2.1–G2.4.
  Verify: `scripts/v2/int-api-smoke.mjs` (fetch against running dev server, `SMOKE_BASE_URL` env): list, def PATCH (booleans flip), connect fixture via api-key path, rules CRUD, activity list.
- **G2.7 Rules plumbing to memory.**
  Files: `rules.ts` — `getActiveRuleTexts(accountId): string[]` + export consumed by Memory V2's normalize prompt ("Apply these rules… If content does NOT satisfy these rules, respond with NOTHING_TO_REMEMBER" — convention documented in the function docstring for SPEC-A's author).
  Deps: G2.1. Verify: covered by G2.6 script + a docstring review checkbox.
- **G2.8 Scheduling glue.**
  Files: `schedule.ts` (`ensureIntegrationSync()`; F2 `scheduler.register` primary, croner-on-`globalThis.__agentosIntSync` fallback; honors per-connector `spec.schedule.frequency`; overlap guard; unregister on account deactivate), **edit `src/instrumentation.ts`** to boot it.
  Deps: G2.4; F2 optional.
  Verify: fixture connector with `frequency: '* * * * *'`; watch two ticks fire exactly one overlapping run; deactivate account → no further runs (script polls sync_runs table, ~150 s runtime, acceptable).

### G3 — wave-1 connectors

- **G3.1 Gmail tools port.** `connectors/gmail/{spec.ts,tools.ts,index.ts}` — port AOC `integrations/gmail/src/mcp/index.ts` hand-written tools (skip generated), OAuth2Client rebuilt per call from stored tokens (auto-refresh; persist refreshed tokens back via runtime callback), tz-aware date rewriting kept. Add deps: `googleapis`, `google-auth-library`. Deps: G2.2, G2.3. Verify: with Yoshi's Google app configured — connect, `gmail_search_emails` last-24h returns real rows via the Tools tab [Try]; without creds, zod-schema snapshot test in `scripts/v2/connector-schemas.mjs` (asserts every tool name is slug-prefixed + JSON Schema valid).
- **G3.2 Gmail sync port.** `connectors/gmail/sync.ts` — verbatim-adapt AOC `schedule.ts` (24h default, 50 caps, +20s watermark, state-on-progress-only, Turndown, exact activity text format + `https://mail.google.com/mail/u/0/#inbox/<id>` sourceURL, all errors → `[]` + sync_run error). Emits `event_type:'GMAIL_MESSAGE_RECEIVED'` with payload `{from, subject, messageId, threadId}`. Add dep: `turndown`. Deps: G3.1, G2.4. Verify: manual sync against the agent Gmail account → activities appear; immediate re-sync → 0 new.
- **G3.3 Notion connector.** `connectors/notion/*` — port account-create + all 16 tools per §4 (axios→httpJson; keep Notion-Version header, error swallowing, page XML rendering, prompt-descriptions verbatim; basic token auth + `owner=user` + PKCE-disabled in spec). Deps: G2.2, G2.3. Verify: connect real workspace; `notion_search` + `notion_get_page` round-trip in Tools tab; schema snapshot in connector-schemas script.
- **G3.4 GitHub connector.** `connectors/github/*` — PAT auth (setup probes `GET /user` → accountId=login), tools per §3.3 via REST v3 fetch, sync = notifications poll with `If-Modified-Since`/updated-cursor watermark, triggers `GITHUB_NOTIFICATION`/`GITHUB_ISSUE_ASSIGNED`. Deps: G2.2. Verify: connect with a PAT; list repos; sync produces activities for unread notifications; 304 path produces empty run without error.
- **G3.5 Google Calendar connector.** `connectors/gcal/*` — reuses Google OAuth path (definition config may point at the same clientId/secret; UI hint "reuse Gmail app credentials"), tools per §3.3, sync per §3.3 incl. `GCAL_EVENT_SOON` emission. Deps: G3.1 (shared google client helper — factor `connectors/googleClient.ts`). Verify: connect; create event via tool; sync captures it; calendar widget (H3.3) renders it.
- **G3.6 Slack connector.** `connectors/slack/*` — bot-token api-key auth (setup probes `auth.test` → accountId=team_id), tools per §3.3, webhook handler (`webhook.ts`: signing-secret HMAC + url_verification + event→activity mapping for `app_mention`/`message.im`/`reaction_added`), poll fallback sync. Deps: G2.2, G2.5. Verify: hooks-smoke extended with a signed sample Slack event → activity row; post-message tool round-trip if a token is available.
- **G3.7 Buzz connector.** `connectors/buzz/*` — local auth; tools + sync wrap `src/lib/buzzBridge.ts` (post/read/list; sync watermark = last event timestamp per channel). Deps: G2.2. Verify: post to `#marketing-ideas` via Tools tab; sync pulls the message back as an activity.

### G4 — MCP exposure + tool UI

- **G4.1 Meta-tools library.** `metaTools.ts` per §5.6 — descriptions verbatim from AOC `utils/mcp/memory.ts`, selection prompt verbatim from `utils/mcp/prompts.ts`, LLM filter through `cliComplete` (respect `settings` provider selection; fail-loud on provider error, fall back to all-tools ONLY on parse failure with `console.warn`). Deps: G2.2, G2.6. Verify: `scripts/v2/metatools-smoke.mjs` calls the three functions directly (no MCP transport): fixture account discovered; `get_integration_actions('send an email', <uuid>)` returns ≤3 schemas incl. `gmail_send_email` when gmail connected.
- **G4.2 F4 handoff.** Export `integrationMetaTools()` in the shape SPEC-F4 defines (coordinate: flat `{name, description, inputSchema, handler}` array); add `/api/v2/integrations/accounts/[id]/call` `source` tagging so `?source=` from `/api/mcp` lands in call logs. Deps: G4.1, F4. Verify: from Claude Code pointed at `/api/mcp`, run get_integrations → execute a Notion search (E2E per MASTER-PLAN G verify line).
- **G4.3 Destructive-tool approve UI.** `src/components/v2/integrations/toolUi/EmailToolUi.tsx` + generic `DestructiveToolGate.tsx` (two-phase: editable form → send/decline; result view) wired into AccountDetail Tools [Try] for tools with `destructiveHint`. Deps: G3.1, G2.6 UI. Verify: gmail_send_email [Try] shows editable compose; decline sends nothing (call log shows no call).

### G5 — automations

- **G5.1 Engine + tables.** Migration `v2_automations_001`; `src/lib/v2/automations/engine.ts` (subscribe `activity.created` + `sync.failed`; condition evaluator with op whitelist; action executors per §5.7; `{{payload.*}}` template substitution — **string-only, no eval**; automation_runs rows; failures → attention). `ensureAutomations()` boot in instrumentation. Deps: G2.4, H4.1 (attention store for create_attention/action-failure). Verify: `scripts/v2/automations-smoke.mjs` — seed rule When fixture-event if text contains X then create_attention; emit fixture activity; assert attention item + run row; non-matching activity → `condition_miss` recorded? (no — condition_miss runs are only recorded when a rule matched trigger but failed conditions; assert that too).
- **G5.2 API routes.** §5.7 routes (rules CRUD w/ whitelist validation, runs, test dry-run). Deps: G5.1. Verify: extend automations-smoke via HTTP.
- **G5.3 Automations page.** `src/app/automations/page.tsx`, `AutomationsView.tsx`, `RuleBuilder.tsx`, `RunsDrawer.tsx` per §6.3; Sidebar entry. Deps: G5.2. Verify: build a Gmail→attention rule entirely in UI; test-with-sample shows matched; real sync fires it.
- **G5.4 run_tool action + confirm gate.** Action executor for `run_tool` with argsTemplate substitution + destructive-confirm requirement (builder blocks saving run_tool on a destructive-annotated tool unless confirm checked; engine re-checks annotation at fire time). Deps: G5.1, G4.1. Verify: rule that posts to Buzz on GITHUB_NOTIFICATION; fires end-to-end; a destructive rule without confirm refuses to save (422).

### H — homepage + widgets

- **H2.1 Widget framework types + registry + shell.** `src/lib/v2/widgets/{types.ts,registry.ts}`, `src/components/v2/home/{HomeGrid.tsx,WidgetShell.tsx,widgetComponents.tsx}` with 2 seed widgets (`activity-feed`, `attention` stub reading §5.8), settings subtree `home.cells` + defaults const. Per-cell error boundary. Deps: G2.6 (activity data), H4.1 for attention data (stub `{items:[]}` acceptable first). Verify: `/` renders grid from default layout; corrupting one widget (throw in dev) shows inline error panel only.
- **H2.2 Edit mode: drag/reorder/resize/add/remove + config forms.** `WidgetPicker.tsx`, `WidgetConfigForm.tsx`, DnD per decision 9, debounced settings save. Deps: H2.1. Verify: reorder + resize + add-with-config; hard-refresh → layout identical (MASTER-PLAN H verify line "layout persists").
- **H1.1 Overview restructure.** Rework `src/components/Overview.tsx` per §6.4: AttentionHero + ScratchpadSlot (feature-detect) + HomeGrid; wrap all existing panels as `legacy-*` widgets; default layout reproduces the current page order. Deps: H2.1, H4.2. Verify: side-by-side vs pre-change screenshot — same panels visible by default; `settings.home.showScratchpad=false` hides slot.
- **H3.1 Widget data route + activity/pipeline/agent-status widgets.** `/api/v2/widgets/route.ts` + `[slug]/data/route.ts` dispatcher; widgets `activity-feed`, `pipeline-stats` (wraps existing fetches), `agent-status` (+ shared `src/components/v2/StatusBand.tsx` with the 5-color mapping — exported for B4/F6). Deps: H2.1. Verify: each widget shows live data; kill dev-server access to a source (rename a dir in a scratch copy — or simply assert the `{available:false}` path via a bogus config) renders the honest unavailable state.
- **H3.2 Placeholder-contract widgets.** `tasks-upcoming`, `newsletter-edition`, `anynotes-recent` — components + registry entries + data-route stubs returning `{available:false, reason}` with the §6.6 payload contracts documented as TS types exported for workstreams B/I/K. Deps: H2.1. Verify: picker shows them greyed with reason; adding one renders the empty-state panel.
- **H3.3 Calendar widget.** `calendar` widget: account select from connected gcal accounts (config schema `accountId`), data route calls gcal listEvents tool through `runtime.callTool` (proves G4 connector→widget path). Deps: G3.5, H2.2. Verify: MASTER-PLAN G verify — connected calendar renders today's events; disconnecting flips to `{available:false}`.
- **H4.1 Attention store + collectors.** Migration `v2_attention_001`; `src/lib/v2/attention/{store.ts,collectors.ts,index.ts}` per §3.5 (upsert-by-dedupe, autoResolve, 60 s tick on globalThis, event-bus fast path when F2 present, per-collector health). Boot in instrumentation. Deps: G2.1 (db), agents dirs read-only. Verify: `scripts/v2/attention-smoke.mjs` — seed a fake pending approval file in a scratch agent dir → item appears; remove it → autoResolved on next tick; sync failure row → `sync_failed` item.
- **H4.2 Attention API + hero + widget.** §5.8 route (GET/PATCH), `AttentionHero.tsx` + `attention` widget component (shared), severity grouping, done/dismiss, collector-health footnote. Deps: H4.1, H2.1. Verify: dismiss persists across refresh; [Go] routes correctly for each kind; muteKinds setting hides a kind.

Suggested order: G2.1→G2.2→G2.4→G2.6 → H4.1 → H2.1 → G2.3→G3.x (any order, gmail first) → G2.5→G3.6 → G2.8 → H4.2→H2.2→H1.1→H3.* → G4.* → G5.*.

---

## 8. Risks & Windows-specific notes

1. **F1 engine ambiguity (better-sqlite3 vs node:sqlite).** Constraint says better-sqlite3 + sqlite-vec, but the repo currently uses `node:sqlite` and better-sqlite3 needs a native build (Windows: prebuilds exist for Node 22; verify `npm i better-sqlite3` pulls a prebuilt, else node-gyp/MSVC pain). Mitigation: G2.1's `getDb()` shim isolates the choice to one function; none of this spec's tables need sqlite-vec.
2. **Key/secret handling.** `~/.agentic-os/agentos.key` file mode is advisory on Windows (NTFS ACLs ignore `mode:0o600`) — acceptable for a single-user box; never log decrypted config; API routes must never serialize `config_enc` contents (G2.6 verify asserts this by grepping responses for token substrings).
3. **OAuth on LAN.** Google/Notion redirect URIs must exactly match `callbackOrigin`; when Yoshi connects from a LAN device the callback goes to `localhost` of the *server* — document in ConnectDialog: "authorize from the machine running Agent OS, or set callbackOrigin to the LAN URL and register it with the provider."
4. **`googleapis` weight.** Large install (~100 MB) but pure JS; it buys a near-verbatim port of 1,600 lines of proven Gmail tooling. If install size offends, the fallback is fetch-based Google REST — a bigger rewrite, explicitly deferred.
5. **Long-running syncs vs Next route lifecycle.** Sync runs must be driven by the instrumentation-booted singleton (globalThis), never awaited inside a request beyond the manual `/sync` route (which caps at connector-internal limits, Gmail = 50+50 messages). No `waitUntil` assumptions.
6. **Slack signature timing.** HMAC check needs the RAW body — in a route handler read `await req.text()` first, verify, then `JSON.parse` (Next re-parsing gotcha; do NOT call `req.json()` before verification).
7. **Croner fallback drift.** If F2 lands mid-build, migrate `schedule.ts` registrations in one sitting; both paths co-existing risks double-firing (the overlap guard makes this harmless but noisy).
8. **Widget grid + React 19.** Hand-rolled DnD avoids lib-compat risk; HTML5 DnD quirks on Windows touchscreens are out of scope (mouse-first).
9. **Fire-and-forget webhook processing** can outlive the response on dev-server hot reload — acceptable (idempotent activity creation keyed by connector-side ids where available; Gmail/GitHub/Slack payload ids used as natural dedupe keys inside each connector's process()).
10. **Rule 12/15 compliance:** no task in this spec restarts the dev server; smoke scripts that need the server take `SMOKE_BASE_URL` and are run when Yoshi has it up.
11. **Prompt-injection surface:** activity text is third-party content (emails, Slack messages) flowing into memory and automations. Automations conditions/templates are deterministic string ops (no eval); the LLM only ever *filters tool schemas* (G4.1) — never executes from activity text. Memory V2 ingestion should carry the standard untrusted-content framing (note passed to SPEC-A).

---

## 9. Verification plan — `scripts/v2/`

All scripts plain `node *.mjs`, zero test-framework deps, exit non-zero on failure, print `PASS`/`FAIL` lines (repo house style). DB-touching scripts use a throwaway DB via `AGENTOS_DB_PATH` env override honored by `getDb()` (add in G2.1) so smoke runs never write the live `agentos.db`.

| Script | Covers | Needs server? |
|---|---|---|
| `int-store-smoke.mjs` | G2.1 DDL, crypto round-trip, account upsert semantics | no |
| `int-runtime-smoke.mjs` | tool-name invariant, call logs, soft/loud errors (fixture connector `connectors/_test/`) | no |
| `oauth-smoke.mjs` | PKCE flow vs mock token server, persisted state across process restart | no |
| `int-sync-smoke.mjs` | watermark, pre-filter rejection, activity rows, events emitted | no |
| `hooks-smoke.mjs` | secret gate, Slack challenge + signed event, proxy exemption | yes |
| `int-api-smoke.mjs` | §5.1–5.5 routes, no-secret-leak grep | yes |
| `connector-schemas.mjs` | every wave-1 connector: slug-prefixed names, valid JSON Schemas, spec completeness | no |
| `metatools-smoke.mjs` | 3 meta-tools incl. LLM filter (skips filter assert if no provider configured — prints SKIP loudly) | no |
| `automations-smoke.mjs` | G5 engine + routes: match, condition_miss, action_failed→attention, dry-run test | yes |
| `attention-smoke.mjs` | collectors, dedupe upsert, autoResolve, API done/dismiss | yes |
| `widgets-smoke.mjs` | registry endpoint, per-widget data routes incl. `{available:false}` honesty, layout PATCH round-trip | yes |

End-to-end acceptance (manual, matches MASTER-PLAN verify lines):
1. Connect Notion → sync/tool round-trip → (once A lands) ask Jarvis about a Notion page (G).
2. Gmail activity fires a UI-built automation → attention item on Homepage (G5 + H4).
3. Customize the home grid, hard-refresh, layout persists; calendar widget live-updates from the gcal connector (H).

---

## Open questions (for Yoshi / other spec authors)

1. **F1 engine call** — better-sqlite3 (constraint) vs node:sqlite (current repo reality): whoever writes SPEC-F1 must decide; this spec is engine-agnostic via `getDb()`.
2. **F4 tool export shape** — `integrationMetaTools()` return type must match SPEC-F4's mount contract; coordinate before G4.2.
3. **Slack: OAuth2 app vs bot-token?** Wave 1 assumes bot token (simplest); if Yoshi wants Slack OAuth install flow, it's a G3.6 extension using the existing oauth.ts (no new machinery).
4. **`googleapis` dependency size** — accepted here; veto → fetch-based rewrite (+1–2 days on G3.1).
5. **Memory ingestion label taxonomy** — this spec labels episodes `integration:<slug>`; SPEC-A owns the label model and should confirm.


