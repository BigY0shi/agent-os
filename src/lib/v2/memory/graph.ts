import { getDb, tx } from "../db";
import { uuid as newUuid, now } from "../ids";
import { remove as removeVector } from "./vector";
import type {
  EntityNode,
  EntityType,
  EpisodeType,
  EpisodicNode,
  StatementAspect,
  StatementNode,
  VoiceAspect,
  VoiceAspectNode,
} from "./types";

/**
 * Node/edge CRUD over the Phase-0 SQLite schema (A1.2). Port of the semantics
 * in REF packages/providers/src/graph/neo4j/domains/{triple,entity,episode,
 * statement}.ts — every Cypher becomes SQL joins over the `edges` table.
 * Edge types: provenance episode→statement; subject/predicate/object
 * statement→entity. UNIQUE(type, from_uuid, to_uuid) gives MERGE semantics.
 *
 * Append-never-destroy: contradictions INVALIDATE (invalid_at + invalidated_by),
 * never delete. The two sanctioned deletes live here: a duplicate statement
 * whose provenance was first moved to the survivor, and orphaned entities.
 */

const DEFAULT_USER = "owner";

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

interface EpisodeRow {
  uuid: string;
  content: string;
  original_content: string;
  metadata: string;
  source: string;
  type: string;
  session_id: string;
  queue_id: string | null;
  chunk_index: number | null;
  total_chunks: number | null;
  version: number;
  content_hash: string | null;
  chunk_hashes: string | null;
  user_id: string;
  end_user_id: string | null;
  agent_id: string | null;
  recall_count: number;
  created_at: string;
  valid_at: string;
}

function episodeFromRow(r: EpisodeRow, labelIds: string[]): EpisodicNode {
  return {
    uuid: r.uuid,
    content: r.content,
    originalContent: r.original_content,
    metadata: parseJson<Record<string, unknown>>(r.metadata, {}),
    source: r.source,
    type: r.type as EpisodeType,
    sessionId: r.session_id,
    queueId: r.queue_id,
    chunkIndex: r.chunk_index,
    totalChunks: r.total_chunks,
    version: r.version,
    contentHash: r.content_hash,
    chunkHashes: parseJson<string[]>(r.chunk_hashes, []),
    userId: r.user_id,
    endUserId: r.end_user_id,
    agentId: r.agent_id,
    recallCount: r.recall_count,
    createdAt: r.created_at,
    validAt: r.valid_at,
    labelIds,
  };
}

interface EntityRow {
  uuid: string;
  name: string;
  type: string | null;
  attributes: string;
  user_id: string;
  created_at: string;
}

function entityFromRow(r: EntityRow): EntityNode {
  return {
    uuid: r.uuid,
    name: r.name,
    type: (r.type || null) as EntityType | null,
    attributes: parseJson<Record<string, unknown>>(r.attributes, {}),
    userId: r.user_id,
    createdAt: r.created_at,
  };
}

interface StatementRow {
  uuid: string;
  fact: string;
  aspect: string;
  attributes: string;
  user_id: string;
  created_at: string;
  valid_at: string;
  invalid_at: string | null;
  invalidated_by: string | null;
}

function statementFromRow(r: StatementRow): StatementNode {
  return {
    uuid: r.uuid,
    fact: r.fact,
    aspect: (r.aspect || null) as StatementAspect | null,
    attributes: parseJson<Record<string, unknown>>(r.attributes, {}),
    userId: r.user_id,
    createdAt: r.created_at,
    validAt: r.valid_at,
    invalidAt: r.invalid_at,
    invalidatedBy: r.invalidated_by,
  };
}

interface VoiceRow {
  uuid: string;
  fact: string;
  aspect: string;
  episode_uuids: string;
  user_id: string;
  created_at: string;
  valid_at: string;
  invalid_at: string | null;
  invalidated_by: string | null;
}

function voiceFromRow(r: VoiceRow): VoiceAspectNode {
  return {
    uuid: r.uuid,
    fact: r.fact,
    aspect: r.aspect as VoiceAspect,
    episodeUuids: parseJson<string[]>(r.episode_uuids, []),
    userId: r.user_id,
    createdAt: r.created_at,
    validAt: r.valid_at,
    invalidAt: r.invalid_at,
    invalidatedBy: r.invalidated_by,
  };
}

/** Reads exclude invalidated statements unless the caller opts in (SPEC-A A1.2). */
function currentFilter(alias: string, includeInvalidated?: boolean): string {
  if (includeInvalidated) return "1=1";
  return `(${alias}.invalid_at IS NULL OR ${alias}.invalid_at > :nowTs)`;
}

