import { getDb, tx } from "../db";
import { uuid as newUuid, now } from "../ids";
import { emit } from "../events";
import { readSettings } from "../../settings";
import { modelCallText } from "./llm";
import { getEmbedding } from "./embed";
import { upsert as vectorUpsert } from "./vector";
import {
  compactionMessages,
  parseCompactionResponse,
  type CompactionEpisodeInput,
} from "./prompts/compaction";

/**
 * A5 — incremental session compaction. Port of
 * REF apps/webapp/app/jobs/session/session-compaction.logic.ts, Prisma
 * Document → our `documents` table (type='conversation', session_id UNIQUE),
 * vector store → the `compacted_session` sqlite-vec namespace that
 * exploratory / replaceWithCompacts / temporal_facets / doc-rerank already
 * consume (chunk-4 handoff shape).
 *
 * Trigger wiring (REF preprocess-episode.logic.ts): fired from queue.ts for
 * every CONVERSATION ingestion, in parallel with the ingest stages — safe
 * because episodes are saved to the graph FIRST (race-fix ordering).
 * REF CONFIG is 1/1: compaction runs after EVERY episode (the "after 3
 * exchanges" doc note does not match the shipped code; 1/1 is what REF runs).
 *
 * Watermarks:
 *  - FETCH watermark = documents.updated_at (REF getSessionEpisodes filters
 *    e.createdAt > existingCompact.updatedAt). created_at, not valid_at, so a
 *    late-arriving episode with a backdated referenceTime still gets folded in.
 *  - COVERAGE watermark = metadata.coveredUntil = max(valid_at) folded so far,
 *    MONOTONIC (never regresses even if an older episode arrives late) — REF
 *    upsertDocumentFromCompaction. Consumed downstream, never used for fetch.
 */

// REF session-compaction.logic.ts CONFIG — verbatim values.
export const COMPACTION_CONFIG = {
  minEpisodesForCompaction: 1, // Minimum episodes to trigger first compaction
  compactionThreshold: 1, // Trigger update after N new episodes
  maxEpisodesPerBatch: 50, // Declared upstream; not applied in the run path (REF parity)
};

export interface CompactionOutcome {
  success: boolean;
  reason?:
    | "disabled"
    | "insufficient_episodes"
    | "insufficient_new_episodes"
    | "non_conversation_document";
  documentId?: string;
  episodeCount?: number;
  kind?: "created" | "updated";
}

// ---------------------------------------------------------------------------
// Pure watermark math (exercised offline by smoke-compaction.mjs)
// ---------------------------------------------------------------------------

const ISO_RE = /^\d{4}-\d{2}-\d{2}T/;

/**
 * Monotonic coverage watermark: max(prior, max(batch valid_at)). All inputs
 * are UTC ISO-8601 strings, so lexical order == chronological order (repo
 * timestamp discipline). Malformed values are ignored; returns undefined when
 * nothing valid exists (REF: coveredUntil omitted from metadata in that case).
 */
export function computeCoveredUntil(
  episodeValidAts: string[],
  priorCoveredUntil?: string | null,
): string | undefined {
  let max: string | undefined;
  const consider = (v: string | null | undefined) => {
    if (typeof v === "string" && ISO_RE.test(v) && (!max || v > max)) max = v;
  };
  for (const v of episodeValidAts) consider(v);
  consider(priorCoveredUntil);
  return max;
}

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

