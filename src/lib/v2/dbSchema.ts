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
];
