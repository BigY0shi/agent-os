import { uuid as newUuid, now } from "../ids";
import {
  getEpisode,
  getEpisodes,
  getSessionEpisodes,
  getStatements,
  saveEntity,
  saveEpisode,
  saveTriple,
  saveVoiceAspect,
} from "./graph";
import { getEmbedding, getEmbeddings } from "./embed";
import { search as vectorSearch, upsert as vectorUpsert } from "./vector";
import { modelCall, modelCallText, extractOutputTag } from "./llm";
import { normalizePrompt, normalizeDocumentPrompt } from "./prompts/normalize";
import { extractWorldPrompt, ExtractWorldSchema } from "./prompts/extract-world";
import { extractVoicePrompt, ExtractVoiceSchema } from "./prompts/extract-voice";
import { reflectWorldPrompt, ReflectWorldSchema } from "./prompts/reflect-world";
import { reflectVoicePrompt, ReflectVoiceSchema } from "./prompts/reflect-voice";
import { classifyWorldPrompt, ClassifyWorldSchema } from "./prompts/classify-world";
import { classifyVoicePrompt, ClassifyVoiceSchema } from "./prompts/classify-voice";
import { getActiveRuleTexts } from "./rules";
import {
  DEFAULT_USER_NAME,
  RELATED_MEMORIES_THRESHOLD,
  SESSION_EPISODE_WINDOW,
} from "./constants";
import {
  EntityTypes,
  type AddEpisodeParams,
  type AddEpisodeResult,
  type EntityType,
  type EpisodicNode,
  type VoiceAspect,
} from "./types";

/**
 * A2.5 — episode ingestion, ported from REF apps/webapp/app/services/
 * knowledgeGraph.server.ts (KnowledgeGraphService.addEpisode) + the choreography
 * in REF apps/webapp/app/jobs/ingest/ingest-episode.logic.ts, flattened to
 * functions in house style. Provider calls go through llm.ts modelCall (rule 11).
 *
 * Pipeline per episode (~6-8 LLM calls, tiers verbatim from REF):
 *   normalize (medium, TEXT + <output> tag)
 *   → extract-world ∥ extract-voice (medium, structured)
 *   → reflect-world ∥ reflect-voice (low, structured; graceful unfiltered fallback)
 *   → classify-world ∥ classify-voice (medium, structured)
 *   → triples + voice aspects saved, statements/entities/voice batch-embedded.
 *
 * NOTHING_TO_REMEMBER: short-circuits with episodeUuid null. The episode row
 * saved during preprocessing REMAINS in the graph with its original content and
 * gets no embedding and no facts — REF behavior kept verbatim (the row is never
 * deleted; queue still completes).
 *
 * Deviations from REF (documented):
 *  - Document versioning/diffing (EpisodeVersioningService/EpisodeDiffer) is
 *    phase-2 (port map: S) — DOCUMENT episodes use normalizeDocumentPrompt
 *    without previousVersionContent.
 *  - Credits/BYOK/multi-tenant stripped.
 */

// Working shapes used while building triples (pre-persist)
interface PendingEntity {
  uuid: string;
  name: string;
  type: EntityType | null;
  attributes: Record<string, unknown>;
}

interface PendingTriple {
  statement: {
    uuid: string;
    fact: string;
    aspect: string;
    attributes: Record<string, unknown>;
    validAt: string;
  };
  subject: PendingEntity;
  predicate: PendingEntity;
  object: PendingEntity;
}

/**
 * Related memories for the normalize prompt: episode-ns top-5 + statement-ns
 * top-10 at 0.75 (REF getRelatedMemories). Empty string on any failure —
 * context enrichment must never fail ingestion.
 */
async function getRelatedMemories(
  episodeContent: string,
  excludeEpisodeUuid?: string,
): Promise<string> {
  try {
    const contentEmbedding = await getEmbedding(episodeContent);

    const episodeHits = vectorSearch("episode", contentEmbedding, {
      limit: 5,
      threshold: RELATED_MEMORIES_THRESHOLD,
      excludeUuids: excludeEpisodeUuid ? [excludeEpisodeUuid] : undefined,
    });
    const statementHits = vectorSearch("statement", contentEmbedding, {
      limit: 10,
      threshold: RELATED_MEMORIES_THRESHOLD,
    });

    const relatedEpisodes = getEpisodes(episodeHits.map((h) => h.uuid));
    const relatedFacts = getStatements(statementHits.map((h) => h.uuid));

    let formatted = "";
    if (relatedEpisodes.length > 0) {
      formatted += "## Related Episodes\n";
      relatedEpisodes.forEach((episode, index) => {
        formatted += `### Episode ${index + 1} (${episode.validAt})\n`;
        formatted += `${episode.content || episode.originalContent}\n\n`;
      });
    }
    if (relatedFacts.length > 0) {
      formatted += "## Related Facts\n";
      relatedFacts.forEach((fact) => {
        formatted += `- ${fact.fact}\n`;
      });
    }
    return formatted.trim();
  } catch (err) {
    console.warn(
      "[v2/memory/ingest] related-memories fetch failed (continuing without):",
      err instanceof Error ? err.message : err,
    );
    return "";
  }
}