function labelIdsFor(episodeUuid: string): string[] {
  return (
    getDb()
      .prepare("SELECT label_id FROM episode_labels WHERE episode_uuid = ?")
      .all(episodeUuid) as { label_id: string }[]
  ).map((r) => r.label_id);
}

// ---------------------------------------------------------------------------
// Episodes
// ---------------------------------------------------------------------------

export interface SaveEpisodeInput {
  uuid?: string;
  content: string;
  originalContent: string;
  metadata?: Record<string, unknown>;
  source: string;
  type?: string;
  sessionId: string;
  queueId?: string | null;
  chunkIndex?: number | null;
  totalChunks?: number | null;
  version?: number;
  contentHash?: string | null;
  chunkHashes?: string[] | null;
  userId?: string;
  endUserId?: string | null;
  agentId?: string | null;
  validAt?: string;
}

/** MERGE by uuid (REF episode.ts saveEpisode). original_content and created_at
 *  are write-once — verbatim, never mutated on re-save. Returns the uuid. */
export function saveEpisode(ep: SaveEpisodeInput): string {
  const id = ep.uuid || newUuid();
  const ts = now();
  tx((db) => {
    db.prepare(
      `INSERT INTO episodes (
         uuid, content, original_content, metadata, source, type, session_id,
         queue_id, chunk_index, total_chunks, version, content_hash, chunk_hashes,
         user_id, end_user_id, agent_id, created_at, valid_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(uuid) DO UPDATE SET
         content = excluded.content,
         metadata = excluded.metadata,
         source = excluded.source,
         type = excluded.type,
         session_id = excluded.session_id,
         queue_id = excluded.queue_id,
         chunk_index = excluded.chunk_index,
         total_chunks = excluded.total_chunks,
         version = excluded.version,
         content_hash = excluded.content_hash,
         chunk_hashes = excluded.chunk_hashes,
         end_user_id = excluded.end_user_id,
         agent_id = excluded.agent_id,
         valid_at = excluded.valid_at`,
    ).run(
      id,
      ep.content,
      ep.originalContent,
      JSON.stringify(ep.metadata ?? {}),
      ep.source,
      ep.type ?? "CONVERSATION",
      ep.sessionId,
      ep.queueId ?? null,
      ep.chunkIndex ?? null,
      ep.totalChunks ?? null,
      ep.version ?? 1,
      ep.contentHash ?? null,
      ep.chunkHashes ? JSON.stringify(ep.chunkHashes) : null,
      ep.userId ?? DEFAULT_USER,
      ep.endUserId ?? null,
      ep.agentId ?? null,
      ts,
      ep.validAt ?? ts,
    );
  });
  return id;
}

export function getEpisode(uuid: string): EpisodicNode | null {
  const row = getDb()
    .prepare("SELECT * FROM episodes WHERE uuid = ?")
    .get(uuid) as EpisodeRow | undefined;
  if (!row) return null;
  return episodeFromRow(row, labelIdsFor(row.uuid));
}

export function getEpisodes(uuids: string[]): EpisodicNode[] {
  if (uuids.length === 0) return [];
  const placeholders = uuids.map(() => "?").join(",");
  const rows = getDb()
    .prepare(`SELECT * FROM episodes WHERE uuid IN (${placeholders})`)
    .all(...uuids) as EpisodeRow[];
  return rows.map((r) => episodeFromRow(r, labelIdsFor(r.uuid)));
}

/** Most-recent-first session context window (REF getRecentEpisodes ORDER BY
 *  validAt DESC; default limit 5 = DEFAULT_EPISODE_WINDOW). */
export function getSessionEpisodes(sessionId: string, limit = 5): EpisodicNode[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM episodes WHERE session_id = ? ORDER BY valid_at DESC LIMIT ?",
    )
    .all(sessionId, limit) as EpisodeRow[];
  return rows.map((r) => episodeFromRow(r, labelIdsFor(r.uuid)));
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface SaveEntityInput {
  uuid?: string;
  name: string;
  type?: EntityType | string | null;
  attributes?: Record<string, unknown>;
  userId?: string;
}

/** MERGE by uuid (REF entity.ts saveEntity — name/type/attributes refresh). */
export function saveEntity(entity: SaveEntityInput): string {
  const id = entity.uuid || newUuid();
  tx((db) => {
    db.prepare(
      `INSERT INTO entities (uuid, name, type, attributes, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(uuid) DO UPDATE SET
         name = excluded.name,
         type = excluded.type,
         attributes = excluded.attributes`,
    ).run(
      id,
      entity.name,
      entity.type ?? null,
      JSON.stringify(entity.attributes ?? {}),
      entity.userId ?? DEFAULT_USER,
      now(),
    );
  });
  return id;
}

