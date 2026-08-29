import { z } from "zod";
import { getDb } from "../db";
import { uuid as newUuid, now } from "../ids";
import { emit } from "../events";
import { readSettings } from "../../settings";
import { chunkEpisode } from "./chunker";
import { saveEpisode } from "./graph";
import { addEpisode } from "./ingest";
import { processGraphResolution } from "./resolution";
import { addEpisodeLabels, assignLabels, resolveLabelNames } from "./labels";
import { compactSession } from "./compaction";
import { personaTrigger } from "./persona";
import type { AddEpisodeResult } from "./types";

/**
 * A2.4 — in-process job-chain runner over the ingestion_queue table.
 * Replaces REF's BullMQ/Trigger.dev fan-out (addToQueue → preprocess-episode →
 * ingest-episode → graph-resolution → label-assignment) with a single
 * concurrency-1 chain per queue row, statuses/stages written to the row.
 *
 * CRITICAL ordering kept from REF preprocess-episode.logic.ts: episodes are
 * saved to the graph BEFORE the ingest stage runs (compaction race fix).
 *
 * Stage chain per row: 'preprocess' → ('compaction' kicked in parallel) →
 * 'ingest' → 'resolution' → 'labels' → 'compaction' (settle) → COMPLETED →
 * 'persona' (post-COMPLETED trigger). Compaction and persona failures are
 * non-fatal (warn, row stays COMPLETED) — REF label/title-job pattern.
 *
 * The worker NEVER throws: failures land as status FAILED + error + a
 * 'memory.queue.failed' event. settings.memory.ingestEnabled=false is the
 * master kill-switch — rows stay PENDING untouched.
 */

// ---------------------------------------------------------------------------
// Ingest body (REF IngestBodyRequest, minus versioning/diff fields for now)
// ---------------------------------------------------------------------------

export const IngestBodySchema = z.object({
  episodeBody: z.string().min(20),
  referenceTime: z.string().optional(), // ISO; defaults to now
  metadata: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
  source: z.string().min(1),
  labelIds: z.array(z.string()).optional(),
  endUserId: z.string().optional(),
  agentId: z.string().optional(),
  sessionId: z.string().min(1),
  type: z.enum(["CONVERSATION", "DOCUMENT"]).default("CONVERSATION"),
  title: z.string().optional(),
});

export type IngestBody = z.input<typeof IngestBodySchema>;
type ParsedIngestBody = z.output<typeof IngestBodySchema>;

interface QueueRow {
  id: string;
  data: string;
  status: string;
  stage: string | null;
  source: string;
  title: string | null;
  session_id: string | null;
  label_ids: string;
  retry_count: number;
}

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

/**
 * Validate + insert a PENDING ingestion_queue row and kick the worker
 * (REF lib/ingest.server.ts addToQueue, credits stripped). Returns {queueId}.
 */