/** Session context: last N episodes of the same session, current one excluded. */
function getSessionContext(sessionId: string, excludeUuid: string): string | undefined {
  const episodes = getSessionEpisodes(sessionId, SESSION_EPISODE_WINDOW + 1).filter(
    (ep) => ep.uuid !== excludeUuid,
  );
  const window = episodes.slice(0, SESSION_EPISODE_WINDOW);
  if (window.length === 0) return undefined;
  return window
    .map((ep, i) => `Episode ${i + 1} (${ep.createdAt}): ${ep.content}`)
    .join("\n\n");
}

/**
 * Normalize an episode body (REF normalizeEpisodeBody): rules injected via the
 * A2.8 seam, <output>-tag extraction with the REF raw-response fallback kept
 * (local models sometimes drop the tags).
 */
async function normalizeEpisodeBody(params: {
  episodeBody: string;
  source: string;
  referenceTime: string;
  sessionContext?: string;
  type?: string;
  userName?: string;
}): Promise<string> {
  const entityTypes = EntityTypes.filter((t) => t !== "Predicate")
    .map((t) => `- ${t}`)
    .join("\n");

  const relatedMemories = await getRelatedMemories(params.episodeBody);
  const ingestionRules = getActiveRuleTexts(params.source);

  const context = {
    episodeContent: params.episodeBody,
    entityTypes,
    source: params.source,
    relatedMemories,
    ingestionRules,
    episodeTimestamp: params.referenceTime,
    sessionContext: params.sessionContext,
    userName: params.userName ?? DEFAULT_USER_NAME,
  };

  const messages =
    params.type === "DOCUMENT" ? normalizeDocumentPrompt(context) : normalizePrompt(context);

  const responseText = await modelCallText(messages, "medium");

  const tagged = extractOutputTag(responseText);
  if (tagged) return tagged;

  // REF fallback: use the raw response when it looks meaningful
  console.warn("[v2/memory/ingest] normalization response missing <output> tags", {
    head: responseText.substring(0, 200),
    source: params.source,
  });
  const trimmed = responseText.trim();
  if (trimmed && trimmed !== "NOTHING_TO_REMEMBER" && trimmed.length > 10) {
    return trimmed;
  }
  return "";
}

/**
 * Comprehend + classify (REF comprehendAndClassify): extract ×2 in parallel →
 * reflect ×2 in parallel (fallback to unfiltered extraction on failure) →
 * classify ×2 in parallel → triples + voice facts.
 */