export function getEntity(uuid: string): EntityNode | null {
  const row = getDb()
    .prepare("SELECT * FROM entities WHERE uuid = ?")
    .get(uuid) as EntityRow | undefined;
  return row ? entityFromRow(row) : null;
}

export function getEntities(uuids: string[]): EntityNode[] {
  if (uuids.length === 0) return [];
  const placeholders = uuids.map(() => "?").join(",");
  const rows = getDb()
    .prepare(`SELECT * FROM entities WHERE uuid IN (${placeholders})`)
    .all(...uuids) as EntityRow[];
  return rows.map(entityFromRow);
}

/** Case-insensitive exact-name match (REF findExactEntityMatch toLower =).
 *  Optional type narrows the match (REF findExactPredicateMatches pattern). */
export function findEntityByName(
  name: string,
  type?: EntityType | string,
): EntityNode | null {
  const db = getDb();
  const row = (
    type
      ? db
          .prepare(
            "SELECT * FROM entities WHERE name = ? COLLATE NOCASE AND type = ? LIMIT 1",
          )
          .get(name, type)
      : db
          .prepare("SELECT * FROM entities WHERE name = ? COLLATE NOCASE LIMIT 1")
          .get(name)
  ) as EntityRow | undefined;
  return row ? entityFromRow(row) : null;
}

/** Entities with zero edges: remove the row AND its entity-namespace vector.
 *  One of the two sanctioned deletes (REF deleteOrphanedEntities). */
export function orphanEntityCleanup(): { count: number; deletedUuids: string[] } {
  const deletedUuids = tx((db) => {
    const orphans = (
      db
        .prepare(
          `SELECT e.uuid FROM entities e
           WHERE NOT EXISTS (SELECT 1 FROM edges WHERE edges.to_uuid = e.uuid)`,
        )
        .all() as { uuid: string }[]
    ).map((r) => r.uuid);
    const del = db.prepare("DELETE FROM entities WHERE uuid = ?");
    for (const id of orphans) del.run(id);
    return orphans;
  });
  for (const id of deletedUuids) removeVector("entity", id);
  return { count: deletedUuids.length, deletedUuids };
}

// ---------------------------------------------------------------------------
// Triples / provenance
// ---------------------------------------------------------------------------

export interface SaveTripleInput {
  statement: {
    uuid?: string;
    fact: string;
    aspect: StatementAspect | string;
    attributes?: Record<string, unknown>;
    validAt?: string;
    userId?: string;
  };
  subjectUuid: string;
  predicateUuid?: string;
  objectUuid?: string;
  episodeUuid: string;
}

/** Statement row + subject/predicate/object edges + provenance edge, one tx
 *  (REF triple.ts saveTriple). INSERT OR IGNORE on edges = Cypher MERGE. */
export function saveTriple(input: SaveTripleInput): string {
  const stmtUuid = input.statement.uuid || newUuid();
  const ts = now();
  tx((db) => {
    db.prepare(
      `INSERT INTO statements (uuid, fact, aspect, attributes, user_id, created_at, valid_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(uuid) DO UPDATE SET
         fact = excluded.fact,
         aspect = excluded.aspect,
         attributes = excluded.attributes,
         valid_at = excluded.valid_at`,
    ).run(
      stmtUuid,
      input.statement.fact,
      input.statement.aspect,
      JSON.stringify(input.statement.attributes ?? {}),
      input.statement.userId ?? DEFAULT_USER,
      ts,
      input.statement.validAt ?? ts,
    );
    const edge = db.prepare(
      "INSERT OR IGNORE INTO edges (type, from_uuid, to_uuid, created_at) VALUES (?, ?, ?, ?)",
    );
    edge.run("subject", stmtUuid, input.subjectUuid, ts);
    if (input.predicateUuid) edge.run("predicate", stmtUuid, input.predicateUuid, ts);
    if (input.objectUuid) edge.run("object", stmtUuid, input.objectUuid, ts);
    edge.run("provenance", input.episodeUuid, stmtUuid, ts);
  });
  return stmtUuid;
}

/** MERGE one provenance edge (REF linkEpisodeToStatement). */
export function linkEpisodeToStatement(episodeUuid: string, statementUuid: string): void {
  tx((db) => {
    db.prepare(
      "INSERT OR IGNORE INTO edges (type, from_uuid, to_uuid, created_at) VALUES ('provenance', ?, ?, ?)",
    ).run(episodeUuid, statementUuid, now());
  });
}

