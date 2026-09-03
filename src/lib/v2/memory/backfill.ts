import { getDb, tx } from "../db";
import { uuid as newUuid, now } from "../ids";
import { readSettings } from "../../settings";
import { getEpisode, getStatementsForEpisode } from "./graph";
import { addEpisode } from "./ingest";
import { withMemoryModel, openaiCompatBase } from "./llm";

/**
 * S5 — legacy memory backfill (roadmap S5, HANDOFF item 2).
 *
 * The A9 importers wrote legacy episodes in raw mode: verbatim content, an
 * embedding, 'legacy' labels, and NO derivation — so they carry no aspect
 * (Identity / Event / Relationship / …) and no voice facts. Re-running the
 * import in full mode cannot fix them: content_hash + source dedup rejects
 * every row as already present. This routine reads the EXISTING rows that
 * were never derived and runs the same addEpisode() pipeline over them in
 * place (normalize → extract → reflect → classify → triples + voice aspects),
 * 6-8 LLM calls per episode.
 *
 * Model policy: the owner's LOCAL models only. The chat model is pinned for
 * the whole call tree through withMemoryModel(), whatever
 * settings.memory.provider says, to ONE of two local servers:
 *   'ollama-local'   - Ollama on :11434 (the default).
 *   'openai-compat'  - any OpenAI-wire local server at
 *                      settings.memory.openaiCompatUrl. This exists because
 *                      some models cannot run on Ollama at all: Bonsai 27B
 *                      needs a llama.cpp fork, and LM Studio serves it.
 * Embeddings are Ollama-only either way (settings.memory.embedProvider /
 * embedModel), so an openai-compat run still needs Ollama up for the vector
 * half - the preflight checks BOTH and says which one is missing. A server
 * down or a model absent = a named error before any episode is touched.
 * Never a hosted model, never a silent swap between the two.
 *
 * "Lacking derivation" is decided from the graph itself: no provenance edge
 * leaves the episode and no voice_aspects row names it. memory_backfill_log
 * (migration 4) records every attempt; an episode with a derived/nothing row
 * is not offered again, which keeps the run idempotent without touching
 * content_hash. A 'failed' row leaves the episode eligible for the next run.
 *
 * Dedup untouched: addEpisode() is given the episode's own uuid, so the
 * re-save goes through the ON CONFLICT(uuid) path and copies content_hash
 * back verbatim; original_content is write-once in saveEpisode().
 */

export type BackfillOutcome = "derived" | "nothing" | "failed";

export interface BackfillCandidate {
  uuid: string;
  source: string;
  sessionId: string;
  validAt: string;
  chars: number;
  /** First ~160 chars of the verbatim legacy text, whitespace collapsed. */
  preview: string;
}

export interface BackfillEpisodeResult {
  uuid: string;
  source: string;
  validAt: string;
  outcome: BackfillOutcome;
  statements: number;
  voiceAspects: number;
  /** Statement aspect → count, e.g. { Identity: 2, Event: 1 }. */
  statementAspects: Record<string, number>;
  /** Voice aspect → count, e.g. { Preference: 1 }. */
  voiceAspectKinds: Record<string, number>;
  /** Up to 5 derived facts, so the owner sees real rows without opening the DB. */
  sampleFacts: string[];
  error?: string;
  ms: number;
}

export type BackfillProvider = "ollama-local" | "openai-compat";

export interface BackfillOptions {
  limit: number;
  model: string;
  /** Which local server derives. Default settings.memory.backfillProvider, else 'ollama-local'. */
  provider?: BackfillProvider;
  dryRun?: boolean;
  signal?: AbortSignal;
  log?: (text: string) => void;
  progress?: (n: number, total: number) => void;
  /** Module-run id when started from the tray; a fresh uuid otherwise. */
  runId?: string;
}

