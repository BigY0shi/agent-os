import { getDb, tx } from "../db";
import { now } from "../ids";
import { emit } from "../events";
import {
  appendVoiceAspectEpisode,
  deleteStatementAsDuplicate,
  getEpisode,
  getSessionEpisodes,
  getStatementsForEpisode,
  invalidateStatements,
  invalidateVoiceAspects,
  moveAllProvenanceToStatement,
  orphanEntityCleanup,
} from "./graph";
import {
  get as vectorGet,
  remove as vectorRemove,
  search as vectorSearch,
} from "./vector";
import { modelCall, modelCallText, extractOutputTag } from "./llm";
import { dedupeNodes } from "./prompts/nodes";
import { resolveStatementPrompt } from "./prompts/statements";
import {
  aspectResolutionPrompt,
  AspectResolutionSchema,
} from "./prompts/aspect-resolution";
import {
  ENTITY_DEDUPE_THRESHOLD,
  SESSION_EPISODE_WINDOW,
  STATEMENT_SIMILAR_THRESHOLD,
  VOICE_SIMILAR_THRESHOLD,
} from "./constants";

/**
 * A2.6 — graph + aspect resolution, ported from:
 *   REF apps/webapp/app/jobs/ingest/graph-resolution.logic.ts
 *   REF apps/webapp/app/jobs/ingest/aspect-resolution.logic.ts
 *   REF apps/webapp/app/services/aspectStore.server.ts (duplicate/evolution/new)
 *   REF packages/providers/src/graph/neo4j/domains/entity.ts (merge/dedupe Cypher → SQL)
 * Stripped per port map: contact-sync, town-webhooks, credits/BYOK, multi-tenant.
 *
 * Sanctioned deletes only: duplicate statements/voice-aspects AFTER their
 * provenance moved to the survivor, merged/orphaned entities (+ their vectors).
 * Contradictions are INVALIDATED, never deleted (A3 temporal chains).
 */

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

interface EntityLite {
  uuid: string;
  name: string;
  type: string | null;
  attributes: Record<string, unknown>;
}

