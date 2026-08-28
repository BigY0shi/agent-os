import type { Database } from "better-sqlite3";

/**
 * Forward-only migrations for ~/.agentic-os/agentos.db.
 * Version ranges are reserved per workstream (ultraplan/CONVENTIONS.md §1.5):
 *   001-019 foundations+memory (SPEC-A) · 020-029 tasks (B) · 030-039 jarvis/webmcp (C)
 *   040-049 integrations/home (D) · 050-059 browser/agents (E) · 060-069 notes/newsletter/mkt/3d (F)
 * No down migrations — recovery is restore-from-backup (exile philosophy).
 */
export interface Migration {
  version: number;
  name: string;
  up: (db: Database) => void;
}

const M001_FOUNDATIONS_AND_MEMORY = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- F2 event log (Homepage feed + audit)
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,
  source     TEXT,
  payload    TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_type_time ON events(type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_time ON events(created_at DESC);

-- F2 scheduler jobs (RRULE or one-shot)
CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  name        TEXT NOT NULL,
  payload     TEXT NOT NULL DEFAULT '{}',
  rrule       TEXT,
  run_at      TEXT,
  last_run_at TEXT,
  last_status TEXT,
  last_error  TEXT,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs(enabled, run_at);

-- A2 ingestion queue
CREATE TABLE IF NOT EXISTS ingestion_queue (
  id           TEXT PRIMARY KEY,
  data         TEXT NOT NULL,
  output       TEXT,
  status       TEXT NOT NULL DEFAULT 'PENDING',
  stage        TEXT,
  priority     INTEGER NOT NULL DEFAULT 0,
  source       TEXT NOT NULL,
  title        TEXT,
  session_id   TEXT,
  graph_ids    TEXT NOT NULL DEFAULT '[]',
  label_ids    TEXT NOT NULL DEFAULT '[]',
  error        TEXT,
  retry_count  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  processed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_iq_status ON ingestion_queue(status, created_at DESC);

-- Owned by SPEC-A; integration rules write here with source = account id
-- (pre_filter_json per CONVENTIONS §1.7)
CREATE TABLE IF NOT EXISTS ingestion_rules (
  id              TEXT PRIMARY KEY,
  name            TEXT,
  text            TEXT NOT NULL,
  source          TEXT,
  pre_filter_json TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL
);

-- A1 memory graph
CREATE TABLE IF NOT EXISTS episodes (
  uuid             TEXT PRIMARY KEY,
  content          TEXT NOT NULL,
  original_content TEXT NOT NULL,
  metadata         TEXT NOT NULL DEFAULT '{}',
  source           TEXT NOT NULL,
  type             TEXT NOT NULL DEFAULT 'CONVERSATION',
  session_id       TEXT NOT NULL,
  queue_id         TEXT,
  chunk_index      INTEGER,
  total_chunks     INTEGER,
  version          INTEGER NOT NULL DEFAULT 1,
  content_hash     TEXT,
  chunk_hashes     TEXT,
  user_id          TEXT NOT NULL DEFAULT 'owner',
  end_user_id      TEXT,
  agent_id         TEXT,
  recall_count     INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  valid_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ep_session ON episodes(session_id, valid_at);
CREATE INDEX IF NOT EXISTS idx_ep_valid ON episodes(valid_at DESC);
CREATE INDEX IF NOT EXISTS idx_ep_enduser ON episodes(end_user_id);
CREATE INDEX IF NOT EXISTS idx_ep_agent ON episodes(agent_id);

CREATE TABLE IF NOT EXISTS entities (
  uuid       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  type       TEXT,
  attributes TEXT NOT NULL DEFAULT '{}',
  user_id    TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ent_name ON entities(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS statements (
  uuid           TEXT PRIMARY KEY,
  fact           TEXT NOT NULL,
  aspect         TEXT NOT NULL,
  attributes     TEXT NOT NULL DEFAULT '{}',
  user_id        TEXT NOT NULL DEFAULT 'owner',
  created_at     TEXT NOT NULL,
  valid_at       TEXT NOT NULL,
  invalid_at     TEXT,
  invalidated_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_st_valid ON statements(valid_at DESC);
CREATE INDEX IF NOT EXISTS idx_st_aspect ON statements(aspect, invalid_at);

-- Replaces Neo4j entirely. 4 edge types.
CREATE TABLE IF NOT EXISTS edges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL CHECK (type IN ('provenance','subject','predicate','object')),
  from_uuid  TEXT NOT NULL,
  to_uuid    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(type, from_uuid, to_uuid)
);
CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_uuid, type);
CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_uuid, type);

CREATE TABLE IF NOT EXISTS labels (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT,
  color       TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS episode_labels (
  episode_uuid TEXT NOT NULL,
  label_id     TEXT NOT NULL,
  PRIMARY KEY (episode_uuid, label_id)
);
CREATE INDEX IF NOT EXISTS idx_eplab_label ON episode_labels(label_id);

CREATE TABLE IF NOT EXISTS document_labels (
  document_id TEXT NOT NULL,
  label_id    TEXT NOT NULL,
  PRIMARY KEY (document_id, label_id)
);

-- Voice aspects (Directive|Preference|Habit|Belief|Goal|Task) — stored WHOLE, never SPO
CREATE TABLE IF NOT EXISTS voice_aspects (
  uuid           TEXT PRIMARY KEY,
  fact           TEXT NOT NULL,
  aspect         TEXT NOT NULL,
  episode_uuids  TEXT NOT NULL DEFAULT '[]',
  user_id        TEXT NOT NULL DEFAULT 'owner',
  created_at     TEXT NOT NULL,
  valid_at       TEXT NOT NULL,
  invalid_at     TEXT,
  invalidated_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_va_aspect ON voice_aspects(aspect, invalid_at, valid_at DESC);

-- Compacted sessions + persona doc + ingested documents
CREATE TABLE IF NOT EXISTS documents (
  id           TEXT PRIMARY KEY,
  session_id   TEXT,
  title        TEXT NOT NULL,
  content      TEXT NOT NULL,
  source       TEXT,
  type         TEXT NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1,
  content_hash TEXT,
  chunk_hashes TEXT,
  end_user_id  TEXT,
  metadata     TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_session ON documents(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_doc_type ON documents(type, updated_at DESC);

CREATE TABLE IF NOT EXISTS recall_logs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  query            TEXT NOT NULL,
  query_type       TEXT,
  search_method    TEXT NOT NULL DEFAULT 'search_v2',
  result_count     INTEGER NOT NULL DEFAULT 0,
  response_time_ms INTEGER,
  context          TEXT NOT NULL DEFAULT '{}',
  created_at       TEXT NOT NULL
);
`;

/** Vector namespaces (migration 002). Dimension pinned from meta.embed_dim at
 *  migration time; changing the embed model later requires scripts/v2/reembed.mjs. */
export const VEC_NAMESPACES = [
  "episode",
  "statement",
  "entity",
  "label",
  "voice_aspect",
  "compacted_session",
] as const;
export type VecNamespace = (typeof VEC_NAMESPACES)[number];

function vecDDL(dim: number): string {
  return VEC_NAMESPACES.map(
    (ns) => `
CREATE VIRTUAL TABLE IF NOT EXISTS vec_${ns} USING vec0(embedding float[${dim}] distance_metric=cosine);
CREATE TABLE IF NOT EXISTS vecmap_${ns} (
  rowid INTEGER PRIMARY KEY,
  uuid  TEXT NOT NULL UNIQUE
);`,
  ).join("\n");
}

export const DEFAULT_EMBED_MODEL = "nomic-embed-text";
export const DEFAULT_EMBED_DIM = 768;

const M020_TASKS_CORE = `
-- SPEC-B B1: task model. Timestamps TEXT UTC ISO (CONVENTIONS §1.4).
-- display_id: 'tk-N' roots, 'tk-N.M' subtasks (2 levels max, enforced in store.ts).
-- status CHECK carries REF's full 7-value enum; 'Recurring' is accepted for
-- REF parity but never set by the v2 store — recurrence = schedule IS NOT NULL.
CREATE TABLE IF NOT EXISTS v2_tasks (
  id               TEXT PRIMARY KEY,
  display_id       TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL DEFAULT '',
  description_md   TEXT,
  status           TEXT NOT NULL DEFAULT 'Todo'
    CHECK (status IN ('Todo','Waiting','Ready','Working','Review','Done','Recurring')),
  parent_uuid      TEXT REFERENCES v2_tasks(id) ON DELETE CASCADE,
  child_count      INTEGER NOT NULL DEFAULT 0,
  spec_md          TEXT,
  plan_md          TEXT,
  plan_status      TEXT NOT NULL DEFAULT 'none'
    CHECK (plan_status IN ('none','drafted','approved','rejected')),
  schedule         TEXT,             -- RRULE string, USER-LOCAL tz semantics (settings.tasks.timezone)
  run_at           TEXT,             -- UTC ISO next wake (one-shot or next computed occurrence)
  last_run_at      TEXT,
  occurrence_count INTEGER NOT NULL DEFAULT 0,
  max_occurrences  INTEGER,          -- 1 = one-shot scheduled; NULL = unlimited
  is_active        INTEGER NOT NULL DEFAULT 1,
  end_date         TEXT,
  scheduled_date   TEXT,             -- 'YYYY-MM-DD' calendar pin (B4 list/calendar; no auto-fire)
  source           TEXT NOT NULL DEFAULT 'manual',  -- manual | daily | agent | automation | seed
  agent_id         TEXT,             -- agents-module id; NULL = generalist
  result           TEXT,
  error            TEXT,
  job_id           TEXT,             -- current scheduler job id (F2)
  metadata         TEXT NOT NULL DEFAULT '{}',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  completed_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_v2_tasks_status ON v2_tasks(status);
CREATE INDEX IF NOT EXISTS idx_v2_tasks_run_at ON v2_tasks(run_at) WHERE run_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_v2_tasks_parent ON v2_tasks(parent_uuid);
CREATE INDEX IF NOT EXISTS idx_v2_tasks_sched_date ON v2_tasks(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_v2_tasks_agent ON v2_tasks(agent_id, status);

-- Activity log; every store mutation appends exactly one row.
CREATE TABLE IF NOT EXISTS v2_task_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    TEXT NOT NULL REFERENCES v2_tasks(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,   -- created|status_change|updated|woke|plan_drafted|run_ok|run_fail|rescheduled|...
  actor      TEXT NOT NULL,   -- 'user' | 'agent' | 'system'
  detail     TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_task_events ON v2_task_events(task_id, id);

-- Session linkage (F3/E own the sessions themselves; B stores rows).
CREATE TABLE IF NOT EXISTS v2_task_sessions (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES v2_tasks(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('coding','browser','exec')),
  session_ref TEXT,            -- NULL until the slot echoes = status 'starting'
  agent       TEXT,
  dir         TEXT,
  prompt      TEXT,
  status      TEXT NOT NULL DEFAULT 'starting',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_task_sessions ON v2_task_sessions(task_id);

-- Task-scoped chat threads (recurring = one per run via run_no; one-shot = shared).
CREATE TABLE IF NOT EXISTS v2_conversations (
  id         TEXT PRIMARY KEY,
  source     TEXT NOT NULL,   -- 'task' | 'scheduled-task' | 'daily' | 'chat'
  task_id    TEXT REFERENCES v2_tasks(id) ON DELETE CASCADE,
  agent_id   TEXT,
  run_no     INTEGER,         -- occurrence number for recurring runs; NULL for shared
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_conv_task ON v2_conversations(task_id);

CREATE TABLE IF NOT EXISTS v2_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES v2_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  user_type       TEXT NOT NULL DEFAULT 'human' CHECK (user_type IN ('human','system')),
  ephemeral       INTEGER NOT NULL DEFAULT 0,  -- trigger messages: kept for audit, hidden in UI
  content         TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_msgs_conv ON v2_messages(conversation_id, created_at);

-- Page→task outlinks for B5 scratchpad (v2_pages lands with B5; no FK on page_id yet).
CREATE TABLE IF NOT EXISTS v2_page_task_links (
  page_id TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES v2_tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (page_id, task_id)
);

-- FTS over title + task body (description/spec), synced by triggers.
CREATE VIRTUAL TABLE IF NOT EXISTS v2_tasks_fts USING fts5(
  task_id UNINDEXED, title, body, tokenize='porter unicode61'
);
CREATE TRIGGER IF NOT EXISTS v2_tasks_fts_ai AFTER INSERT ON v2_tasks BEGIN
  INSERT INTO v2_tasks_fts(task_id, title, body)
  VALUES (new.id, new.title, coalesce(new.description_md,'') || ' ' || coalesce(new.spec_md,''));
END;
CREATE TRIGGER IF NOT EXISTS v2_tasks_fts_au AFTER UPDATE OF title, description_md, spec_md ON v2_tasks BEGIN
  DELETE FROM v2_tasks_fts WHERE task_id = new.id;
  INSERT INTO v2_tasks_fts(task_id, title, body)
  VALUES (new.id, new.title, coalesce(new.description_md,'') || ' ' || coalesce(new.spec_md,''));
END;
CREATE TRIGGER IF NOT EXISTS v2_tasks_fts_ad AFTER DELETE ON v2_tasks BEGIN
  DELETE FROM v2_tasks_fts WHERE task_id = old.id;
END;
`;

const M021_PAGES_SCRATCHPAD = `
-- SPEC-B B5: scratchpad pages (TipTap JSON, single-client, rev-based optimistic
-- lock — Yjs DEFERRED per SPEC-B §1.1; the doc I/O seam lives in pages/store.ts).
CREATE TABLE IF NOT EXISTS v2_pages (
  id         TEXT PRIMARY KEY,
  date       TEXT,              -- 'YYYY-MM-DD' in settings.tasks.timezone; NULL = non-daily page
  title      TEXT NOT NULL DEFAULT '',
  doc_json   TEXT NOT NULL DEFAULT '{"type":"doc","content":[]}',
  rev        INTEGER NOT NULL DEFAULT 0,   -- optimistic concurrency (409 on stale save)
  metadata   TEXT NOT NULL DEFAULT '{}',   -- lastIngestHash (B6 nightly ingest), ...
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_pages_date ON v2_pages(date) WHERE date IS NOT NULL;

-- @jarvis paragraph comments (REF ButlerComment, pattern-only: Yjs relative
-- positions replaced by paragraph-node-id attrs + normalized-text fallback).
CREATE TABLE IF NOT EXISTS v2_page_comments (
  id               TEXT PRIMARY KEY,
  page_id          TEXT NOT NULL REFERENCES v2_pages(id) ON DELETE CASCADE,
  anchor_node_id   TEXT,        -- paragraph attrs.nodeId at detection time
  anchor_text_norm TEXT,        -- normalized paragraph text (fallback anchor + dedupe key)
  author           TEXT NOT NULL DEFAULT 'jarvis' CHECK (author IN ('jarvis','user')),
  body_md          TEXT NOT NULL DEFAULT '',
  conversation_id  TEXT,        -- v2_conversations (source 'daily'), nullable
  created_at       TEXT NOT NULL,
  resolved_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_v2_page_comments_page ON v2_page_comments(page_id, created_at);
`;

const M022_SKILLS_POLICIES = `
-- SPEC-B B7 (CONVENTIONS §11): skills-as-policies — standing policy blocks
-- authored in-app (/skills page) and injected into task-execution prompts (B2)
-- and the Jarvis context (C4) via skills/store.ts withSkills()/
-- renderSkillPolicyBlock(). DISTINCT from the FILE-based operating skills
-- (~/.agentic-os/skills/<name>/SKILL.md, platformSkills.ts), which keep
-- fronting the CLI-agent lanes — coexistence documented in skills/store.ts.
CREATE TABLE IF NOT EXISTS v2_skills (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  policy_md   TEXT NOT NULL DEFAULT '',
  is_active   INTEGER NOT NULL DEFAULT 1,
  position    INTEGER NOT NULL DEFAULT 0,  -- injection/list order (ascending)
  archived_at TEXT,                        -- soft-archive stamp; rows are never destroyed (house rule)
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_skills_order ON v2_skills(position, created_at);
`;

const M030_WEBMCP_CORE = `
-- SPEC-C D1/D2: WebMCP Engine core. Timestamps TEXT UTC ISO (CONVENTIONS §1.4).
-- secrets_json holds NAMES -> '{{secret:NAME}}' refs only; the VALUES live in
-- ~/.agentic-os/webmcp/<slug>.secrets.json (never in the DB, never in responses).
CREATE TABLE IF NOT EXISTS webmcp_packages (
  id              TEXT PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,      -- ^[a-z0-9][a-z0-9-]{1,40}$
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  icon            TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  current_version INTEGER NOT NULL DEFAULT 0,
  secrets_json    TEXT NOT NULL DEFAULT '{}',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- The tool rows ARE the draft working set; published behavior comes ONLY from
-- webmcp_package_versions snapshots (draft-vs-published drift rule, SPEC-C §8.10).
CREATE TABLE IF NOT EXISTS webmcp_tools (
  id                  TEXT PRIMARY KEY,
  package_id          TEXT NOT NULL REFERENCES webmcp_packages(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,         -- exactly the name advertised to agents (invariant §8.7)
  description         TEXT NOT NULL DEFAULT '',
  input_schema_json   TEXT NOT NULL DEFAULT '{"type":"object","properties":{}}',
  handler_kind        TEXT NOT NULL CHECK (handler_kind IN ('internal','http','js')),
  handler_config_json TEXT NOT NULL DEFAULT '{}',
  requires_approval   INTEGER NOT NULL DEFAULT 0,
  position            INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  UNIQUE(package_id, name)
);

CREATE TABLE IF NOT EXISTS webmcp_package_versions (
  id            TEXT PRIMARY KEY,
  package_id    TEXT NOT NULL REFERENCES webmcp_packages(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,               -- frozen {package, tools[]} at publish time
  published_at  TEXT NOT NULL,
  UNIQUE(package_id, version)
);

-- Append-only. args_json is REDACTED (redactArgs, CONVENTIONS §9.3) + 4KB-capped.
CREATE TABLE IF NOT EXISTS webmcp_call_logs (
  id           TEXT PRIMARY KEY,
  package_slug TEXT NOT NULL,
  tool_name    TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT '',
  args_json    TEXT NOT NULL DEFAULT '{}',
  ok           INTEGER NOT NULL,
  error        TEXT,
  duration_ms  INTEGER NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webmcp_logs_pkg ON webmcp_call_logs(package_slug, created_at DESC);
`;

const M031_JARVIS_CONVERSATIONS = `
-- SPEC-C C3: Jarvis brain conversation persistence. Timestamps TEXT UTC ISO
-- (CONVENTIONS §1.4). pageContext is NEVER stored here (C5 privacy rule —
-- per-request only); message content is the user's/assistant's raw text.
CREATE TABLE IF NOT EXISTS jarvis_conversations (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL DEFAULT '',
  channel    TEXT NOT NULL DEFAULT 'overlay' CHECK (channel IN ('overlay','page')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jarvis_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES jarvis_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content         TEXT NOT NULL,
  tool_calls_json TEXT,                      -- [{name, summary, ok}] per assistant turn, else NULL
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jarvis_messages_conv ON jarvis_messages(conversation_id, created_at);
`;

const M033_WEBMCP_APPROVALS = `
-- SPEC-C Human-Gate (Phase-4 chunk 2): pending approval records for
-- requires_approval tools invoked interactively. args_json is the RAW
-- (schema-validated) args kept for execution on approve; redacted_args_json
-- (redactArgs, CONVENTIONS §9.3) is the ONLY variant that ever leaves the
-- server. Timestamps TEXT UTC ISO (CONVENTIONS §1.4).
CREATE TABLE IF NOT EXISTS webmcp_approvals (
  id                 TEXT PRIMARY KEY,
  slug               TEXT NOT NULL,             -- package slug, or 'registry' for plain registry-action keys
  tool               TEXT NOT NULL,             -- tool name (or full registry key when slug='registry')
  args_json          TEXT NOT NULL DEFAULT '{}',
  redacted_args_json TEXT NOT NULL DEFAULT '{}',
  requested_by       TEXT NOT NULL DEFAULT '',  -- ExecuteCtx.source ('jarvis', 'mcp:*', ...)
  conversation_id    TEXT,                      -- jarvis_conversations id, nullable
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','expired')),
  result_json        TEXT,                      -- ExecuteResult stored on approve
  created_at         TEXT NOT NULL,
  resolved_at        TEXT,
  expires_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webmcp_approvals_status ON webmcp_approvals(status, created_at DESC);
`;

const M040_INTEGRATIONS_CORE = `
-- SPEC-D G2.1: integrations runtime core. Timestamps TEXT UTC ISO (CONVENTIONS
-- §1.4). Secrets NEVER stored plaintext: config_enc columns hold AES-256-GCM
-- blobs sealed by integrations/crypto.ts (key at ~/.agentic-os/agentos.key) and
-- are NEVER serialized into any API response (SPEC-D §8.2).
-- NOTE: SPEC-D §2's own ingestion_rules DDL is VOID per CONVENTIONS §1.7 —
-- integration user rules live in SPEC-A's ingestion_rules with source = <account id>.
CREATE TABLE IF NOT EXISTS integration_definitions (
  slug        TEXT PRIMARY KEY,              -- matches the in-repo connector slug
  enabled     INTEGER NOT NULL DEFAULT 1,
  config_enc  TEXT,                          -- AES-GCM blob: { clientId, clientSecret, webhookSecret, ... }
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integration_accounts (
  id              TEXT PRIMARY KEY,          -- crypto.randomUUID()
  definition_slug TEXT NOT NULL REFERENCES integration_definitions(slug),
  account_id      TEXT NOT NULL,             -- external identity (email addr, workspace id, npub, login)
  display_name    TEXT,
  config_enc      TEXT NOT NULL,             -- AES-GCM blob: tokens / api key / per-account config
  settings_json   TEXT NOT NULL DEFAULT '{}',-- { state: {...sync watermarks}, autoActivityRead: bool, triggersEnabled: bool }
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE (definition_slug, account_id)       -- upsert semantics preserved from upstream
);

CREATE TABLE IF NOT EXISTS activities (
  id               TEXT PRIMARY KEY,
  account_id       TEXT NOT NULL REFERENCES integration_accounts(id),
  text             TEXT NOT NULL,
  source_url       TEXT,
  event_type       TEXT,                     -- connector-declared trigger key, e.g. 'GMAIL_MESSAGE_RECEIVED'
  payload_json     TEXT,                     -- structured event payload for automations (G5)
  rejection_reason TEXT,                     -- set when a user-rule pre-filter rejects it
  ingest_status    TEXT NOT NULL DEFAULT 'pending', -- pending|ingested|rejected|failed
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activities_account ON activities(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activities_ingest ON activities(ingest_status);

-- args_json is REDACTED (redactArgs, CONVENTIONS §9.3) — additive vs SPEC-D §2
-- (the DDL there had no args column; the chunk contract requires redacted call
-- logging, matching webmcp_call_logs).
CREATE TABLE IF NOT EXISTS integration_call_logs (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL,
  tool_name   TEXT NOT NULL,
  source      TEXT,                          -- '?source=' tag from /api/mcp, or 'ui' | 'automation:<ruleId>'
  args_json   TEXT NOT NULL DEFAULT '{}',
  ok          INTEGER NOT NULL,
  error       TEXT,
  duration_ms INTEGER,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_int_call_logs_acct ON integration_call_logs(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS integration_sync_runs (
  id               TEXT PRIMARY KEY,
  account_id       TEXT NOT NULL,
  trigger          TEXT NOT NULL,            -- 'schedule' | 'manual' | 'webhook'
  started_at       TEXT NOT NULL,
  finished_at      TEXT,
  ok               INTEGER,
  activities_count INTEGER NOT NULL DEFAULT 0,
  error            TEXT
);
CREATE INDEX IF NOT EXISTS idx_int_sync_runs_acct ON integration_sync_runs(account_id, started_at DESC);

CREATE TABLE IF NOT EXISTS oauth_sessions (
  state           TEXT PRIMARY KEY,          -- crypto.randomBytes(24).toString('base64url')
  definition_slug TEXT NOT NULL,
  code_verifier   TEXT,                      -- PKCE
  redirect_url    TEXT NOT NULL,             -- app page to bounce back to
  created_at      TEXT NOT NULL              -- rows older than 15 min are purged on read
);
`;

const M041_ATTENTION_CORE = `
-- SPEC-D H4.1: "needs my attention" store. Timestamps TEXT UTC ISO
-- (CONVENTIONS §1.4). One row per dedupe_key — upsertByDedupeKey refreshes
-- title/severity/payload on re-flag and reopens auto-resolved rows; a
-- user-dismissed row is NEVER resurrected by a re-flag (attention/store.ts
-- documents the full status semantics). Fed by the generic 'attention.flag'
-- bus bridge (CONVENTIONS §5 payload contract) + the pull collectors.
CREATE TABLE IF NOT EXISTS attention_items (
  id               TEXT PRIMARY KEY,
  dedupe_key       TEXT NOT NULL UNIQUE,      -- e.g. 'sync-fail:<accountId>', approval id
  kind             TEXT NOT NULL,             -- approval|agent_error|sync_failed|automation|... (open set)
  severity         TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warn','urgent')),
  title            TEXT NOT NULL,
  body             TEXT,
  route            TEXT,                      -- in-app link the hero's [Go] follows
  payload_json     TEXT NOT NULL DEFAULT '{}',
  source           TEXT NOT NULL DEFAULT '',  -- emitting module ('webmcp'|'integrations'|'automations'|...)
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','dismissed')),
  auto_resolved_at TEXT,                      -- set when autoResolve() cleared it (source condition ended)
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attention_open ON attention_items(status, severity, created_at);
`;

const M042_AUTOMATIONS_CORE = `
-- SPEC-D G5.1: automations engine. Rules are DETERMINISTIC data (§8 risk 11):
-- conditions_json is an op-whitelisted string-op list, actions_json carries
-- {{payload.*}} STRING templates — no eval anywhere, the LLM has no role.
-- run_tool actions on destructive-annotated tools require confirmDestructive
-- (422 at save, re-checked at fire time). Timestamps TEXT UTC ISO.
CREATE TABLE IF NOT EXISTS automation_rules (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  trigger_slug    TEXT NOT NULL DEFAULT 'system', -- connector slug, 'system', or '*'
  trigger_event   TEXT NOT NULL,             -- activity eventType (GMAIL_MESSAGE_RECEIVED) or bus event type (sync.failed)
  conditions_json TEXT NOT NULL DEFAULT '[]',-- [{ field, op, value }] — op whitelist in automations/types.ts
  actions_json    TEXT NOT NULL DEFAULT '[]',-- [{ kind: create_attention|create_task|notify|run_tool, ... }]
  is_active       INTEGER NOT NULL DEFAULT 1,
  last_fired_at   TEXT,
  fire_count      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id           TEXT PRIMARY KEY,
  rule_id      TEXT NOT NULL REFERENCES automation_rules(id),
  activity_id  TEXT,                         -- triggering activity, when the trigger was activity.created
  trigger_json TEXT NOT NULL DEFAULT '{}',   -- trigger payload snapshot at fire time
  status       TEXT NOT NULL CHECK (status IN ('ok','condition_miss','action_failed')),
  detail_json  TEXT,                         -- per-condition / per-action results
  error        TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_automation_runs_rule ON automation_runs(rule_id, created_at DESC);
`;

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "foundations_and_memory_graph",
    up: (db) => {
      db.exec(M001_FOUNDATIONS_AND_MEMORY);
      const nowIso = new Date().toISOString();
      const put = db.prepare(
        "INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)",
      );
      put.run("schema_version", "1");
      put.run("embed_model", DEFAULT_EMBED_MODEL);
      put.run("embed_dim", String(DEFAULT_EMBED_DIM));
      put.run("created_at", nowIso);
    },
  },
  {
    version: 2,
    name: "vector_namespaces",
    up: (db) => {
      const row = db
        .prepare("SELECT value FROM meta WHERE key = 'embed_dim'")
        .get() as { value: string } | undefined;
      const dim = row ? parseInt(row.value, 10) : DEFAULT_EMBED_DIM;
      db.exec(vecDDL(dim));
    },
  },
  {
    version: 20,
    name: "tasks_core",
    up: (db) => {
      db.exec(M020_TASKS_CORE);
      // Root display-id counter lives in the shared meta table (SPEC-B's
      // v2_meta is folded into meta; its timezone seed is void per CONVENTIONS §10).
      db.prepare("INSERT OR IGNORE INTO meta(key, value) VALUES ('task_root_counter', '0')").run();
    },
  },
  {
    version: 21,
    name: "pages_scratchpad",
    up: (db) => {
      db.exec(M021_PAGES_SCRATCHPAD);
    },
  },
  {
    version: 22,
    name: "skills_policies",
    up: (db) => {
      db.exec(M022_SKILLS_POLICIES);
      // ONE disabled example row (is_active=0 → never injected) so the /skills
      // page has a visible template on first open. Editable/archivable in-app.
      db.prepare(
        `INSERT OR IGNORE INTO v2_skills
           (id, title, description, policy_md, is_active, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, 0, ?, ?)`,
      ).run(
        "skill-example",
        "Example: response style",
        "A disabled sample policy — edit or archive it. Toggle Active to inject it.",
        "- Lead with the answer, then the reasoning.\n- Prefer bullet lists over long prose.\n- Never invent identifiers; quote them from real output.",
        new Date().toISOString(),
        new Date().toISOString(),
      );
    },
  },
  {
    version: 30,
    name: "webmcp_core",
    up: (db) => {
      db.exec(M030_WEBMCP_CORE);
    },
  },
  {
    version: 31,
    name: "jarvis_conversations",
    up: (db) => {
      db.exec(M031_JARVIS_CONVERSATIONS);
    },
  },
  {
    version: 32,
    name: "webmcp_spec",
    up: (db) => {
      // SPEC-C D3.2/D5: Spec-shaped package metadata (auth kind, schedule, mcp
      // type, config manifest — see webmcp/types.ts WebmcpSpec). NULL = no spec
      // authored yet. Validated on write via WebmcpSpecSchema (store.setPackageSpec).
      db.exec("ALTER TABLE webmcp_packages ADD COLUMN spec_json TEXT");
    },
  },
  {
    version: 33,
    name: "webmcp_approvals",
    up: (db) => {
      db.exec(M033_WEBMCP_APPROVALS);
      // C3.6: conversation DELETE is archive/exile semantics, never row
      // destruction (house rule) — archived_at NULL = live.
      db.exec("ALTER TABLE jarvis_conversations ADD COLUMN archived_at TEXT");
    },
  },
  {
    version: 40,
    name: "integrations_core",
    up: (db) => {
      db.exec(M040_INTEGRATIONS_CORE);
    },
  },
  {
    version: 41,
    name: "attention_core",
    up: (db) => {
      db.exec(M041_ATTENTION_CORE);
    },
  },
  {
    version: 42,
    name: "automations_core",
    up: (db) => {
      db.exec(M042_AUTOMATIONS_CORE);
    },
  },
];