export interface BackfillResult {
  runId: string;
  model: string;
  /** Which local server actually answered (rule 20: the reply names it). */
  provider: BackfillProvider;
  /** Base URL of that server, so a log line is unambiguous about where it went. */
  base: string;
  embedModel: string;
  dryRun: boolean;
  /** How many undrived legacy episodes exist in total (before the limit). */
  remaining: number;
  candidates: BackfillCandidate[];
  results: BackfillEpisodeResult[];
  derived: number;
  nothing: number;
  failed: number;
  ms: number;
}

export interface BackfillLogRow {
  id: number;
  runId: string;
  episodeUuid: string;
  model: string;
  outcome: BackfillOutcome;
  statements: number;
  voiceAspects: number;
  error: string | null;
  ms: number | null;
  at: string;
}

export const BACKFILL_LIMIT_MAX = 500;

/** Legacy rows are the A9 importers' episodes: source 'migration:<store>'. */
const LEGACY_SOURCE_LIKE = "migration:%";

const UNDRIVED_WHERE = `
  e.source LIKE ?
  AND NOT EXISTS (SELECT 1 FROM edges x WHERE x.type = 'provenance' AND x.from_uuid = e.uuid)
  AND NOT EXISTS (SELECT 1 FROM voice_aspects v WHERE v.episode_uuids LIKE '%"' || e.uuid || '"%')
  AND NOT EXISTS (
    SELECT 1 FROM memory_backfill_log l
    WHERE l.episode_uuid = e.uuid AND l.outcome IN ('derived', 'nothing')
  )`;

interface CandidateRow {
  uuid: string;
  source: string;
  session_id: string;
  valid_at: string;
  original_content: string;
}

function clampLimit(limit: number): number {
  const n = Math.floor(Number(limit));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, BACKFILL_LIMIT_MAX);
}

/** Total undrived legacy episodes, regardless of any limit. */
export function countUndrivedEpisodes(): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM episodes e WHERE ${UNDRIVED_WHERE}`)
    .get(LEGACY_SOURCE_LIKE) as { c: number };
  return row.c;
}

/** Oldest-first list of legacy episodes with no derivation, capped at limit. Reads only. */
export function listUndrivedEpisodes(limit: number): BackfillCandidate[] {
  const rows = getDb()
    .prepare(
      `SELECT e.uuid, e.source, e.session_id, e.valid_at, e.original_content
         FROM episodes e
        WHERE ${UNDRIVED_WHERE}
        ORDER BY e.valid_at ASC, e.created_at ASC
        LIMIT ?`,
    )
    .all(LEGACY_SOURCE_LIKE, clampLimit(limit)) as CandidateRow[];
  return rows.map((r) => ({
    uuid: r.uuid,
    source: r.source,
    sessionId: r.session_id,
    validAt: r.valid_at,
    chars: r.original_content.length,
    preview: r.original_content.replace(/\s+/g, " ").trim().slice(0, 160),
  }));
}

/** Newest-first rows of memory_backfill_log. */
export function listBackfillLog(limit = 50): BackfillLogRow[] {
  const rows = getDb()
    .prepare(
      `SELECT id, run_id, episode_uuid, model, outcome, statements, voice_aspects, error, ms, at
         FROM memory_backfill_log ORDER BY id DESC LIMIT ?`,
    )
    .all(clampLimit(limit)) as Array<{
      id: number; run_id: string; episode_uuid: string; model: string; outcome: BackfillOutcome;
      statements: number; voice_aspects: number; error: string | null; ms: number | null; at: string;
    }>;
  return rows.map((r) => ({
    id: r.id,
    runId: r.run_id,
    episodeUuid: r.episode_uuid,
    model: r.model,
    outcome: r.outcome,
    statements: r.statements,
    voiceAspects: r.voice_aspects,
    error: r.error,
    ms: r.ms,
    at: r.at,
  }));
}

// ---------------------------------------------------------------------------
// Local Ollama preflight — fail loudly, never fall back
// ---------------------------------------------------------------------------

export function localOllamaBase(): string {
  return process.env.OLLAMA_URL || "http://127.0.0.1:11434";
}

/** 'bonsai:27b' matches 'bonsai:27b'; 'bonsai' matches 'bonsai:latest' and vice versa. */
export function ollamaHasModel(pulled: string[], wanted: string): boolean {
  const w = wanted.trim();
  if (!w) return false;
  return pulled.some((p) => p === w || p === `${w}:latest` || `${p}:latest` === w);
}

export interface BackfillPreflight {
  provider: BackfillProvider;
  /** Base URL of the chat server that answered the preflight. */
  base: string;
  chatModel: string;
  embedModel: string;
  /** Whether the embed model was verified (only when embedProvider is ollama-local). */
  embedChecked: boolean;
  /** Base URL of the Ollama that serves embeddings, when it was checked. */
  embedBase?: string;
  /** Model ids the chat server reported. */
  available: string[];
}

/** GET /api/tags on the local Ollama. Throws a named error when it is unreachable. */
async function ollamaTags(signal: AbortSignal): Promise<{ base: string; pulled: string[] }> {
  const base = localOllamaBase();
  let res: Response;
  try {
    res = await fetch(`${base}/api/tags`, { signal });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Ollama is not reachable at ${base} (${msg}). Start Ollama (or set OLLAMA_URL); ` +
        `the backfill uses local models only and never falls back to a hosted one.`,
    );
  }
  if (!res.ok) {
    throw new Error(`Ollama at ${base} answered ${res.status} on /api/tags; the backfill cannot verify its models.`);
  }
  const data = (await res.json().catch(() => ({}))) as { models?: Array<{ name?: string; model?: string }> };
  const pulled = (data.models ?? [])
    .map((m) => String(m.name ?? m.model ?? "").trim())
    .filter(Boolean);
  return { base, pulled };
}