interface TripleLite {
  statement: { uuid: string; fact: string };
  subject: EntityLite;
  predicate: EntityLite;
  object: EntityLite;
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Entity merge primitives (port of the Neo4j Cypher in REF entity.ts)
// ---------------------------------------------------------------------------

/**
 * Merge source entity into target: newer (source) attributes win, newer type
 * wins when set, all SPO edges re-pointed (INSERT OR IGNORE = Cypher MERGE),
 * source row + vector removed. Idempotent — missing source is a no-op.
 */
export function mergeEntities(sourceUuid: string, targetUuid: string): void {
  if (sourceUuid === targetUuid) return;
  const merged = tx((db) => {
    const source = db
      .prepare("SELECT uuid, type, attributes FROM entities WHERE uuid = ?")
      .get(sourceUuid) as { uuid: string; type: string | null; attributes: string } | undefined;
    if (!source) return false; // already merged
    const target = db
      .prepare("SELECT uuid, type, attributes FROM entities WHERE uuid = ?")
      .get(targetUuid) as { uuid: string; type: string | null; attributes: string } | undefined;
    if (!target) throw new Error(`mergeEntities: target ${targetUuid} not found`);

    const mergedAttrs = {
      ...parseJson<Record<string, unknown>>(target.attributes, {}),
      ...parseJson<Record<string, unknown>>(source.attributes, {}),
    };
    const mergedType = source.type || target.type || null;
    db.prepare("UPDATE entities SET attributes = ?, type = ? WHERE uuid = ?").run(
      JSON.stringify(mergedAttrs),
      mergedType,
      targetUuid,
    );

    // Re-point SPO edges statement→entity from source to target (MERGE semantics)
    const edges = db
      .prepare(
        "SELECT id, type, from_uuid FROM edges WHERE to_uuid = ? AND type IN ('subject','predicate','object')",
      )
      .all(sourceUuid) as { id: number; type: string; from_uuid: string }[];
    const insert = db.prepare(
      "INSERT OR IGNORE INTO edges (type, from_uuid, to_uuid, created_at) VALUES (?, ?, ?, ?)",
    );
    const ts = now();
    for (const e of edges) {
      insert.run(e.type, e.from_uuid, targetUuid, ts);
      db.prepare("DELETE FROM edges WHERE id = ?").run(e.id);
    }

    db.prepare("DELETE FROM entities WHERE uuid = ?").run(sourceUuid);
    return true;
  });
  if (merged) vectorRemove("entity", sourceUuid);
}

/**
 * Pre-resolution pass: collapse entities sharing the same lowercased name
 * (REF deduplicateEntitiesByName). Oldest row survives; newer duplicates merge
 * in (their attributes/type win) and are deleted with their embeddings.
 */
export function deduplicateEntitiesByName(): { count: number; deletedUuids: string[] } {
  const db = getDb();
  const groups = db
    .prepare(
      `SELECT LOWER(name) AS lname FROM entities GROUP BY LOWER(name) HAVING COUNT(*) > 1`,
    )
    .all() as { lname: string }[];

  const deletedUuids: string[] = [];
  for (const g of groups) {
    const rows = db
      .prepare(
        "SELECT uuid FROM entities WHERE LOWER(name) = ? ORDER BY created_at ASC, uuid ASC",
      )
      .all(g.lname) as { uuid: string }[];
    const target = rows[0];
    for (const source of rows.slice(1)) {
      mergeEntities(source.uuid, target.uuid);
      deletedUuids.push(source.uuid);
    }
  }
  return { count: deletedUuids.length, deletedUuids };
}

// ---------------------------------------------------------------------------
// Triple + candidate queries (SQL over the edges table)
// ---------------------------------------------------------------------------

/** All triples sourced from an episode (statement + its SPO entities). */
export function getTriplesForEpisode(episodeUuid: string): TripleLite[] {
  const db = getDb();
  const statements = db
    .prepare(
      `SELECT s.uuid, s.fact FROM edges e
       JOIN statements s ON s.uuid = e.to_uuid
       WHERE e.type = 'provenance' AND e.from_uuid = ?
         AND s.invalid_at IS NULL`,
    )
    .all(episodeUuid) as { uuid: string; fact: string }[];

  const entityFor = db.prepare(
    `SELECT ent.uuid, ent.name, ent.type, ent.attributes FROM edges e
     JOIN entities ent ON ent.uuid = e.to_uuid
     WHERE e.type = ? AND e.from_uuid = ? LIMIT 1`,
  );

  const triples: TripleLite[] = [];
  for (const st of statements) {
    const subject = entityFor.get("subject", st.uuid) as
      | { uuid: string; name: string; type: string | null; attributes: string }
      | undefined;
    const predicate = entityFor.get("predicate", st.uuid) as typeof subject;
    const object = entityFor.get("object", st.uuid) as typeof subject;
    if (!subject) continue; // malformed triple — skip
    const lite = (r: NonNullable<typeof subject>): EntityLite => ({
      uuid: r.uuid,
      name: r.name,
      type: r.type,
      attributes: parseJson<Record<string, unknown>>(r.attributes, {}),
    });
    triples.push({
      statement: { uuid: st.uuid, fact: st.fact },
      subject: lite(subject),
      predicate: predicate ? lite(predicate) : lite(subject),
      object: object ? lite(object) : lite(subject),
    });
  }
  return triples;
}

/** Valid statements sharing subject+predicate (potential contradictions). */
function findSameSubjectPredicate(
  subjectUuid: string,
  predicateUuid: string,
  excludeIds: string[],
): { uuid: string; fact: string }[] {
  const placeholders = excludeIds.map(() => "?").join(",");
  return getDb()
    .prepare(
      `SELECT DISTINCT s.uuid, s.fact FROM statements s
       JOIN edges es ON es.type = 'subject' AND es.from_uuid = s.uuid AND es.to_uuid = ?
       JOIN edges ep ON ep.type = 'predicate' AND ep.from_uuid = s.uuid AND ep.to_uuid = ?
       WHERE s.invalid_at IS NULL
       ${excludeIds.length ? `AND s.uuid NOT IN (${placeholders})` : ""}`,
    )
    .all(subjectUuid, predicateUuid, ...excludeIds) as { uuid: string; fact: string }[];
}

/** Valid statements sharing subject+object with a different predicate. */
function findSameSubjectObject(
  subjectUuid: string,
  objectUuid: string,
  excludePredicateUuid: string,
  excludeIds: string[],
): { uuid: string; fact: string }[] {
  const placeholders = excludeIds.map(() => "?").join(",");
  return getDb()
    .prepare(
      `SELECT DISTINCT s.uuid, s.fact FROM statements s
       JOIN edges es ON es.type = 'subject' AND es.from_uuid = s.uuid AND es.to_uuid = ?
       JOIN edges eo ON eo.type = 'object' AND eo.from_uuid = s.uuid AND eo.to_uuid = ?
       WHERE s.invalid_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM edges ep WHERE ep.type = 'predicate'
             AND ep.from_uuid = s.uuid AND ep.to_uuid = ?
         )
       ${excludeIds.length ? `AND s.uuid NOT IN (${placeholders})` : ""}`,
    )
    .all(subjectUuid, objectUuid, excludePredicateUuid, ...excludeIds) as {
    uuid: string;
    fact: string;
  }[];
}

// ---------------------------------------------------------------------------
// Entity resolution (REF resolveExtractedNodesWithMerges)
// ---------------------------------------------------------------------------

async function resolveExtractedNodesWithMerges(
  triples: TripleLite[],
  episodeContent: string,
  previousEpisodeContents: string[],
): Promise<{ entityMerges: Array<{ sourceUuid: string; targetUuid: string }> }> {
  const entityMerges: Array<{ sourceUuid: string; targetUuid: string }> = [];

  const uniqueEntitiesMap = new Map<string, EntityLite>();
  for (const t of triples) {
    for (const ent of [t.subject, t.predicate, t.object]) {
      if (!uniqueEntitiesMap.has(ent.uuid)) uniqueEntitiesMap.set(ent.uuid, ent);
    }
  }
  const uniqueEntities = Array.from(uniqueEntitiesMap.values());
  const currentEntityIds = uniqueEntities.map((e) => e.uuid);

  // Per-entity similar candidates via the entity namespace (0.7, top 5)
  const entitiesNeedingLLM: Array<{ entity: EntityLite; similarEntities: EntityLite[] }> = [];
  const db = getDb();
  for (const entity of uniqueEntities) {
    const embedding = vectorGet("entity", entity.uuid);
    if (!embedding) continue;
    const hits = vectorSearch("entity", embedding, {
      limit: 5,
      threshold: ENTITY_DEDUPE_THRESHOLD,
      excludeUuids: currentEntityIds,
    });
    if (hits.length === 0) continue;
    const placeholders = hits.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT uuid, name, type, attributes FROM entities WHERE uuid IN (${placeholders})`)
      .all(...hits.map((h) => h.uuid)) as {
      uuid: string;
      name: string;
      type: string | null;
      attributes: string;
    }[];
    // Preserve score order from the KNN
    const byUuid = new Map(rows.map((r) => [r.uuid, r]));
    const similarEntities = hits
      .map((h) => byUuid.get(h.uuid))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map((r) => ({
        uuid: r.uuid,
        name: r.name,
        type: r.type,
        attributes: parseJson<Record<string, unknown>>(r.attributes, {}),
      }));
    if (similarEntities.length > 0) entitiesNeedingLLM.push({ entity, similarEntities });
  }

  if (entitiesNeedingLLM.length === 0) return { entityMerges };

  // Single dedupe LLM call (low, <output>-tag JSON per REF)
  const dedupeContext = {
    extracted_nodes: entitiesNeedingLLM.map((result, index) => ({
      id: index,
      name: result.entity.name,
      type: result.entity.type || null,
      attributes: result.entity.attributes || {},
      duplication_candidates: result.similarEntities.map((candidate, j) => ({
        idx: j,
        name: candidate.name,
        type: candidate.type || null,
        attributes: candidate.attributes || {},
      })),
    })),
    episodeContent,
    previousEpisodes: previousEpisodeContents,
  };

  try {
    const responseText = await modelCallText(dedupeNodes(dedupeContext), "low");
    const tagged = extractOutputTag(responseText) ?? responseText;
    const parsed = JSON.parse(tagged) as {
      entity_resolutions?: Array<{ id: number; name?: string; duplicate_idx?: number }>;
    };
    for (const resolution of parsed.entity_resolutions || []) {
      const original = entitiesNeedingLLM[resolution.id];
      if (!original) continue;
      const duplicateIdx = resolution.duplicate_idx ?? -1;
      if (duplicateIdx >= 0 && duplicateIdx < original.similarEntities.length) {
        const target = original.similarEntities[duplicateIdx];
        if (target?.uuid) {
          entityMerges.push({ sourceUuid: original.entity.uuid, targetUuid: target.uuid });
        }
      }
    }
  } catch (err) {
    // REF fallback: keep originals when the LLM response is unusable
    console.warn(
      "[v2/memory/resolution] entity dedupe LLM failed — keeping originals:",
      err instanceof Error ? err.message : err,
    );
  }

  return { entityMerges };
}

// ---------------------------------------------------------------------------
// Statement resolution (REF resolveStatementsWithDuplicates)
// ---------------------------------------------------------------------------

async function resolveStatementsWithDuplicates(
  triples: TripleLite[],
  episodeContent: string,
  referenceTime: string,
  previousSessionStatements: { uuid: string; fact: string }[],
): Promise<{
  invalidatedStatements: string[];
  duplicateStatements: Array<{ newStatementUuid: string; existingStatementUuid: string }>;
}> {
  const invalidatedStatements: string[] = [];
  const duplicateStatements: Array<{
    newStatementUuid: string;
    existingStatementUuid: string;
  }> = [];
  if (triples.length === 0) return { invalidatedStatements, duplicateStatements };

  const currentStatementIds = triples.map((t) => t.statement.uuid);

  // Per-triple candidates: structural (same subj+pred; same subj+obj) →
  // semantic (statement ns 0.7) → previous-session statements
  const similarByUuid = new Map<string, { uuid: string; fact: string }>();
  let anyCandidates = false;

  for (const triple of triples) {
    const checked = new Set<string>(currentStatementIds);
    const collect = (rows: { uuid: string; fact: string }[]) => {
      for (const r of rows) {
        if (checked.has(r.uuid)) continue;
        checked.add(r.uuid);
        similarByUuid.set(r.uuid, r);
        anyCandidates = true;
      }
    };

    collect(
      findSameSubjectPredicate(triple.subject.uuid, triple.predicate.uuid, currentStatementIds),
    );
    collect(
      findSameSubjectObject(
        triple.subject.uuid,
        triple.object.uuid,
        triple.predicate.uuid,
        currentStatementIds,
      ),
    );

    const embedding = vectorGet("statement", triple.statement.uuid);
    if (embedding) {
      const hits = vectorSearch("statement", embedding, {
        limit: 10,
        threshold: STATEMENT_SIMILAR_THRESHOLD,
        excludeUuids: [...checked],
      });
      if (hits.length > 0) {
        const db = getDb();
        const placeholders = hits.map(() => "?").join(",");
        const rows = db
          .prepare(
            `SELECT uuid, fact FROM statements WHERE uuid IN (${placeholders}) AND invalid_at IS NULL`,
          )
          .all(...hits.map((h) => h.uuid)) as { uuid: string; fact: string }[];
        collect(rows);
      }
    }

    collect(previousSessionStatements);
  }

  if (!anyCandidates) return { invalidatedStatements, duplicateStatements };

  // Single resolve LLM call (low, <output>-tag sparse JSON array per REF)
  const promptContext = {
    newStatements: triples.map((t) => ({
      statement: { uuid: t.statement.uuid, fact: t.statement.fact },
      subject: t.subject.name,
      predicate: t.predicate.name,
      object: t.object.name,
    })),
    similarStatements: Array.from(similarByUuid.values()).map((s) => ({
      statementId: s.uuid,
      fact: s.fact,
    })),
    episodeContent,
    referenceTime,
  };

  try {
    const responseText = await modelCallText(resolveStatementPrompt(promptContext), "low");
    const tagged = extractOutputTag(responseText);
    if (!tagged) {
      console.warn("[v2/memory/resolution] statement resolution missing <output> — keeping all");
      return { invalidatedStatements, duplicateStatements };
    }
    const analysis = JSON.parse(tagged) as Array<{
      statementId: string;
      isDuplicate?: boolean;
      duplicateId?: string | null;
      contradictions?: string[];
    }>;
    if (!Array.isArray(analysis)) return { invalidatedStatements, duplicateStatements };

    const knownCandidateIds = new Set(similarByUuid.keys());
    for (const result of analysis) {
      const triple = triples.find((t) => t.statement.uuid === result.statementId);
      if (!triple) continue;
      if (result.isDuplicate && result.duplicateId && knownCandidateIds.has(result.duplicateId)) {
        duplicateStatements.push({
          newStatementUuid: triple.statement.uuid,
          existingStatementUuid: result.duplicateId,
        });
      } else if (result.contradictions && result.contradictions.length > 0) {
        // Defensive vs REF (which trusts the LLM blindly): only invalidate
        // statements that were actually offered as candidates — never this
        // episode's own new statements.
        for (const uuid of result.contradictions) {
          if (knownCandidateIds.has(uuid)) invalidatedStatements.push(uuid);
        }
      }
    }
  } catch (err) {
    console.warn(
      "[v2/memory/resolution] statement resolution LLM failed — keeping all statements:",
      err instanceof Error ? err.message : err,
    );
  }

  return {
    invalidatedStatements: Array.from(new Set(invalidatedStatements)),
    duplicateStatements,
  };
}

// ---------------------------------------------------------------------------
// Aspect (voice) resolution (REF aspect-resolution.logic.ts + aspectStore)
// ---------------------------------------------------------------------------

interface VoiceLite {
  uuid: string;
  fact: string;
  aspect: string;
}

function getVoiceAspectsForEpisode(episodeUuid: string): VoiceLite[] {
  return getDb()
    .prepare(
      `SELECT v.uuid, v.fact, v.aspect FROM voice_aspects v
       WHERE EXISTS (SELECT 1 FROM json_each(v.episode_uuids) WHERE json_each.value = ?)`,
    )
    .all(episodeUuid) as VoiceLite[];
}

/** Sanctioned delete: a duplicate voice aspect whose episode provenance was
 *  first appended to the survivor (REF duplicate path). */
function deleteVoiceAspectAsDuplicate(uuid: string): void {
  getDb().prepare("DELETE FROM voice_aspects WHERE uuid = ?").run(uuid);
  vectorRemove("voice_aspect", uuid);
}

export interface AspectResolutionResult {
  duplicatesSkipped: number;
  evolutionsResolved: number;
  newKept: number;
}

export async function processAspectResolution(
  episodeUuid: string,
): Promise<AspectResolutionResult> {
  const newAspects = getVoiceAspectsForEpisode(episodeUuid);
  if (newAspects.length === 0) {
    return { duplicatesSkipped: 0, evolutionsResolved: 0, newKept: 0 };
  }

  const db = getDb();
  const newUuids = newAspects.map((a) => a.uuid);

  // Similar existing aspects: voice ns at 0.75 (the caller value — NOT
  // aspectStore's 0.8 default), same aspect type, still valid, top 5.
  const aspectsWithSimilar = newAspects.map((aspect) => {
    const embedding = vectorGet("voice_aspect", aspect.uuid);
    if (!embedding) return { aspect, similar: [] as Array<VoiceLite & { score: number }> };
    const hits = vectorSearch("voice_aspect", embedding, {
      limit: 15, // over-fetch; aspect-type + validity filters run below
      threshold: VOICE_SIMILAR_THRESHOLD,
      excludeUuids: newUuids,
    });
    if (hits.length === 0) return { aspect, similar: [] };
    const placeholders = hits.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT uuid, fact, aspect FROM voice_aspects
         WHERE uuid IN (${placeholders}) AND aspect = ? AND invalid_at IS NULL`,
      )
      .all(...hits.map((h) => h.uuid), aspect.aspect) as VoiceLite[];
    const scoreByUuid = new Map(hits.map((h) => [h.uuid, h.score]));
    const similar = hits
      .map((h) => rows.find((r) => r.uuid === h.uuid))
      .filter((r): r is VoiceLite => !!r)
      .slice(0, 5)
      .map((r) => ({ ...r, score: scoreByUuid.get(r.uuid) ?? 0 }));
    return { aspect, similar };
  });

  const needsResolution = aspectsWithSimilar.filter((a) => a.similar.length > 0);
  const autoNew = aspectsWithSimilar.length - needsResolution.length;

  let duplicatesSkipped = 0;
  let evolutionsResolved = 0;

  if (needsResolution.length > 0) {
    const newForLLM = needsResolution.map((a) => ({
      id: a.aspect.uuid,
      fact: a.aspect.fact,
      aspect: a.aspect.aspect,
    }));
    const existingMap = new Map<string, { id: string; fact: string; aspect: string; score: number }>();
    for (const a of needsResolution) {
      for (const s of a.similar) {
        if (!existingMap.has(s.uuid)) {
          existingMap.set(s.uuid, { id: s.uuid, fact: s.fact, aspect: s.aspect, score: s.score });
        }
      }
    }

    const result = await modelCall(
      aspectResolutionPrompt(newForLLM, Array.from(existingMap.values())),
      "low",
      { schema: AspectResolutionSchema },
    );

    // One decision per new aspect, paired by index (REF ordering contract)
    result.decisions.forEach((decision, idx) => {
      const target = needsResolution[idx];
      if (!target) return;
      switch (decision.decision) {
        case "duplicate": {
          if (decision.matched_aspect_id && existingMap.has(decision.matched_aspect_id)) {
            appendVoiceAspectEpisode(decision.matched_aspect_id, episodeUuid);
            deleteVoiceAspectAsDuplicate(target.aspect.uuid);
            duplicatesSkipped++;
          }
          break;
        }
        case "evolution": {
          if (decision.matched_aspect_id && existingMap.has(decision.matched_aspect_id)) {
            invalidateVoiceAspects([decision.matched_aspect_id], episodeUuid);
            emit("memory.invalidated", {
              kind: "voice_aspect",
              uuids: [decision.matched_aspect_id],
              invalidatedBy: episodeUuid,
            });
            evolutionsResolved++;
          }
          break;
        }
        case "new":
          break;
      }
    });
  }

  return {
    duplicatesSkipped,
    evolutionsResolved,
    newKept: autoNew + (needsResolution.length - duplicatesSkipped),
  };
}