interface DocumentRow {
  id: string;
  session_id: string | null;
  title: string;
  content: string;
  source: string | null;
  type: string;
  version: number;
  end_user_id: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

interface CompactionEpisodeRow {
  uuid: string;
  original_content: string;
  metadata: string;
  source: string;
  end_user_id: string | null;
  created_at: string;
  valid_at: string;
}

function getSessionDocument(sessionId: string): DocumentRow | undefined {
  return getDb()
    .prepare("SELECT * FROM documents WHERE session_id = ?")
    .get(sessionId) as DocumentRow | undefined;
}

/** Session episodes past the fetch watermark (REF getSessionEpisodes:
 *  `e.createdAt > $afterTime`, ORDER BY createdAt ASC). */
function getSessionEpisodesSince(
  sessionId: string,
  afterTime?: string,
): CompactionEpisodeRow[] {
  const db = getDb();
  if (afterTime) {
    return db
      .prepare(
        `SELECT uuid, original_content, metadata, source, end_user_id, created_at, valid_at
         FROM episodes WHERE session_id = ? AND created_at > ?
         ORDER BY created_at ASC`,
      )
      .all(sessionId, afterTime) as CompactionEpisodeRow[];
  }
  return db
    .prepare(
      `SELECT uuid, original_content, metadata, source, end_user_id, created_at, valid_at
       FROM episodes WHERE session_id = ?
       ORDER BY created_at ASC`,
    )
    .all(sessionId) as CompactionEpisodeRow[];
}

// ---------------------------------------------------------------------------
// Title ladder (REF getTitleForCompactedSession)
// Priority: ingestion-queue title → first episode metadata.title → summary
// prefix. (REF's step 3 — LLM title generation via processTitleGeneration —
// is a queue.ts TODO seam this repo hasn't built; the ladder falls through to
// the prefix fallback instead, per chunk-3 delta note.)
// ---------------------------------------------------------------------------

function titleForCompactedSession(
  sessionId: string,
  summary: string,
  episodes: CompactionEpisodeRow[],
): string {
  // 1. Title from the session's first ingestion-queue row
  const queueRow = getDb()
    .prepare(
      "SELECT title FROM ingestion_queue WHERE session_id = ? ORDER BY created_at ASC LIMIT 1",
    )
    .get(sessionId) as { title: string | null } | undefined;
  if (queueRow?.title && queueRow.title.trim()) return queueRow.title.trim();

  // 2. Title from first episode metadata
  try {
    const meta = JSON.parse(episodes[0]?.metadata ?? "{}") as Record<string, unknown>;
    const metadataTitle = meta?.title;
    if (typeof metadataTitle === "string" && metadataTitle.trim()) {
      return metadataTitle.trim();
    }
  } catch {
    /* malformed metadata — fall through */
  }

  // 3/4. Prefix of the summary (REF fallback string munging, verbatim)
  const cleanSummary = summary
    .replace(/<[^>]*>/g, "") // Strip HTML
    .replace(/#{1,6}\s+/g, "") // Strip markdown headings
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();
  const truncated = cleanSummary.substring(0, 50);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > 20) {
    return truncated.substring(0, lastSpace) + "...";
  }
  return truncated + (cleanSummary.length > 50 ? "..." : "");
}

// ---------------------------------------------------------------------------
// Document upsert (REF upsertDocumentFromCompaction)
// ---------------------------------------------------------------------------

function upsertDocumentFromCompaction(args: {
  sessionId: string;
  summary: string;
  source: string;
  episodes: CompactionEpisodeRow[];
  existing?: DocumentRow;
  priorCoveredUntil?: string | null;
}): { id: string; kind: "created" | "updated" } {
  const { sessionId, summary, source, episodes, existing } = args;

  // Labels from the first episode; every episode of a session shares the
  // same counterparty, so endUserId comes from the first one too (REF).
  const firstEpisode = episodes[0];
  const labelIds = firstEpisode
    ? (
        getDb()
          .prepare("SELECT label_id FROM episode_labels WHERE episode_uuid = ?")
          .all(firstEpisode.uuid) as { label_id: string }[]
      ).map((r) => r.label_id)
    : [];
  const endUserId = firstEpisode?.end_user_id ?? null;

  const title = titleForCompactedSession(sessionId, summary, episodes);

  const coveredUntil = computeCoveredUntil(
    episodes.map((e) => e.valid_at),
    args.priorCoveredUntil,
  );
  const metadata: Record<string, unknown> = {
    episodeCount: episodes.length,
    compactedAt: now(),
    ...(coveredUntil ? { coveredUntil } : {}),
  };

  const ts = now();
  const id = existing?.id ?? newUuid();
  tx((db) => {
    if (existing) {
      db.prepare(
        `UPDATE documents SET title = ?, content = ?, metadata = ?, end_user_id = ?,
                              version = version + 1, updated_at = ?
         WHERE id = ?`,
      ).run(title, summary, JSON.stringify(metadata), endUserId, ts, id);
    } else {
      db.prepare(
        `INSERT INTO documents (id, session_id, title, content, source, type, version,
                                end_user_id, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'conversation', 1, ?, ?, ?, ?)`,
      ).run(id, sessionId, title, summary, source, endUserId, JSON.stringify(metadata), ts, ts);
    }
    // Mirror the episode labels into document_labels (MERGE)
    const insert = db.prepare(
      "INSERT OR IGNORE INTO document_labels (document_id, label_id) VALUES (?, ?)",
    );
    for (const labelId of labelIds) insert.run(id, labelId);
  });

  return { id, kind: existing ? "updated" : "created" };
}

// ---------------------------------------------------------------------------
// compactSession — the A5 entry point
// ---------------------------------------------------------------------------

/**
 * Incrementally fold a session's un-compacted episodes into its conversation
 * Document (create on first). Returns an outcome and NEVER throws for the
 * expected skip cases; LLM/db failures do throw — queue.ts wraps this
 * non-fatally (label-stage pattern).
 */
export async function compactSession(sessionId: string): Promise<CompactionOutcome> {
  // settings.memory.compactionEnabled gate — skip silently with a debug log.
  if (readSettings().memory?.compactionEnabled === false) {
    console.debug(`[v2/memory/compaction] compaction disabled — skipping session ${sessionId}`);
    return { success: false, reason: "disabled" };
  }

  const existing = getSessionDocument(sessionId);

  // A session document that is not a conversation compact must never be
  // overwritten by compaction (REF preprocess type check).
  if (existing && existing.type !== "conversation") {
    return { success: false, reason: "non_conversation_document" };
  }

  const episodes = getSessionEpisodesSince(sessionId, existing?.updated_at);

  if (!existing && episodes.length < COMPACTION_CONFIG.minEpisodesForCompaction) {
    return {
      success: false,
      reason: "insufficient_episodes",
      episodeCount: episodes.length,
    };
  }
  if (existing && episodes.length < COMPACTION_CONFIG.compactionThreshold) {
    return {
      success: false,
      reason: "insufficient_new_episodes",
      episodeCount: episodes.length,
    };
  }

  // Generate (create) or merge (update) the summary — medium tier (REF).
  const episodeInputs: CompactionEpisodeInput[] = episodes.map((e) => ({
    validAt: e.valid_at,
    source: e.source,
    originalContent: e.original_content,
  }));
  const raw = await modelCallText(
    compactionMessages(episodeInputs, existing ? existing.content : null),
    "medium",
  );
  const { summary } = parseCompactionResponse(raw);

  // Carry the prior coverage watermark forward (monotonic across merges).
  let priorCoveredUntil: string | null = null;
  if (existing) {
    try {
      const meta = JSON.parse(existing.metadata) as Record<string, unknown>;
      if (typeof meta?.coveredUntil === "string") priorCoveredUntil = meta.coveredUntil;
    } catch {
      /* malformed metadata — treat as absent */
    }
  }

  const source = episodes[0]?.source ?? existing?.source ?? "unknown";
  const { id, kind } = upsertDocumentFromCompaction({
    sessionId,
    summary,
    source,
    episodes,
    existing,
    priorCoveredUntil,
  });

  // Embed the compact into the compacted_session namespace (exploratory +
  // replaceWithCompacts + doc-rerank consume it). Best-effort: an embed
  // outage degrades recall of this compact, it must not undo the compaction.
  try {
    const embedding = await getEmbedding(summary);
    vectorUpsert("compacted_session", id, embedding);
  } catch (err) {
    console.warn(
      `[v2/memory/compaction] could not embed compact ${id} (recall degraded until re-embed):`,
      err instanceof Error ? err.message : err,
    );
  }

  emit(
    "memory.compacted",
    { sessionId, documentId: id, episodeCount: episodes.length, kind },
    source,
  );

  return { success: true, documentId: id, episodeCount: episodes.length, kind };
}