/** Settings-driven embed model + whether it lives on the local Ollama. */
function embedTarget(): { embedModel: string; embedChecked: boolean } {
  const mem = readSettings().memory ?? {};
  return {
    embedModel: mem.embedModel || "nomic-embed-text",
    embedChecked: (mem.embedProvider ?? "ollama-local") === "ollama-local",
  };
}

function deadline(opts: { signal?: AbortSignal; timeoutMs?: number }): AbortSignal {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 8_000);
  return opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
}

/**
 * Ollama preflight: chat model AND (when embeddings are local) the embed model
 * must both be pulled. No other provider is ever consulted.
 */
export async function checkLocalOllama(
  chatModel: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<BackfillPreflight> {
  const model = chatModel.trim();
  if (!model) throw new Error("backfill: no chat model given (settings.memory.backfillModel or --model).");
  const { base, pulled } = await ollamaTags(deadline(opts));

  if (!ollamaHasModel(pulled, model)) {
    throw new Error(
      `Model '${model}' is not pulled on Ollama at ${base}. Pulled: ${pulled.length ? pulled.join(", ") : "(none)"}. ` +
        `Run: ollama pull ${model}. No fallback.`,
    );
  }

  const { embedModel, embedChecked } = embedTarget();
  if (embedChecked && !ollamaHasModel(pulled, embedModel)) {
    throw new Error(
      `Embedding model '${embedModel}' (settings.memory.embedModel) is not pulled on Ollama at ${base}. ` +
        `Run: ollama pull ${embedModel}. No fallback.`,
    );
  }
  return {
    provider: "ollama-local",
    base,
    chatModel: model,
    embedModel,
    embedChecked,
    embedBase: embedChecked ? base : undefined,
    available: pulled,
  };
}

/** An OpenAI /v1/models list carries the served ids under data[].id. */
export function openaiCompatHasModel(available: string[], wanted: string): boolean {
  const w = wanted.trim();
  if (!w) return false;
  return available.some((a) => a === w);
}

/**
 * OpenAI-compatible preflight (LM Studio and friends): GET {base}/models must
 * list the chat model id exactly as the server names it — LM Studio shows it in
 * the Developer tab as the "API identifier", e.g. `bonsai-27b`, which is NOT
 * the Ollama-style `bonsai:27b` tag.
 *
 * Embeddings are Ollama-only, so this ALSO checks the embed model on Ollama
 * when embedProvider is 'ollama-local'. Two servers, two named failures: the
 * error says which one is missing rather than "backfill failed".
 */
export async function checkOpenAICompat(
  chatModel: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<BackfillPreflight> {
  const model = chatModel.trim();
  if (!model) throw new Error("backfill: no chat model given (settings.memory.backfillModel or --model).");
  const base = openaiCompatBase();
  const signal = deadline(opts);

  let res: Response;
  try {
    res = await fetch(`${base}/models`, {
      signal,
      headers: process.env.OPENAI_COMPAT_API_KEY
        ? { authorization: `Bearer ${process.env.OPENAI_COMPAT_API_KEY}` }
        : undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `No OpenAI-compatible server at ${base} (${msg}). In LM Studio: Developer tab > Start Server, ` +
        `load the model, and confirm the port matches settings.memory.openaiCompatUrl. No fallback.`,
    );
  }
  if (!res.ok) {
    throw new Error(`OpenAI-compatible server at ${base} answered ${res.status} on /models; cannot verify '${model}'.`);
  }
  const data = (await res.json().catch(() => ({}))) as { data?: Array<{ id?: string }> };
  const available = (data.data ?? []).map((m) => String(m.id ?? "").trim()).filter(Boolean);

  if (!openaiCompatHasModel(available, model)) {
    throw new Error(
      `Model '${model}' is not served at ${base}. Served: ${available.length ? available.join(", ") : "(none)"}. ` +
        `Load it in LM Studio and use its API identifier verbatim. No fallback.`,
    );
  }

  const { embedModel, embedChecked } = embedTarget();
  let embedBase: string | undefined;
  if (embedChecked) {
    // The vector half still runs on Ollama; say so plainly when it is missing.
    const tags = await ollamaTags(deadline(opts));
    embedBase = tags.base;
    if (!ollamaHasModel(tags.pulled, embedModel)) {
      throw new Error(
        `Chat is served at ${base}, but the embedding model '${embedModel}' is not pulled on Ollama at ${tags.base}. ` +
          `Embeddings never run on the OpenAI-compatible server. Run: ollama pull ${embedModel}. No fallback.`,
      );
    }
  }
  return { provider: "openai-compat", base, chatModel: model, embedModel, embedChecked, embedBase, available };
}

/** Preflight the server the run will actually use. */
export async function checkBackfillProvider(
  provider: BackfillProvider,
  chatModel: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<BackfillPreflight> {
  return provider === "openai-compat"
    ? checkOpenAICompat(chatModel, opts)
    : checkLocalOllama(chatModel, opts);
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

function aspectsFor(episodeUuid: string): Pick<
  BackfillEpisodeResult,
  "statements" | "voiceAspects" | "statementAspects" | "voiceAspectKinds" | "sampleFacts"
> {
  const statements = getStatementsForEpisode(episodeUuid);
  const statementAspects: Record<string, number> = {};
  for (const s of statements) {
    const a = s.aspect ?? "Unclassified";
    statementAspects[a] = (statementAspects[a] ?? 0) + 1;
  }

  const voiceRows = getDb()
    .prepare("SELECT fact, aspect FROM voice_aspects WHERE episode_uuids LIKE ?")
    .all(`%"${episodeUuid}"%`) as Array<{ fact: string; aspect: string }>;
  const voiceAspectKinds: Record<string, number> = {};
  for (const v of voiceRows) voiceAspectKinds[v.aspect] = (voiceAspectKinds[v.aspect] ?? 0) + 1;

  const sampleFacts = [
    ...statements.map((s) => `[${s.aspect ?? "Unclassified"}] ${s.fact}`),
    ...voiceRows.map((v) => `[voice:${v.aspect}] ${v.fact}`),
  ].slice(0, 5);

  return {
    statements: statements.length,
    voiceAspects: voiceRows.length,
    statementAspects,
    voiceAspectKinds,
    sampleFacts,
  };
}

function recordLog(row: {
  runId: string; episodeUuid: string; model: string; outcome: BackfillOutcome;
  statements: number; voiceAspects: number; error?: string; ms: number;
}): void {
  tx((db) => {
    db.prepare(
      `INSERT INTO memory_backfill_log
         (run_id, episode_uuid, model, outcome, statements, voice_aspects, error, ms, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.runId,
      row.episodeUuid,
      row.model,
      row.outcome,
      row.statements,
      row.voiceAspects,
      row.error ? row.error.slice(0, 1000) : null,
      row.ms,
      now(),
    );
  });
}

function describe(r: BackfillEpisodeResult): string {
  const fmt = (m: Record<string, number>) =>
    Object.entries(m).map(([k, v]) => `${k} ${v}`).join(", ");
  const id = r.uuid.slice(0, 8);
  if (r.outcome === "failed") return `${id} failed: ${r.error ?? "unknown error"}`;
  if (r.outcome === "nothing") return `${id} nothing to remember (row kept, no facts)`;
  const facts = r.statements ? `${r.statements} fact${r.statements === 1 ? "" : "s"} (${fmt(r.statementAspects)})` : "0 facts";
  const voice = r.voiceAspects ? `${r.voiceAspects} voice (${fmt(r.voiceAspectKinds)})` : "0 voice";
  return `${id} derived: ${facts}, ${voice}`;
}

function abortError(): Error {
  const e = new Error("backfill stopped");
  e.name = "AbortError";
  return e;
}

/**
 * Derive aspects for existing undrived legacy episodes, in place.
 * dryRun lists the candidates and writes nothing (no DB write, no Ollama call).
 * A real run preflights local Ollama, then works the candidates oldest-first,
 * recording one memory_backfill_log row per episode. One episode failing is
 * recorded and the run continues; every episode failing throws so the run
 * shows as an error, never as a quiet "done".
 */
export async function backfillEpisodes(opts: BackfillOptions): Promise<BackfillResult> {
  const t0 = Date.now();
  const runId = opts.runId ?? newUuid();
  const model = opts.model.trim();
  const log = opts.log ?? (() => {});
  const progress = opts.progress ?? (() => {});
  const limit = clampLimit(opts.limit);
  const dryRun = opts.dryRun === true;
  const mem = readSettings().memory ?? {};
  const embedModel = mem.embedModel || "nomic-embed-text";
  const provider: BackfillProvider = opts.provider ?? mem.backfillProvider ?? "ollama-local";
  const base = provider === "openai-compat" ? openaiCompatBase() : localOllamaBase();

  if (!model) throw new Error("backfill: no chat model given (settings.memory.backfillModel or --model).");

  const remaining = countUndrivedEpisodes();
  const candidates = listUndrivedEpisodes(limit);
  const shell: BackfillResult = {
    runId, model, provider, base, embedModel, dryRun, remaining, candidates,
    results: [], derived: 0, nothing: 0, failed: 0, ms: 0,
  };

  if (dryRun) {
    log(`dry run: ${candidates.length} of ${remaining} undrived legacy episode${remaining === 1 ? "" : "s"} would be derived with ${model} on ${provider} (${base}); nothing written`);
    return { ...shell, ms: Date.now() - t0 };
  }
  if (candidates.length === 0) {
    log("no undrived legacy episodes; nothing to do");
    return { ...shell, ms: Date.now() - t0 };
  }

  const pre = await checkBackfillProvider(provider, model, { signal: opts.signal });
  log(
    `${pre.provider} at ${pre.base}: ${pre.chatModel} ready` +
      (pre.embedChecked
        ? `; embeddings ${pre.embedModel} on Ollama at ${pre.embedBase}`
        : `; embeddings on ${mem.embedProvider}`),
  );
  log(`deriving ${candidates.length} of ${remaining} undrived legacy episodes, oldest first`);

  const results: BackfillEpisodeResult[] = [];
  const total = candidates.length;
  for (let i = 0; i < total; i++) {
    if (opts.signal?.aborted) throw abortError();
    const c = candidates[i];
    progress(i, total);
    const ep = getEpisode(c.uuid);
    if (!ep) {
      const r: BackfillEpisodeResult = {
        uuid: c.uuid, source: c.source, validAt: c.validAt, outcome: "failed",
        statements: 0, voiceAspects: 0, statementAspects: {}, voiceAspectKinds: {}, sampleFacts: [],
        error: "episode row vanished before it was derived", ms: 0,
      };
      results.push(r);
      recordLog({ runId, episodeUuid: c.uuid, model, outcome: "failed", statements: 0, voiceAspects: 0, error: r.error, ms: 0 });
      log(describe(r));
      continue;
    }

    const started = Date.now();
    try {
      const out = await withMemoryModel({ provider, model, signal: opts.signal }, () =>
        addEpisode({
          episodeUuid: ep.uuid,
          episodeBody: ep.originalContent,
          originalEpisodeBody: ep.originalContent,
          referenceTime: ep.validAt,
          metadata: ep.metadata,
          source: ep.source,
          userId: ep.userId,
          sessionId: ep.sessionId,
          queueId: `backfill:${runId}`,
          type: ep.type,
          endUserId: ep.endUserId ?? undefined,
          agentId: ep.agentId ?? undefined,
          contentHash: ep.contentHash ?? undefined,
        }),
      );
      const outcome: BackfillOutcome = out.episodeUuid ? "derived" : "nothing";
      const stats = outcome === "derived"
        ? aspectsFor(ep.uuid)
        : { statements: 0, voiceAspects: 0, statementAspects: {}, voiceAspectKinds: {}, sampleFacts: [] };
      const r: BackfillEpisodeResult = {
        uuid: ep.uuid, source: ep.source, validAt: ep.validAt, outcome, ...stats, ms: Date.now() - started,
      };
      results.push(r);
      recordLog({ runId, episodeUuid: ep.uuid, model, outcome, statements: r.statements, voiceAspects: r.voiceAspects, ms: r.ms });
      log(describe(r));
    } catch (err) {
      if (opts.signal?.aborted || (err instanceof Error && err.name === "AbortError")) throw err;
      const message = err instanceof Error ? err.message : String(err);
      const r: BackfillEpisodeResult = {
        uuid: ep.uuid, source: ep.source, validAt: ep.validAt, outcome: "failed",
        statements: 0, voiceAspects: 0, statementAspects: {}, voiceAspectKinds: {}, sampleFacts: [],
        error: message, ms: Date.now() - started,
      };
      results.push(r);
      recordLog({ runId, episodeUuid: ep.uuid, model, outcome: "failed", statements: 0, voiceAspects: 0, error: message, ms: r.ms });
      log(describe(r));
    }
  }
  progress(total, total);

  const derived = results.filter((r) => r.outcome === "derived").length;
  const nothing = results.filter((r) => r.outcome === "nothing").length;
  const failed = results.filter((r) => r.outcome === "failed").length;
  log(`done: ${derived} derived, ${nothing} nothing to remember, ${failed} failed; ${remaining - derived - nothing} legacy episodes still undrived`);

  if (failed === total) {
    throw new Error(
      `backfill: every one of ${total} episodes failed (model ${model}); first error: ${results[0]?.error ?? "unknown"}`,
    );
  }
  return { ...shell, results, derived, nothing, failed, ms: Date.now() - t0 };
}