// ---------------------------------------------------------------------------
// Orchestration (REF processGraphResolution)
// ---------------------------------------------------------------------------

export interface GraphResolutionResult {
  resolvedCount: number;
  invalidatedCount: number;
  duplicateCount: number;
  entityMergeCount: number;
  aspect: AspectResolutionResult;
}

export async function processGraphResolution(payload: {
  episodeUuid: string;
  queueId?: string;
}): Promise<GraphResolutionResult> {
  const episode = getEpisode(payload.episodeUuid);
  if (!episode) throw new Error(`Episode ${payload.episodeUuid} not found in graph`);

  // Step 0: exact-name entity dedupe before anything else
  deduplicateEntitiesByName();

  const triples = getTriplesForEpisode(payload.episodeUuid);

  // Session context (previous episodes) for the dedupe prompt + statement
  // candidates
  const previousEpisodes = getSessionEpisodes(episode.sessionId, SESSION_EPISODE_WINDOW + 1).filter(
    (ep) => ep.uuid !== payload.episodeUuid,
  );
  const previousWindow = previousEpisodes.slice(0, SESSION_EPISODE_WINDOW);

  let entityMergeCount = 0;
  let invalidatedCount = 0;
  let duplicateCount = 0;

  if (triples.length > 0) {
    // Step 1: entity resolution
    const { entityMerges } = await resolveExtractedNodesWithMerges(
      triples,
      episode.content,
      previousWindow.map((ep) => ep.content),
    );

    // Step 2: statement resolution
    const previousSessionStatements = previousWindow
      .flatMap((ep) => getStatementsForEpisode(ep.uuid))
      .map((s) => ({ uuid: s.uuid, fact: s.fact }));
    const { invalidatedStatements, duplicateStatements } = await resolveStatementsWithDuplicates(
      triples,
      episode.content,
      episode.validAt,
      previousSessionStatements,
    );

    // Step 3: apply entity merges (+ their vector removals inside mergeEntities)
    for (const merge of entityMerges) {
      mergeEntities(merge.sourceUuid, merge.targetUuid);
    }
    entityMergeCount = entityMerges.length;

    // Step 4: duplicates — move ALL provenance to the survivor, then delete
    for (const dup of duplicateStatements) {
      moveAllProvenanceToStatement(dup.newStatementUuid, dup.existingStatementUuid);
      deleteStatementAsDuplicate(dup.newStatementUuid);
    }
    duplicateCount = duplicateStatements.length;

    // Step 5: contradictions — invalidate, never delete (A3 temporal chains)
    if (invalidatedStatements.length > 0) {
      invalidatedCount = invalidateStatements(invalidatedStatements, payload.episodeUuid);
      if (invalidatedCount > 0) {
        emit("memory.invalidated", {
          kind: "statement",
          uuids: invalidatedStatements,
          invalidatedBy: payload.episodeUuid,
        });
      }
    }
  }

  // Step 6: orphaned entities (no edges) — row + embedding removed
  orphanEntityCleanup();

  // Step 7: voice aspect resolution (non-blocking per REF)
  let aspect: AspectResolutionResult = {
    duplicatesSkipped: 0,
    evolutionsResolved: 0,
    newKept: 0,
  };
  try {
    aspect = await processAspectResolution(payload.episodeUuid);
  } catch (err) {
    console.warn(
      "[v2/memory/resolution] aspect resolution failed (non-blocking):",
      err instanceof Error ? err.message : err,
    );
  }

  return {
    resolvedCount: triples.length - duplicateCount,
    invalidatedCount,
    duplicateCount,
    entityMergeCount,
    aspect,
  };
}