/** Re-point ALL provenance edges from a duplicate statement to the survivor
 *  (REF moveProvenanceToStatement). Returns the number of episodes moved. */
export function moveAllProvenanceToStatement(
  fromStatementUuid: string,
  toStatementUuid: string,
): number {
  return tx((db) => {
    const episodes = (
      db
        .prepare(
          "SELECT from_uuid FROM edges WHERE type = 'provenance' AND to_uuid = ?",
        )
        .all(fromStatementUuid) as { from_uuid: string }[]
    ).map((r) => r.from_uuid);
    const ts = now();
    const insert = db.prepare(
      "INSERT OR IGNORE INTO edges (type, from_uuid, to_uuid, created_at) VALUES ('provenance', ?, ?, ?)",
    );
    for (const ep of episodes) insert.run(ep, toStatementUuid, ts);
    db.prepare("DELETE FROM edges WHERE type = 'provenance' AND to_uuid = ?").run(
      fromStatementUuid,
    );
    return episodes.length;
  });
}

/** Delete a duplicate statement — ONLY legal after its provenance was moved to
 *  the survivor (throws otherwise). Removes SPO edges, the row, and its
 *  statement-namespace vector. The other sanctioned delete. */
export function deleteStatementAsDuplicate(statementUuid: string): void {
  tx((db) => {
    const prov = db
      .prepare(
        "SELECT COUNT(*) AS c FROM edges WHERE type = 'provenance' AND to_uuid = ?",
      )
      .get(statementUuid) as { c: number };
    if (prov.c > 0) {
      throw new Error(
        `deleteStatementAsDuplicate(${statementUuid}): ${prov.c} provenance edge(s) still attached — call moveAllProvenanceToStatement first`,
      );
    }
    db.prepare(
      "DELETE FROM edges WHERE from_uuid = ? AND type IN ('subject','predicate','object')",
    ).run(statementUuid);
    db.prepare("DELETE FROM statements WHERE uuid = ?").run(statementUuid);
  });
  removeVector("statement", statementUuid);
}

// ---------------------------------------------------------------------------
// Statement reads
// ---------------------------------------------------------------------------

export interface StatementReadOpts {
  includeInvalidated?: boolean;
}

export function getStatement(
  uuid: string,
  opts: StatementReadOpts = {},
): StatementNode | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM statements s WHERE s.uuid = :uuid AND ${currentFilter("s", opts.includeInvalidated)}`,
    )
    .get({ uuid, nowTs: now() }) as StatementRow | undefined;
  return row ? statementFromRow(row) : null;
}

export function getStatements(
  uuids: string[],
  opts: StatementReadOpts = {},
): StatementNode[] {
  if (uuids.length === 0) return [];
  const placeholders = uuids.map((_, i) => `:u${i}`).join(",");
  const params: Record<string, string> = { nowTs: now() };
  uuids.forEach((u, i) => (params[`u${i}`] = u));
  const rows = getDb()
    .prepare(
      `SELECT * FROM statements s WHERE s.uuid IN (${placeholders})
       AND ${currentFilter("s", opts.includeInvalidated)}`,
    )
    .all(params) as StatementRow[];
  return rows.map(statementFromRow);
}

/** Statements sourced from an episode, via provenance edges. */
export function getStatementsForEpisode(
  episodeUuid: string,
  opts: StatementReadOpts = {},
): StatementNode[] {
  const rows = getDb()
    .prepare(
      `SELECT s.* FROM edges e
       JOIN statements s ON s.uuid = e.to_uuid
       WHERE e.type = 'provenance' AND e.from_uuid = :episodeUuid
       AND ${currentFilter("s", opts.includeInvalidated)}`,
    )
    .all({ episodeUuid, nowTs: now() }) as StatementRow[];
  return rows.map(statementFromRow);
}

/** Statements touching an entity as subject or object (REF entity-facts path). */
export function getStatementsForEntity(
  entityUuid: string,
  opts: StatementReadOpts = {},
): StatementNode[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT s.* FROM edges e
       JOIN statements s ON s.uuid = e.from_uuid
       WHERE e.type IN ('subject','object') AND e.to_uuid = :entityUuid
       AND ${currentFilter("s", opts.includeInvalidated)}`,
    )
    .all({ entityUuid, nowTs: now() }) as StatementRow[];
  return rows.map(statementFromRow);
}

/** Provenance episodes for a statement (both directions of the edge walk). */
export function getEpisodeUuidsForStatement(statementUuid: string): string[] {
  return (
    getDb()
      .prepare(
        "SELECT from_uuid FROM edges WHERE type = 'provenance' AND to_uuid = ?",
      )
      .all(statementUuid) as { from_uuid: string }[]
  ).map((r) => r.from_uuid);
}