export function addToQueue(rawBody: IngestBody): { queueId: string } {
  const parsed = IngestBodySchema.parse(rawBody);
  const body: ParsedIngestBody = {
    ...parsed,
    source: parsed.source.toLowerCase(), // REF normalizes source casing
    referenceTime: parsed.referenceTime || now(),
  };

  const db = getDb();

  // Filter provided labelIds to rows that actually exist (REF validation)
  let labelIds: string[] = [];
  if (body.labelIds && body.labelIds.length > 0) {
    const placeholders = body.labelIds.map(() => "?").join(",");
    labelIds = (
      db.prepare(`SELECT id FROM labels WHERE id IN (${placeholders})`).all(...body.labelIds) as {
        id: string;
      }[]
    ).map((r) => r.id);
  }

  // Inherit the session's labels from its most recent queue row (REF behavior)
  let title = body.title;
  const lastEpisode = db
    .prepare(
      "SELECT label_ids, title FROM ingestion_queue WHERE session_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(body.sessionId) as { label_ids: string; title: string | null } | undefined;
  if (lastEpisode) {
    try {
      const inherited = JSON.parse(lastEpisode.label_ids) as string[];
      if (Array.isArray(inherited) && inherited.length > 0) {
        labelIds = Array.from(new Set([...inherited, ...labelIds]));
      }
    } catch {
      /* ignore malformed */
    }
    if (body.type === "DOCUMENT" && !title && lastEpisode.title) title = lastEpisode.title;
  }

  const queueId = newUuid();
  db.prepare(
    `INSERT INTO ingestion_queue (id, data, status, priority, source, title, session_id, label_ids, created_at)
     VALUES (?, ?, 'PENDING', 0, ?, ?, ?, ?, ?)`,
  ).run(
    queueId,
    JSON.stringify({ ...body, labelIds }),
    body.source,
    title ?? null,
    body.sessionId,
    JSON.stringify(labelIds),
    now(),
  );

  ensureMemoryQueue();
  scheduleDrain();
  return { queueId };
}

// ---------------------------------------------------------------------------
// CONVENTIONS §4 seam — the one cross-module ingest wrapper
// ---------------------------------------------------------------------------

export interface IngestFromModuleInput {
  episodeBody: string;
  source: string; // e.g. 'anynotes', 'integration:notion', 'task'
  sourceURL?: string; // stored in metadata
  sessionId?: string; // default: `${source}-${YYYY-MM-DD}` bucket
  labelNames?: string[]; // NAMES, resolved/created via the labels.ts ladder
  endUserId?: string;
  agentId?: string;
  referenceTime?: string; // ISO; defaults to now (backdated module imports)
  metadata?: Record<string, string | number | boolean>;
}

export async function ingestFromModule(
  input: IngestFromModuleInput,
): Promise<{ queueId: string }> {
  const day = now().slice(0, 10); // YYYY-MM-DD (UTC)
  const sessionId = input.sessionId || `${input.source}-${day}`;

  const metadata: Record<string, string | number | boolean> = { ...(input.metadata ?? {}) };
  if (input.sourceURL) metadata.sourceURL = input.sourceURL;

  const labelIds = input.labelNames?.length
    ? await resolveLabelNames(input.labelNames)
    : undefined;

  return addToQueue({
    episodeBody: input.episodeBody,
    source: input.source,
    sessionId,
    labelIds,
    endUserId: input.endUserId,
    agentId: input.agentId,
    referenceTime: input.referenceTime,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  });
}

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;

/** Reset a FAILED row to PENDING (retry_count + 1, capped at 3) and kick. */
export function retryQueueItem(queueId: string): { queueId: string; retryCount: number } {
  const db = getDb();
  const row = db
    .prepare("SELECT id, status, retry_count FROM ingestion_queue WHERE id = ?")
    .get(queueId) as { id: string; status: string; retry_count: number } | undefined;
  if (!row) throw new Error(`ingestion queue ${queueId} not found`);
  if (row.status !== "FAILED") {
    throw new Error(`ingestion queue ${queueId} is ${row.status} — only FAILED rows can be retried`);
  }
  if (row.retry_count >= MAX_RETRIES) {
    throw new Error(`ingestion queue ${queueId} exhausted its ${MAX_RETRIES} retries`);
  }
  db.prepare(
    "UPDATE ingestion_queue SET status = 'PENDING', error = NULL, retry_count = retry_count + 1 WHERE id = ?",
  ).run(queueId);
  ensureMemoryQueue();
  scheduleDrain();
  return { queueId, retryCount: row.retry_count + 1 };
}

// ---------------------------------------------------------------------------
// Worker (globalThis singleton, concurrency 1, 5s poll — no fs.watch)
// ---------------------------------------------------------------------------

interface MemQueueState {
  timer: ReturnType<typeof setInterval> | null;
  draining: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __agentosMemQueue: MemQueueState | undefined;
}

function state(): MemQueueState {
  if (!globalThis.__agentosMemQueue) {
    globalThis.__agentosMemQueue = { timer: null, draining: false };
  }
  return globalThis.__agentosMemQueue;
}

const POLL_MS = 5000;

/** Idempotent worker boot (called from instrumentation and on every enqueue). */
export function ensureMemoryQueue(): void {
  const s = state();
  if (s.timer) return;
  // Item 9 boot recovery: rescue rows a crashed process left PROCESSING.
  try {
    recoverStaleProcessing();
  } catch (err) {
    console.error("[v2/memory/queue] boot recovery failed:", err);
  }
  s.timer = setInterval(() => {
    void drain();
  }, POLL_MS);
  // Don't hold the process open just for the poller (smoke scripts, CLIs)
  if (typeof s.timer === "object" && "unref" in s.timer) s.timer.unref();
}

/** Test/shutdown helper: stop the poll loop. */
export function stopMemoryQueue(): void {
  const s = state();
  if (s.timer) {
    clearInterval(s.timer);
    s.timer = null;
  }
}

function scheduleDrain(): void {
  // Immediate async kick after enqueue — the interval is just the safety net.
  void Promise.resolve().then(() => drain());
}

function ingestEnabled(): boolean {
  return readSettings().memory?.ingestEnabled !== false;
}

/**
 * ATOMIC claim (HARDENING-2026-08-27 item 9): pick the oldest PENDING row,
 * then flip it to PROCESSING guarded by `WHERE status = 'PENDING'` — only ONE
 * claimant wins (changes === 1); losers loop to the next candidate. The
 * processing_started_at lease lets recoverStaleProcessing() rescue rows a
 * crashed process stranded.
 */
export function claimNextPending(): QueueRow | undefined {
  const db = getDb();
  for (let i = 0; i < 10; i++) {
    const row = db
      .prepare(
        "SELECT * FROM ingestion_queue WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT 1",
      )
      .get() as QueueRow | undefined;
    if (!row) return undefined;
    const claimed = db
      .prepare(
        `UPDATE ingestion_queue
         SET status = 'PROCESSING', error = NULL, processing_started_at = ?
         WHERE id = ? AND status = 'PENDING'`,
      )
      .run(now(), row.id);
    if (claimed.changes === 1) return row;
    // Lost the race for this row — try the next candidate.
  }
  return undefined;
}

/** Lease timeout: PROCESSING older than this is presumed crashed. */
export const PROCESSING_STALE_MS = 10 * 60 * 1000;

/**
 * Boot/periodic recovery (item 9): PROCESSING rows whose lease expired (or
 * that predate the lease column — processing_started_at NULL) go back to
 * PENDING with retry_count+1; rows already at the retry cap go to FAILED
 * (loud, retryable via the UI's retry path… which enforces the same cap).
 */
export function recoverStaleProcessing(): number {
  const db = getDb();
  const cutoff = new Date(Date.now() - PROCESSING_STALE_MS).toISOString();
  const failed = db
    .prepare(
      `UPDATE ingestion_queue
       SET status = 'FAILED', error = 'stale PROCESSING recovered at retry cap (crash mid-ingest)', processed_at = ?
       WHERE status = 'PROCESSING'
         AND (processing_started_at IS NULL OR processing_started_at < ?)
         AND retry_count >= ${MAX_RETRIES}`,
    )
    .run(now(), cutoff);
  const recovered = db
    .prepare(
      `UPDATE ingestion_queue
       SET status = 'PENDING', retry_count = retry_count + 1, processing_started_at = NULL
       WHERE status = 'PROCESSING'
         AND (processing_started_at IS NULL OR processing_started_at < ?)`,
    )
    .run(cutoff);
  const total = failed.changes + recovered.changes;
  if (total > 0) {
    console.warn(
      `[v2/memory/queue] recovered ${recovered.changes} stale PROCESSING row(s) to PENDING` +
        (failed.changes ? `, ${failed.changes} to FAILED (retry cap)` : ""),
    );
  }
  return total;
}

/** Drain PENDING rows oldest-first, one at a time. Never throws. */
async function drain(): Promise<number> {
  const s = state();
  if (s.draining) return 0;
  s.draining = true;
  let processed = 0;
  try {
    recoverStaleProcessing(); // cheap: touches PROCESSING rows only (item 9)
    while (ingestEnabled()) {
      const row = claimNextPending();
      if (!row) break;
      await processQueueItem(row);
      processed++;
    }
  } catch (err) {
    // processQueueItem handles its own failures — this catches infra errors
    console.error("[v2/memory/queue] drain error:", err);
  } finally {
    s.draining = false;
  }
  return processed;
}

/** Deterministic drain for smoke scripts: process everything now, return count. */
export async function drainMemoryQueueOnce(): Promise<number> {
  return drain();
}

// ---------------------------------------------------------------------------
// Pipeline per queue row
// ---------------------------------------------------------------------------

function setStage(queueId: string, stage: string): void {
  getDb().prepare("UPDATE ingestion_queue SET stage = ? WHERE id = ?").run(stage, queueId);
}

async function processQueueItem(row: QueueRow): Promise<void> {
  const db = getDb();
  // Row was already flipped to PROCESSING (+ lease stamp) by claimNextPending
  // — no second UPDATE here (item 9: the claim is the single writer).

  try {
    const body = IngestBodySchema.parse(JSON.parse(row.data)) as ParsedIngestBody & {
      labelIds?: string[];
    };
    const referenceTime = body.referenceTime || now();

    // ---- Stage 1: preprocess — chunk + save episodes to the graph FIRST ----
    setStage(row.id, "preprocess");
    const chunked = chunkEpisode(body.episodeBody);
    const chunkEpisodes: Array<{ episodeUuid: string; chunkIndex: number; content: string }> = [];
    for (const chunk of chunked.chunks) {
      const isFirstChunk = chunk.chunkIndex === 0;
      const episodeUuid = saveEpisode({
        content: chunk.content, // updated with normalized content during ingest
        originalContent: chunk.content,
        metadata: body.metadata ?? {},
        source: body.source,
        type: body.type,
        sessionId: body.sessionId,
        queueId: row.id,
        chunkIndex: chunk.chunkIndex,
        totalChunks: chunked.totalChunks,
        contentHash: chunked.contentHash,
        chunkHashes: isFirstChunk ? chunked.chunkHashes : null,
        endUserId: body.endUserId ?? null,
        agentId: body.agentId ?? null,
        validAt: referenceTime,
      });
      if (body.labelIds?.length) addEpisodeLabels(episodeUuid, body.labelIds);
      chunkEpisodes.push({ episodeUuid, chunkIndex: chunk.chunkIndex, content: chunk.content });
    }
    // ---- A5 seam: session compaction, kicked in PARALLEL with ingest ----
    // (REF preprocess-episode.logic.ts enqueueSessionCompaction — conversations
    // only; safe because the episodes were just saved to the graph above.)
    // The promise is settled after the labels stage so the drain stays
    // deterministic for smoke scripts; failures never fail the queue row.
    let compactionPromise: Promise<void> | null = null;
    if (body.type === "CONVERSATION") {
      compactionPromise = compactSession(body.sessionId)
        .then(() => undefined)
        .catch((err) => {
          console.warn(
            `[v2/memory/queue] session compaction failed for ${body.sessionId} (non-blocking):`,
            err instanceof Error ? err.message : err,
          );
        });
    }

    // ---- Stage 2: ingest — normalize/extract/reflect/classify per chunk ----
    setStage(row.id, "ingest");
    const results: AddEpisodeResult[] = [];
    for (const chunk of chunkEpisodes) {
      const result = await addEpisode({
        episodeBody: chunk.content,
        originalEpisodeBody: body.episodeBody,
        referenceTime,
        metadata: body.metadata,
        source: body.source,
        userId: "owner",
        labelIds: body.labelIds,
        sessionId: body.sessionId,
        queueId: row.id,
        type: body.type,
        endUserId: body.endUserId,
        agentId: body.agentId,
        chunkIndex: chunk.chunkIndex,
        totalChunks: chunked.totalChunks,
        contentHash: chunked.contentHash,
        episodeUuid: chunk.episodeUuid,
      });
      results.push(result);
    }

    // ---- Stage 3: resolution — entities/statements/aspects ----
    setStage(row.id, "resolution");
    const episodeUuids = results
      .map((r) => r.episodeUuid)
      .filter((u): u is string => typeof u === "string");
    const resolutions = [];
    for (const episodeUuid of episodeUuids) {
      resolutions.push(await processGraphResolution({ episodeUuid, queueId: row.id }));
    }

    // ---- Stage 4: labels — only when none were explicitly provided ----
    setStage(row.id, "labels");
    if ((!body.labelIds || body.labelIds.length === 0) && episodeUuids.length > 0) {
      try {
        await assignLabels(row.id);
      } catch (err) {
        // REF: label assignment failure never fails the ingestion
        console.warn(
          `[v2/memory/queue] label assignment failed for ${row.id} (non-blocking):`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // ---- A5 settle: wait for the parallel compaction before completing ----
    if (compactionPromise) {
      setStage(row.id, "compaction");
      await compactionPromise;
    }

    // ---- Complete ----
    const output = {
      episodes: results,
      episodeUuids,
      statementsCreated: results.reduce((s, r) => s + r.statementsCreated, 0),
      voiceAspectsCreated: results.reduce((s, r) => s + r.voiceAspectsCreated, 0),
      invalidated: resolutions.reduce((s, r) => s + r.invalidatedCount, 0),
      duplicatesRemoved: resolutions.reduce((s, r) => s + r.duplicateCount, 0),
      aspect: {
        duplicatesSkipped: resolutions.reduce((s, r) => s + r.aspect.duplicatesSkipped, 0),
        evolutionsResolved: resolutions.reduce((s, r) => s + r.aspect.evolutionsResolved, 0),
        newKept: resolutions.reduce((s, r) => s + r.aspect.newKept, 0),
      },
    };
    db.prepare(
      `UPDATE ingestion_queue SET status = 'COMPLETED', output = ?, graph_ids = ?, processed_at = ?
       WHERE id = ?`,
    ).run(JSON.stringify(output), JSON.stringify(episodeUuids), now(), row.id);

    emit("memory.ingested", { queueId: row.id, episodeUuids, source: body.source }, body.source);

    // ---- A6 seam: persona trigger, post-COMPLETED (REF ingest-episode
    // enqueuePersonaGeneration — threshold/worthiness check runs inside;
    // personaTrigger never throws, and a failure never touches the row). ----
    if (episodeUuids.length > 0) {
      try {
        setStage(row.id, "persona");
        for (const episodeUuid of episodeUuids) {
          await personaTrigger(episodeUuid);
        }
      } catch (personaErr) {
        // Row is already COMPLETED — a persona failure must never demote it.
        console.warn(
          `[v2/memory/queue] persona trigger failed for ${row.id} (non-blocking):`,
          personaErr instanceof Error ? personaErr.message : personaErr,
        );
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      db.prepare(
        "UPDATE ingestion_queue SET status = 'FAILED', error = ?, processed_at = ? WHERE id = ?",
      ).run(message, now(), row.id);
    } catch (updateErr) {
      console.error("[v2/memory/queue] could not record failure:", updateErr);
    }
    try {
      emit("memory.queue.failed", { queueId: row.id, error: message, source: row.source }, row.source);
    } catch {
      /* event emission must not mask the original failure */
    }
    console.error(`[v2/memory/queue] ingestion ${row.id} FAILED:`, message);
  }
}