async function comprehendAndClassify(
  episode: EpisodicNode,
  userName?: string,
): Promise<{
  voiceAspects: Array<{ fact: string; aspect: VoiceAspect }>;
  graphTriples: PendingTriple[];
}> {
  const context = { episodeContent: episode.content, userName };

  // Step 1: extract world + voice in parallel (medium)
  const [worldExtract, voiceExtract] = await Promise.all([
    modelCall(extractWorldPrompt(context), "medium", { schema: ExtractWorldSchema }),
    modelCall(extractVoicePrompt(context), "medium", { schema: ExtractVoiceSchema }),
  ]);

  // Step 1.5: reflect (low) — session-noise filter with graceful fallback
  const [reflectedWorld, reflectedVoice] = await Promise.all([
    worldExtract.graph_facts.length > 0
      ? modelCall(reflectWorldPrompt(worldExtract.graph_facts, episode.content), "low", {
          schema: ReflectWorldSchema,
        }).catch((err) => {
          console.warn(
            "[v2/memory/ingest] reflect-world failed, falling back to extracted facts:",
            err instanceof Error ? err.message : err,
          );
          return { graph_facts: worldExtract.graph_facts };
        })
      : Promise.resolve({ graph_facts: [] }),
    voiceExtract.voice_facts.length > 0
      ? modelCall(reflectVoicePrompt(voiceExtract.voice_facts, episode.content), "low", {
          schema: ReflectVoiceSchema,
        }).catch((err) => {
          console.warn(
            "[v2/memory/ingest] reflect-voice failed, falling back to extracted facts:",
            err instanceof Error ? err.message : err,
          );
          return { voice_facts: voiceExtract.voice_facts };
        })
      : Promise.resolve({ voice_facts: [] }),
  ]);

  // Step 2: classify in parallel (medium — tier verbatim from REF's calls)
  const [classifiedVoice, classifiedWorld] = await Promise.all([
    reflectedVoice.voice_facts.length > 0
      ? modelCall(classifyVoicePrompt(reflectedVoice.voice_facts), "medium", {
          schema: ClassifyVoiceSchema,
        }).then((r) => r.aspects)
      : Promise.resolve([] as Array<{ fact: string; aspect: VoiceAspect | null }>),
    reflectedWorld.graph_facts.length > 0
      ? modelCall(classifyWorldPrompt(reflectedWorld.graph_facts, userName), "medium", {
          schema: ClassifyWorldSchema,
        }).then((r) => r.facts)
      : Promise.resolve([] as Array<{
          source: string;
          predicate: string;
          target: string;
          fact: string;
          aspect: string | null;
          event_date: string | null;
        }>),
  ]);

  // Entity map from extract-world (lowercase-name keyed, REF verbatim)
  const entityMap = new Map<string, PendingEntity>();
  for (const entity of worldExtract.entities) {
    entityMap.set(entity.name.toLowerCase(), {
      uuid: newUuid(),
      name: entity.name,
      type: (EntityTypes as readonly string[]).includes(entity.type as string)
        ? (entity.type as EntityType)
        : null,
      attributes: (entity.attributes ?? {}) as Record<string, unknown>,
    });
  }

  // Predicate map (type "Predicate")
  const predicateMap = new Map<string, PendingEntity>();
  for (const stmt of classifiedWorld) {
    const key = stmt.predicate.toLowerCase();
    if (!predicateMap.has(key)) {
      predicateMap.set(key, {
        uuid: newUuid(),
        name: stmt.predicate,
        type: "Predicate",
        attributes: {},
      });
    }
  }

  const ensureEntity = (name: string): PendingEntity => {
    const key = name.toLowerCase();
    let node = entityMap.get(key);
    if (!node) {
      node = { uuid: newUuid(), name, type: null, attributes: {} };
      entityMap.set(key, node);
    }
    return node;
  };

  const graphTriples: PendingTriple[] = classifiedWorld.map((stmt) => {
    const attributes: Record<string, unknown> = {};
    if (stmt.event_date) attributes.event_date = stmt.event_date;
    return {
      statement: {
        uuid: newUuid(),
        fact: stmt.fact,
        aspect: stmt.aspect || "Knowledge",
        attributes,
        validAt: episode.validAt,
      },
      subject: ensureEntity(stmt.source),
      predicate: predicateMap.get(stmt.predicate.toLowerCase())!,
      object: ensureEntity(stmt.target),
    };
  });

  // Voice: drop null-classified facts (rejected by the classifier)
  const voiceAspects = classifiedVoice
    .filter((va) => va.aspect !== null)
    .map((va) => ({ fact: va.fact, aspect: va.aspect as VoiceAspect }));

  return { voiceAspects, graphTriples };
}

/**
 * Process one episode into the knowledge graph (REF addEpisode). The episode
 * row is expected to already exist (saved during preprocessing — compaction
 * race fix); the legacy create path is kept for direct callers.
 */