/** Invalidated facts sourced from these episodes, for the formatter's
 *  "Invalidated Facts" section (REF episode.ts getEpisodesInvalidFacts:
 *  provenance-linked statements with invalid_at NOT NULL). */
export function getEpisodesInvalidFacts(
  episodeUuids: string[],
): { statementUuid: string; fact: string; validAt: string; invalidAt: string }[] {
  if (episodeUuids.length === 0) return [];
  const placeholders = episodeUuids.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT s.uuid AS statementUuid, s.fact AS fact,
              s.valid_at AS validAt, s.invalid_at AS invalidAt
       FROM edges e
       JOIN statements s ON s.uuid = e.to_uuid
       WHERE e.type = 'provenance' AND e.from_uuid IN (${placeholders})
         AND s.invalid_at IS NOT NULL`,
    )
    .all(...episodeUuids) as {
    statementUuid: string;
    fact: string;
    validAt: string;
    invalidAt: string;
  }[];
  return rows;
}

// ---------------------------------------------------------------------------
// Invalidation (temporal chains — NEVER delete on contradiction)
// ---------------------------------------------------------------------------

/** Sets invalid_at + invalidated_by on still-valid statements (REF
 *  invalidateStatement / invalidateStatementsFromPreviousVersion filters
 *  invalidAt IS NULL — first invalidation wins). Returns rows updated. */
export function invalidateStatements(
  uuids: string[],
  invalidatedByEpisodeUuid: string,
): number {
  if (uuids.length === 0) return 0;
  return tx((db) => {
    const placeholders = uuids.map(() => "?").join(",");
    const info = db
      .prepare(
        `UPDATE statements SET invalid_at = ?, invalidated_by = ?
         WHERE uuid IN (${placeholders}) AND invalid_at IS NULL`,
      )
      .run(now(), invalidatedByEpisodeUuid, ...uuids);
    return info.changes;
  });
}

/** Same chain semantics for voice aspects (REF invalidateVoiceAspect). */
export function invalidateVoiceAspects(uuids: string[], episodeUuid: string): number {
  if (uuids.length === 0) return 0;
  return tx((db) => {
    const placeholders = uuids.map(() => "?").join(",");
    const info = db
      .prepare(
        `UPDATE voice_aspects SET invalid_at = ?, invalidated_by = ?
         WHERE uuid IN (${placeholders}) AND invalid_at IS NULL`,
      )
      .run(now(), episodeUuid, ...uuids);
    return info.changes;
  });
}

// ---------------------------------------------------------------------------
// Voice aspects (stored WHOLE, never SPO)
// ---------------------------------------------------------------------------

export interface SaveVoiceAspectInput {
  uuid?: string;
  fact: string;
  aspect: VoiceAspect | string;
  episodeUuid: string;
  userId?: string;
  validAt?: string;
}

/** New voice aspect with episode_uuids = [episodeUuid] (REF saveVoiceAspects). */
export function saveVoiceAspect(input: SaveVoiceAspectInput): string {
  const id = input.uuid || newUuid();
  const ts = now();
  tx((db) => {
    db.prepare(
      `INSERT INTO voice_aspects (uuid, fact, aspect, episode_uuids, user_id, created_at, valid_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.fact,
      input.aspect,
      JSON.stringify([input.episodeUuid]),
      input.userId ?? DEFAULT_USER,
      ts,
      input.validAt ?? ts,
    );
  });
  return id;
}

export function getVoiceAspect(uuid: string): VoiceAspectNode | null {
  const row = getDb()
    .prepare("SELECT * FROM voice_aspects WHERE uuid = ?")
    .get(uuid) as VoiceRow | undefined;
  return row ? voiceFromRow(row) : null;
}

/** Duplicate path: append the episode to the survivor's episode_uuids JSON
 *  list, deduped (REF appendEpisodeToVoiceAspect). */
export function appendVoiceAspectEpisode(uuid: string, episodeUuid: string): void {
  tx((db) => {
    const row = db
      .prepare("SELECT episode_uuids FROM voice_aspects WHERE uuid = ?")
      .get(uuid) as { episode_uuids: string } | undefined;
    if (!row) throw new Error(`appendVoiceAspectEpisode: voice aspect ${uuid} not found`);
    const list = parseJson<string[]>(row.episode_uuids, []);
    if (list.includes(episodeUuid)) return;
    list.push(episodeUuid);
    db.prepare("UPDATE voice_aspects SET episode_uuids = ? WHERE uuid = ?").run(
      JSON.stringify(list),
      uuid,
    );
  });
}