export async function addEpisode(params: AddEpisodeParams): Promise<AddEpisodeResult> {
  const startTime = Date.now();
  const type = params.type ?? "CONVERSATION";
  const userName = params.userName ?? DEFAULT_USER_NAME;

  // Step 1: get (preprocess-saved) or create the episode
  let episode: EpisodicNode;
  if (params.episodeUuid) {
    const existing = getEpisode(params.episodeUuid);
    if (!existing) throw new Error(`Episode ${params.episodeUuid} not found in graph`);
    episode = existing;
  } else {
    const uuid = saveEpisode({
      content: params.episodeBody,
      originalContent: params.originalEpisodeBody || params.episodeBody,
      metadata: params.metadata,
      source: params.source,
      type,
      sessionId: params.sessionId,
      queueId: params.queueId,
      chunkIndex: params.chunkIndex,
      totalChunks: params.totalChunks,
      version: params.version,
      contentHash: params.contentHash,
      chunkHashes: params.chunkHashes,
      userId: params.userId,
      endUserId: params.endUserId,
      agentId: params.agentId,
      validAt: params.referenceTime,
    });
    episode = getEpisode(uuid)!;
  }

  // Step 2: context + normalize
  const sessionContext = getSessionContext(params.sessionId, episode.uuid);
  const normalized = await normalizeEpisodeBody({
    episodeBody: params.episodeBody,
    source: params.source,
    referenceTime: params.referenceTime || now(),
    sessionContext,
    type,
    userName,
  });

  if (!normalized || normalized === "NOTHING_TO_REMEMBER") {
    // REF: the preprocess-saved row stays (original content, no facts, no embedding)
    return {
      type,
      episodeUuid: null,
      statementsCreated: 0,
      voiceAspectsCreated: 0,
      processingTimeMs: Date.now() - startTime,
      totalChunks: params.totalChunks,
      currentChunk: params.chunkIndex !== undefined ? params.chunkIndex + 1 : 1,
    };
  }

  // Step 3: store normalized content + episode embedding
  episode = { ...episode, content: normalized };
  saveEpisode({
    uuid: episode.uuid,
    content: normalized,
    originalContent: episode.originalContent,
    metadata: episode.metadata,
    source: episode.source,
    type: episode.type,
    sessionId: episode.sessionId,
    queueId: episode.queueId,
    chunkIndex: episode.chunkIndex,
    totalChunks: episode.totalChunks,
    version: episode.version,
    contentHash: episode.contentHash,
    chunkHashes: episode.chunkHashes,
    userId: episode.userId,
    endUserId: episode.endUserId,
    agentId: episode.agentId,
    validAt: episode.validAt,
  });
  const episodeEmbedding = await getEmbedding(normalized);
  vectorUpsert("episode", episode.uuid, episodeEmbedding);

  // Step 4: comprehend + classify
  const { voiceAspects, graphTriples } = await comprehendAndClassify(episode, userName);

  // Step 5a: persist entities + triples (entities must exist before edges)
  const uniqueEntities = new Map<string, PendingEntity>();
  for (const triple of graphTriples) {
    for (const ent of [triple.subject, triple.predicate, triple.object]) {
      if (!uniqueEntities.has(ent.uuid)) uniqueEntities.set(ent.uuid, ent);
    }
  }
  for (const ent of uniqueEntities.values()) {
    saveEntity({
      uuid: ent.uuid,
      name: ent.name,
      type: ent.type,
      attributes: ent.attributes,
      userId: params.userId,
    });
  }
  for (const triple of graphTriples) {
    saveTriple({
      statement: {
        uuid: triple.statement.uuid,
        fact: triple.statement.fact,
        aspect: triple.statement.aspect,
        attributes: triple.statement.attributes,
        validAt: triple.statement.validAt,
        userId: params.userId,
      },
      subjectUuid: triple.subject.uuid,
      predicateUuid: triple.predicate.uuid,
      objectUuid: triple.object.uuid,
      episodeUuid: episode.uuid,
    });
  }

  // Step 5b: voice aspects (stored whole) + embeddings
  const savedVoiceUuids: string[] = [];
  for (const va of voiceAspects) {
    savedVoiceUuids.push(
      saveVoiceAspect({
        fact: va.fact,
        aspect: va.aspect,
        episodeUuid: episode.uuid,
        userId: params.userId,
        validAt: episode.validAt,
      }),
    );
  }
  if (voiceAspects.length > 0) {
    const voiceEmbeddings = await getEmbeddings(voiceAspects.map((v) => v.fact));
    savedVoiceUuids.forEach((uuid, i) => vectorUpsert("voice_aspect", uuid, voiceEmbeddings[i]));
  }

  // Step 6: batch-embed statements + entities
  if (graphTriples.length > 0) {
    const entities = Array.from(uniqueEntities.values());
    const [factEmbeddings, entityEmbeddings] = await Promise.all([
      getEmbeddings(graphTriples.map((t) => t.statement.fact)),
      getEmbeddings(entities.map((e) => e.name)),
    ]);
    graphTriples.forEach((t, i) => vectorUpsert("statement", t.statement.uuid, factEmbeddings[i]));
    entities.forEach((e, i) => vectorUpsert("entity", e.uuid, entityEmbeddings[i]));
  }

  return {
    type,
    episodeUuid: episode.uuid,
    statementsCreated: graphTriples.length,
    voiceAspectsCreated: savedVoiceUuids.length,
    processingTimeMs: Date.now() - startTime,
    totalChunks: params.totalChunks,
    currentChunk: params.chunkIndex !== undefined ? params.chunkIndex + 1 : 1,
  };
}
