import { getDb } from "../../db";
import { now } from "../../ids";
import { getEmbedding } from "../embed";
import { search as vectorSearch, batchScore } from "../vector";
import {
  getEntities,
  getEpisodes,
  getEpisodesInvalidFacts,
  getStatements,
} from "../graph";
import { countTokens } from "../chunker";
import { getMatchedLabelIds } from "./router";
import {
  COMPACT_REPLACE_MIN_EPISODES,
  ENTITY_HINTS_MAX,
  ENTITY_HINT_THRESHOLD,
  ENTITY_HINT_TOP,
  ENTITY_LOOKUP_THRESHOLD,
  EPISODE_FALLBACK_THRESHOLD,
  LABEL_SELECT_FALLBACK_THRESHOLD,
  RERANK_EXPLORATORY_THRESHOLD,
  RERANK_KEEP_THRESHOLD,
  TOKEN_BUDGET_DEFAULT,
  VOICE_SEARCH_THRESHOLD,
} from "../constants";
import {
  VOICE_ASPECTS,
  type EntityNode,
  type EpisodicNode,
  type HandlerContext,
  type RecallAspectFacet,
  type RecallEntityFacet,
  type RecallEpisode,
  type RecallFacets,
  type RecallInvalidatedFact,
  type RecallResult,
  type RecallTopicFacet,
  type RecallVoiceAspect,
  type StatementAspect,
  type StatementNode,
  type VoiceAspect,
} from "../types";

/**
 * A4.2/A4.3 — Search-V2 query handlers. Port of REF
 * apps/webapp/app/services/search-v2/handlers.ts with every Cypher from
 * packages/providers/.../neo4j/domains/searchV2.ts rewritten as SQL joins
 * over the `edges`/`episode_labels`/`document_labels` tables.
 *
 * Kept from REF: the 3-path parallel merge per episode handler (label-scoped
 * graph path + entity-hint vector path + raw episode-vector fallback ONLY when
 * no labels), replaceWithCompacts (>2 episodes from one session → the session
 * compact document, first-position, max member score), vector batchScore
 * rerank with keep-thresholds 0.1 / 0.2 (exploratory), the parallel voice
 * aspect search (0.5), and the token-budget tail trim.
 *
 * Dropped per port map: Cohere reranking (vector batchScore is the rerank),
 * the V1 SearchService broad-recall backstop (legacy-data only).
 *
 * Resilience: every sub-path catches, logs, and continues with the other
 * paths (REF behavior — a failed embedding or vector call never fails the
 * whole search).
 *
 * endUserIds semantics (SPEC-A §8.7): when the filter is set, episodes with
 * NULL end_user_id are EXCLUDED (`e.end_user_id IS NOT NULL AND ... IN (...)`)
 * — enforced in the SQL layer AND re-applied in JS on the vector paths.
 * agentId filters episodes.agent_id (CONVENTIONS §4). Documents carry no
 * agent_id column, so exploratory/compact lookups filter endUserId only.
 */

type RankedEpisode = EpisodicNode & { relevanceScore?: number };

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function logPathError(path: string, err: unknown): void {
  console.warn(
    `[v2/search/handlers] ${path} failed (continuing with other paths):`,
    err instanceof Error ? err.message : err,
  );
}

/** Force-scope: options.labelIds bypasses the router's label selection. */
function resolveLabelIds(ctx: HandlerContext): string[] {
  if (ctx.options.labelIds && ctx.options.labelIds.length > 0) {
    return ctx.options.labelIds;
  }
  return getMatchedLabelIds(
    ctx.routerOutput,
    ctx.options.fallbackThreshold ?? LABEL_SELECT_FALLBACK_THRESHOLD,
  );
}

/**
 * Temporal date range from router output — ISO strings, compared lexically
 * (house rule). 'all' falls through to the explicit options filters.
 * (REF getTemporalDateRange, Date → ISO string.)
 */
function getTemporalDateRange(ctx: HandlerContext): {
  startTime?: string;
  endTime?: string;
} {
  const { temporal } = ctx.routerOutput;
  switch (temporal.type) {
    case "recent": {
      const days = temporal.days ?? 7;
      return {
        startTime: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
      };
    }
    case "range":
      return {
        startTime: temporal.startDate ?? undefined,
        endTime: temporal.endDate ?? undefined,
      };
    case "before":
      return { endTime: temporal.endDate ?? undefined };
    case "after":
      return { startTime: temporal.startDate ?? undefined };
    case "all":
    default:
      return {
        startTime: ctx.options.startTime,
        endTime: ctx.options.endTime,
      };
  }
}

/** Re-fetch full episode nodes in the exact uuid order the SQL produced. */
function episodesOrdered(uuids: string[]): EpisodicNode[] {
  if (uuids.length === 0) return [];
  const nodes = getEpisodes(uuids);
  const byUuid = new Map(nodes.map((n) => [n.uuid, n]));
  return uuids.map((u) => byUuid.get(u)).filter((n): n is EpisodicNode => !!n);
}

function statementsOrdered(uuids: string[]): StatementNode[] {
  if (uuids.length === 0) return [];
  const nodes = getStatements(uuids); // current-filter applied by graph.ts
  const byUuid = new Map(nodes.map((n) => [n.uuid, n]));
  return uuids.map((u) => byUuid.get(u)).filter((n): n is StatementNode => !!n);
}

/** Merge episode arrays, deduplicating by UUID (REF mergeEpisodes). */
function mergeEpisodes(...arrays: EpisodicNode[][]): EpisodicNode[] {
  const map = new Map<string, EpisodicNode>();
  for (const ep of arrays.flat()) {
    if (!map.has(ep.uuid)) map.set(ep.uuid, ep);
  }
  return Array.from(map.values());
}

interface SqlParts {
  clauses: string[];
  params: unknown[];
}

/** Episode-level endUserIds/agentId filters (alias e). NULL excluded when set. */
function episodeScopeFilters(ctx: HandlerContext, parts: SqlParts): void {
  const endUserIds = ctx.options.endUserIds;
  if (endUserIds && endUserIds.length > 0) {
    const ph = endUserIds.map(() => "?").join(",");
    parts.clauses.push(`e.end_user_id IS NOT NULL AND e.end_user_id IN (${ph})`);
    parts.params.push(...endUserIds);
  }
  if (ctx.options.agentId) {
    parts.clauses.push("e.agent_id = ?");
    parts.params.push(ctx.options.agentId);
  }
}

/** JS re-application of the same scope filters for vector-sourced episodes. */
function episodeScopeJs(ctx: HandlerContext, eps: EpisodicNode[]): EpisodicNode[] {
  const endUserIds = ctx.options.endUserIds;
  let out = eps;
  if (endUserIds && endUserIds.length > 0) {
    const set = new Set(endUserIds);
    out = out.filter((e) => e.endUserId != null && set.has(e.endUserId));
  }
  if (ctx.options.agentId) {
    out = out.filter((e) => e.agentId === ctx.options.agentId);
  }
  return out;
}

/**
 * Temporal WHERE over statements (alias s): valid_at window OR the Event
 * event_date branch (REF searchV2.ts apoc.convert.fromJsonMap →
 * json_extract). ISO strings compared lexically; a date-only event_date
 * ("2026-09-01") still orders correctly against full ISO bounds.
 * Cypher→SQL fix: REF compares against $startTime even when null (which
 * silently yields no rows for 'before'-only windows) — here each bound is
 * emitted only when present.
 */
function statementTemporalFilter(
  startTime: string | undefined,
  endTime: string | undefined,
  parts: SqlParts,
): void {
  if (!startTime && !endTime) return;
  const main: string[] = [];
  const event: string[] = [
    "s.aspect = 'Event'",
    "COALESCE(json_extract(s.attributes, '$.event_date'), '') <> ''",
  ];
  if (startTime) {
    main.push("s.valid_at >= ?");
    event.push("json_extract(s.attributes, '$.event_date') >= ?");
  }
  if (endTime) {
    main.push("s.valid_at <= ?");
    event.push("json_extract(s.attributes, '$.event_date') <= ?");
  }
  parts.clauses.push(
    `((${main.join(" AND ")}) OR (${event.join(" AND ")}))`,
  );
  // params in emission order: main bounds, then event bounds
  if (startTime) parts.params.push(startTime);
  if (endTime) parts.params.push(endTime);
  if (startTime) parts.params.push(startTime);
  if (endTime) parts.params.push(endTime);
}

// ---------------------------------------------------------------------------
// Graph SQL (Cypher → SQL ports of neo4j/domains/searchV2.ts)
// ---------------------------------------------------------------------------

/** REF getEpisodesForAspect: episodes whose current statements match labels /
 *  aspects / temporal window. Over-fetches 2x (REF LIMIT maxEpisodes*2). */
function getEpisodesForAspect(
  ctx: HandlerContext,
  p: {
    labelIds: string[];
    aspects: string[];
    temporalStart?: string;
    temporalEnd?: string;
    maxEpisodes: number;
  },
): EpisodicNode[] {
  const parts: SqlParts = { clauses: [], params: [] };
  let joins = `JOIN edges pe ON pe.type = 'provenance' AND pe.from_uuid = e.uuid
    JOIN statements s ON s.uuid = pe.to_uuid`;
  if (p.labelIds.length > 0) {
    joins += `\n    JOIN episode_labels el ON el.episode_uuid = e.uuid`;
    parts.clauses.push(`el.label_id IN (${p.labelIds.map(() => "?").join(",")})`);
    parts.params.push(...p.labelIds);
  }
  episodeScopeFilters(ctx, parts);
  if (p.aspects.length > 0) {
    parts.clauses.push(`s.aspect IN (${p.aspects.map(() => "?").join(",")})`);
    parts.params.push(...p.aspects);
  }
  parts.clauses.push("(s.invalid_at IS NULL OR s.invalid_at > ?)");
  parts.params.push(now());
  statementTemporalFilter(p.temporalStart, p.temporalEnd, parts);

  const rows = getDb()
    .prepare(
      `SELECT e.uuid AS uuid, MAX(e.valid_at) AS ord FROM episodes e
    ${joins}
    WHERE ${parts.clauses.join(" AND ")}
    GROUP BY e.uuid ORDER BY ord DESC LIMIT ?`,
    )
    .all(...parts.params, p.maxEpisodes * 2) as { uuid: string }[];
  return episodesOrdered(rows.map((r) => r.uuid));
}

/** REF getEpisodesForEntities: episodes whose current statements touch the
 *  given entities as subject or object, newest statements first. */
function getEpisodesForEntities(
  ctx: HandlerContext,
  p: { entityUuids: string[]; maxEpisodes: number; aspects?: string[] },
): EpisodicNode[] {
  if (p.entityUuids.length === 0) return [];
  const parts: SqlParts = { clauses: [], params: [] };
  parts.clauses.push(
    `se.type IN ('subject','object') AND se.to_uuid IN (${p.entityUuids.map(() => "?").join(",")})`,
  );
  parts.params.push(...p.entityUuids);
  parts.clauses.push("(s.invalid_at IS NULL OR s.invalid_at > ?)");
  parts.params.push(now());
  if (p.aspects && p.aspects.length > 0) {
    parts.clauses.push(`s.aspect IN (${p.aspects.map(() => "?").join(",")})`);
    parts.params.push(...p.aspects);
  }
  episodeScopeFilters(ctx, parts);

  const rows = getDb()
    .prepare(
      `SELECT e.uuid AS uuid, MAX(s.valid_at) AS ord FROM edges se
    JOIN statements s ON s.uuid = se.from_uuid
    JOIN edges pe ON pe.type = 'provenance' AND pe.to_uuid = s.uuid
    JOIN episodes e ON e.uuid = pe.from_uuid
    WHERE ${parts.clauses.join(" AND ")}
    GROUP BY e.uuid ORDER BY ord DESC LIMIT ?`,
    )
    .all(...parts.params, p.maxEpisodes) as { uuid: string }[];
  return episodesOrdered(rows.map((r) => r.uuid));
}

/** REF getEpisodesForTemporal: time-windowed variant (start required). */
function getEpisodesForTemporal(
  ctx: HandlerContext,
  p: {
    labelIds: string[];
    aspects: string[];
    startTime: string;
    endTime?: string;
    maxEpisodes: number;
  },
): EpisodicNode[] {
  const parts: SqlParts = { clauses: [], params: [] };
  let joins = `JOIN edges pe ON pe.type = 'provenance' AND pe.from_uuid = e.uuid
    JOIN statements s ON s.uuid = pe.to_uuid`;
  statementTemporalFilter(p.startTime, p.endTime, parts);
  if (p.labelIds.length > 0) {
    joins += `\n    JOIN episode_labels el ON el.episode_uuid = e.uuid`;
    parts.clauses.push(`el.label_id IN (${p.labelIds.map(() => "?").join(",")})`);
    parts.params.push(...p.labelIds);
  }
  episodeScopeFilters(ctx, parts);
  if (p.aspects.length > 0) {
    parts.clauses.push(`s.aspect IN (${p.aspects.map(() => "?").join(",")})`);
    parts.params.push(...p.aspects);
  }
  parts.clauses.push("(s.invalid_at IS NULL OR s.invalid_at > ?)");
  parts.params.push(now());

  const rows = getDb()
    .prepare(
      `SELECT e.uuid AS uuid, MAX(e.valid_at) AS ord FROM episodes e
    ${joins}
    WHERE ${parts.clauses.join(" AND ")}
    GROUP BY e.uuid ORDER BY ord DESC LIMIT ?`,
    )
    .all(...parts.params, p.maxEpisodes) as { uuid: string }[];
  return episodesOrdered(rows.map((r) => r.uuid));
}

/** REF getStatementsConnectingEntities: current statements whose subject and
 *  object are BOTH in the resolved entity set (either direction). */
function getStatementsConnectingEntities(
  ctx: HandlerContext,
  p: { entityUuids: string[]; maxStatements: number },
): StatementNode[] {
  if (p.entityUuids.length < 2) return [];
  const ph = p.entityUuids.map(() => "?").join(",");
  const parts: SqlParts = { clauses: [], params: [] };
  parts.clauses.push(`sub.to_uuid IN (${ph})`);
  parts.params.push(...p.entityUuids);
  parts.clauses.push(`obj.to_uuid IN (${ph})`);
  parts.params.push(...p.entityUuids);
  parts.clauses.push("sub.to_uuid <> obj.to_uuid");
  parts.clauses.push("(s.invalid_at IS NULL OR s.invalid_at > ?)");
  parts.params.push(now());

  // Episode-scope filters run through the provenance edge (REF matches the
  // provenance episode and filters endUserId there).
  const endUserIds = ctx.options.endUserIds;
  if ((endUserIds && endUserIds.length > 0) || ctx.options.agentId) {
    const inner: string[] = [];
    if (endUserIds && endUserIds.length > 0) {
      inner.push(
        `e.end_user_id IS NOT NULL AND e.end_user_id IN (${endUserIds.map(() => "?").join(",")})`,
      );
    }
    if (ctx.options.agentId) inner.push("e.agent_id = ?");
    parts.clauses.push(
      `EXISTS (SELECT 1 FROM edges pe JOIN episodes e ON e.uuid = pe.from_uuid
        WHERE pe.type = 'provenance' AND pe.to_uuid = s.uuid AND ${inner.join(" AND ")})`,
    );
    if (endUserIds && endUserIds.length > 0) parts.params.push(...endUserIds);
    if (ctx.options.agentId) parts.params.push(ctx.options.agentId);
  }

  const rows = getDb()
    .prepare(
      `SELECT DISTINCT s.uuid AS uuid, s.valid_at AS ord FROM statements s
    JOIN edges sub ON sub.type = 'subject' AND sub.from_uuid = s.uuid
    JOIN edges obj ON obj.type = 'object' AND obj.from_uuid = s.uuid
    WHERE ${parts.clauses.join(" AND ")}
    ORDER BY s.valid_at DESC LIMIT ?`,
    )
    .all(...parts.params, p.maxStatements) as { uuid: string }[];
  return statementsOrdered(rows.map((r) => r.uuid));
}

// ---------------------------------------------------------------------------
// Vector paths
// ---------------------------------------------------------------------------

/**
 * Resolve entity hints to episodes via the entity namespace (REF
 * getEpisodesViaEntityHints): ≤5 hints, top-3 each at 0.65.
 */
async function getEpisodesViaEntityHints(
  entityHints: string[],
  ctx: HandlerContext,
  maxEpisodes: number,
): Promise<EpisodicNode[]> {
  if (entityHints.length === 0) return [];
  const hintsToSearch = entityHints.slice(0, ENTITY_HINTS_MAX);

  const entityUuidSets = await Promise.all(
    hintsToSearch.map(async (hint) => {
      try {
        const embedding = await getEmbedding(hint);
        if (!embedding?.length) return [];
        return vectorSearch("entity", embedding, {
          limit: ENTITY_HINT_TOP,
          threshold: ENTITY_HINT_THRESHOLD,
        }).map((r) => r.uuid);
      } catch (err) {
        logPathError(`entity-hint "${hint}"`, err);
        return [];
      }
    }),
  );

  const uniqueUuids = Array.from(new Set(entityUuidSets.flat()));
  if (uniqueUuids.length === 0) return [];
  return getEpisodesForEntities(ctx, { entityUuids: uniqueUuids, maxEpisodes });
}

/**
 * Fallback: raw episode-vector search when no labels matched (REF
 * getEpisodesViaVectorSearch, threshold 0.3). The vector layer has no metadata
 * filtering — endUserIds/agentId are re-applied in JS (house pattern).
 */
async function getEpisodesViaVectorSearch(
  query: string,
  ctx: HandlerContext,
  maxEpisodes: number,
): Promise<EpisodicNode[]> {
  if (!query) return [];
  const queryEmbedding = await getEmbedding(query);
  if (!queryEmbedding?.length) return [];
  const results = vectorSearch("episode", queryEmbedding, {
    limit: maxEpisodes * 2, // over-fetch; scope filters run below
    threshold: EPISODE_FALLBACK_THRESHOLD,
  });
  if (results.length === 0) return [];
  const eps = episodesOrdered(results.map((r) => r.uuid));
  return episodeScopeJs(ctx, eps).slice(0, maxEpisodes);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** aspect_query — the most common type. 3-path parallel merge. */
export async function handleAspectQuery(ctx: HandlerContext): Promise<EpisodicNode[]> {
  const labelIds = resolveLabelIds(ctx);
  const aspects = ctx.routerOutput.aspects;
  const { startTime, endTime } = getTemporalDateRange(ctx);
  const maxEpisodes = ctx.options.maxEpisodes || 20;

  const [labelEpisodes, entityEpisodes, vectorEpisodes] = await Promise.all([
    Promise.resolve()
      .then(() =>
        getEpisodesForAspect(ctx, {
          labelIds,
          aspects,
          temporalStart: startTime,
          temporalEnd: endTime,
          maxEpisodes,
        }),
      )
      .catch((err) => (logPathError("aspect_query label path", err), [] as EpisodicNode[])),
    getEpisodesViaEntityHints(ctx.routerOutput.entityHints, ctx, maxEpisodes).catch(
      (err) => (logPathError("aspect_query entity path", err), [] as EpisodicNode[]),
    ),
    labelIds.length === 0
      ? getEpisodesViaVectorSearch(ctx.options.query || "", ctx, maxEpisodes).catch(
          (err) => (logPathError("aspect_query vector path", err), [] as EpisodicNode[]),
        )
      : Promise.resolve([] as EpisodicNode[]),
  ]);

  return mergeEpisodes(labelEpisodes, entityEpisodes, vectorEpisodes);
}

type EntityLookupResult =
  | { mode: "attribute"; entities: EntityNode[] }
  | { mode: "broad"; episodes: EpisodicNode[]; entities: EntityNode[] };

/** entity_lookup — attribute mode (direct attributes) or broad (episodes). */
export async function handleEntityLookup(
  ctx: HandlerContext,
): Promise<EntityLookupResult | null> {
  const entityHints = ctx.routerOutput.entityHints;
  const lookupMode = ctx.routerOutput.lookupMode || "broad";
  const attributeHint = ctx.routerOutput.attributeHint;
  const maxEpisodes = Math.floor(ctx.options.maxEpisodes || 20);
  if (entityHints.length === 0) return null;

  // Step 1: resolve hints to entities via semantic vector search (0.7, top 5)
  const allEntities: EntityNode[] = [];
  for (const hint of entityHints) {
    try {
      const hintEmbedding = await getEmbedding(hint);
      if (!hintEmbedding?.length) continue;
      const hits = vectorSearch("entity", hintEmbedding, {
        limit: 5,
        threshold: ENTITY_LOOKUP_THRESHOLD,
      });
      const nodes = getEntities(hits.map((h) => h.uuid));
      allEntities.push(...nodes.filter((e) => e && e.uuid && e.name));
    } catch (err) {
      logPathError(`entity_lookup hint "${hint}"`, err);
    }
  }
  const entityMap = new Map<string, EntityNode>();
  for (const entity of allEntities) {
    if (!entityMap.has(entity.uuid)) entityMap.set(entity.uuid, entity);
  }
  const entities = Array.from(entityMap.values());
  if (entities.length === 0) return null;

  // ATTRIBUTE MODE: case-insensitive key match / substring (REF behavior);
  // falls through to broad when the attribute isn't on any entity.
  if (lookupMode === "attribute" && attributeHint) {
    let foundAttribute = false;
    for (const entity of entities) {
      const attrs = entity.attributes;
      if (!attrs || typeof attrs !== "object") continue;
      const attrKey = Object.keys(attrs).find(
        (k) =>
          k &&
          (k.toLowerCase() === attributeHint.toLowerCase() ||
            k.toLowerCase().includes(attributeHint.toLowerCase())),
      );
      if (attrKey && attrs[attrKey]) foundAttribute = true;
    }
    if (foundAttribute) return { mode: "attribute", entities };
  }

  // BROAD MODE: full entity context via episodes
  const aspects =
    ctx.routerOutput.aspects.length > 0 ? ctx.routerOutput.aspects : undefined;
  const episodes = getEpisodesForEntities(ctx, {
    entityUuids: entities.map((e) => e.uuid),
    maxEpisodes,
    aspects,
  });
  return { mode: "broad", episodes, entities };
}

/** temporal — default window last 7 days; 3-path merge with JS time filter on
 *  the entity/vector paths (their graph SQL doesn't apply the window). */
export async function handleTemporal(ctx: HandlerContext): Promise<EpisodicNode[]> {
  const labelIds = resolveLabelIds(ctx);
  const { startTime, endTime } = getTemporalDateRange(ctx);
  const limit = Math.floor(ctx.options.maxEpisodes || 10);
  const effectiveStart =
    startTime || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [labelEpisodes, entityEpisodes, vectorEpisodes] = await Promise.all([
    Promise.resolve()
      .then(() =>
        getEpisodesForTemporal(ctx, {
          labelIds,
          aspects: ctx.routerOutput.aspects,
          startTime: effectiveStart,
          endTime,
          maxEpisodes: limit,
        }),
      )
      .catch((err) => (logPathError("temporal label path", err), [] as EpisodicNode[])),
    getEpisodesViaEntityHints(ctx.routerOutput.entityHints, ctx, limit).catch(
      (err) => (logPathError("temporal entity path", err), [] as EpisodicNode[]),
    ),
    labelIds.length === 0
      ? getEpisodesViaVectorSearch(ctx.options.query || "", ctx, limit).catch(
          (err) => (logPathError("temporal vector path", err), [] as EpisodicNode[]),
        )
      : Promise.resolve([] as EpisodicNode[]),
  ]);

  // Lexical ISO time filter for the paths that didn't apply it
  const timeFilter = (ep: EpisodicNode) =>
    ep.createdAt >= effectiveStart && (!endTime || ep.createdAt <= endTime);

  return mergeEpisodes(
    labelEpisodes,
    entityEpisodes.filter(timeFilter),
    vectorEpisodes.filter(timeFilter),
  );
}

/** exploratory — session compacts from the documents table by label, plus the
 *  entity/vector paths. Documents map to type DOCUMENT episode nodes. */
export async function handleExploratory(ctx: HandlerContext): Promise<EpisodicNode[]> {
  const labelIds = resolveLabelIds(ctx);
  const maxSessions = ctx.options.maxEpisodes || 40;
  const endUserIds = ctx.options.endUserIds;

  const labelSessionsPromise = Promise.resolve().then(() => {
    const parts: SqlParts = { clauses: ["d.type = 'conversation'"], params: [] };
    let joins = "";
    if (labelIds.length > 0) {
      joins = `JOIN document_labels dl ON dl.document_id = d.id`;
      parts.clauses.push(`dl.label_id IN (${labelIds.map(() => "?").join(",")})`);
      parts.params.push(...labelIds);
    }
    if (endUserIds && endUserIds.length > 0) {
      parts.clauses.push(
        `d.end_user_id IN (${endUserIds.map(() => "?").join(",")})`,
      );
      parts.params.push(...endUserIds);
    }
    const rows = getDb()
      .prepare(
        `SELECT d.id AS id, d.content AS content, d.created_at AS createdAt,
                d.source AS source, d.session_id AS sessionId
         FROM documents d ${joins}
         WHERE ${parts.clauses.join(" AND ")}
         GROUP BY d.id ORDER BY d.updated_at DESC LIMIT ?`,
      )
      .all(...parts.params, maxSessions) as {
      id: string;
      content: string;
      createdAt: string;
      source: string | null;
      sessionId: string | null;
    }[];

    const labelStmt = getDb().prepare(
      "SELECT label_id FROM document_labels WHERE document_id = ?",
    );
    return rows.map(
      (doc): EpisodicNode => ({
        uuid: doc.id,
        content: doc.content,
        originalContent: doc.content,
        metadata: {},
        source: doc.source ?? "compaction",
        createdAt: doc.createdAt,
        validAt: doc.createdAt,
        labelIds: (labelStmt.all(doc.id) as { label_id: string }[]).map(
          (r) => r.label_id,
        ),
        sessionId: doc.sessionId ?? doc.id,
        type: "DOCUMENT", // passes through replaceWithCompacts unchanged
        userId: ctx.userId,
      }),
    );
  });

  const [labelEpisodes, entityEpisodes, vectorEpisodes] = await Promise.all([
    labelSessionsPromise.catch(
      (err) => (logPathError("exploratory label path", err), [] as EpisodicNode[]),
    ),
    getEpisodesViaEntityHints(ctx.routerOutput.entityHints, ctx, maxSessions).catch(
      (err) => (logPathError("exploratory entity path", err), [] as EpisodicNode[]),
    ),
    labelIds.length === 0
      ? getEpisodesViaVectorSearch(ctx.options.query || "", ctx, maxSessions).catch(
          (err) => (logPathError("exploratory vector path", err), [] as EpisodicNode[]),
        )
      : Promise.resolve([] as EpisodicNode[]),
  ]);

  return mergeEpisodes(labelEpisodes, entityEpisodes, vectorEpisodes);
}

/** relationship — needs ≥2 entity hints; returns connecting statements. */
export async function handleRelationship(ctx: HandlerContext): Promise<StatementNode[]> {
  const entityHints = ctx.routerOutput.entityHints;
  const limit = Math.floor(ctx.options.maxStatements || 50);
  if (entityHints.length < 2) return [];

  const entityUuidSets = await Promise.all(
    entityHints.slice(0, ENTITY_HINTS_MAX).map(async (hint) => {
      try {
        const embedding = await getEmbedding(hint);
        if (!embedding?.length) return [];
        return vectorSearch("entity", embedding, {
          limit: ENTITY_HINT_TOP,
          threshold: ENTITY_HINT_THRESHOLD,
        }).map((r) => r.uuid);
      } catch (err) {
        logPathError(`relationship hint "${hint}"`, err);
        return [];
      }
    }),
  );

  const entityUuids = Array.from(new Set(entityUuidSets.flat()));
  if (entityUuids.length < 2) return [];
  return getStatementsConnectingEntities(ctx, { entityUuids, maxStatements: limit });
}

// ---------------------------------------------------------------------------
// temporal_facets
// ---------------------------------------------------------------------------

/** REF aspectStore ALL_VOICE_ASPECTS — deliberately WITHOUT Task (kept). */
const FACET_VOICE_ASPECTS = [
  "Directive",
  "Preference",
  "Habit",
  "Belief",
  "Goal",
] as const;

const FACET_GRAPH_ASPECTS = [
  "Identity",
  "Knowledge",
  "Task",
  "Decision",
  "Event",
  "Problem",
  "Relationship",
] as const;

function getTopicsForFacets(
  ctx: HandlerContext,
  startTime: string,
  endTime?: string,
  limit = 20,
): { labelId: string; episodeCount: number }[] {
  const parts: SqlParts = { clauses: ["e.created_at >= ?"], params: [startTime] };
  if (endTime) {
    parts.clauses.push("e.created_at <= ?");
    parts.params.push(endTime);
  }
  episodeScopeFilters(ctx, parts);
  return getDb()
    .prepare(
      `SELECT el.label_id AS labelId, COUNT(DISTINCT e.uuid) AS episodeCount
       FROM episodes e JOIN episode_labels el ON el.episode_uuid = e.uuid
       WHERE ${parts.clauses.join(" AND ")}
       GROUP BY el.label_id ORDER BY episodeCount DESC LIMIT ?`,
    )
    .all(...parts.params, limit) as { labelId: string; episodeCount: number }[];
}

function getEntitiesForFacets(
  ctx: HandlerContext,
  startTime: string,
  endTime?: string,
  limit = 20,
): RecallEntityFacet[] {
  const parts: SqlParts = { clauses: ["s.valid_at >= ?"], params: [startTime] };
  if (endTime) {
    parts.clauses.push("s.valid_at <= ?");
    parts.params.push(endTime);
  }
  parts.clauses.push("(s.invalid_at IS NULL OR s.invalid_at > ?)");
  parts.params.push(now());
  episodeScopeFilters(ctx, parts);
  return getDb()
    .prepare(
      `SELECT ent.uuid AS entityUuid, ent.name AS entityName,
              COUNT(DISTINCT s.uuid) AS mentionCount
       FROM statements s
       JOIN edges pe ON pe.type = 'provenance' AND pe.to_uuid = s.uuid
       JOIN episodes e ON e.uuid = pe.from_uuid
       JOIN edges sub ON sub.type = 'subject' AND sub.from_uuid = s.uuid
       JOIN entities ent ON ent.uuid = sub.to_uuid
       WHERE ${parts.clauses.join(" AND ")} AND ent.name IS NOT NULL
       GROUP BY ent.uuid, ent.name ORDER BY mentionCount DESC LIMIT ?`,
    )
    .all(...parts.params, limit) as RecallEntityFacet[];
}

function getAspectsForFacets(
  ctx: HandlerContext,
  startTime: string,
  endTime: string | undefined,
  aspects: string[] | undefined,
): { aspect: string; statementCount: number; statements: { fact: string; validAt: string; episodeUuid: string }[] }[] {
  const aspectsToQuery =
    aspects && aspects.length > 0 ? aspects : [...FACET_GRAPH_ASPECTS];
  const db = getDb();
  const results: {
    aspect: string;
    statementCount: number;
    statements: { fact: string; validAt: string; episodeUuid: string }[];
  }[] = [];
  for (const aspect of aspectsToQuery) {
    const parts: SqlParts = {
      clauses: ["s.aspect = ?", "s.valid_at >= ?"],
      params: [aspect, startTime],
    };
    if (endTime) {
      parts.clauses.push("s.valid_at <= ?");
      parts.params.push(endTime);
    }
    parts.clauses.push("(s.invalid_at IS NULL OR s.invalid_at > ?)");
    parts.params.push(now());
    episodeScopeFilters(ctx, parts);
    // REF quirk kept: LIMIT 20 before count → statementCount caps at 20
    const rows = db
      .prepare(
        `SELECT s.fact AS fact, s.valid_at AS validAt, e.uuid AS episodeUuid
         FROM statements s
         JOIN edges pe ON pe.type = 'provenance' AND pe.to_uuid = s.uuid
         JOIN episodes e ON e.uuid = pe.from_uuid
         WHERE ${parts.clauses.join(" AND ")}
         GROUP BY s.uuid ORDER BY s.valid_at DESC LIMIT 20`,
      )
      .all(...parts.params) as { fact: string; validAt: string; episodeUuid: string }[];
    if (rows.length === 0) continue;
    results.push({ aspect, statementCount: rows.length, statements: rows });
  }
  return results;
}

/** Voice side of the facets — queried SEPARATELY from the graph store (the
 *  split is load-bearing: missing one silently loses half; SPEC-A §8.6). */
function getVoiceAspectsForTimeRange(
  startTime: string,
  endTime: string | undefined,
  aspects: string[] | undefined,
): { aspect: string; statementCount: number; statements: { fact: string; validAt: string; episodeUuids: string[] }[] }[] {
  const aspectsToQuery =
    aspects && aspects.length > 0 ? aspects : [...FACET_VOICE_ASPECTS];
  const db = getDb();
  const results: {
    aspect: string;
    statementCount: number;
    statements: { fact: string; validAt: string; episodeUuids: string[] }[];
  }[] = [];
  for (const aspect of aspectsToQuery) {
    const params: unknown[] = [aspect, startTime];
    let endClause = "";
    if (endTime) {
      endClause = "AND valid_at <= ?";
      params.push(endTime);
    }
    const rows = db
      .prepare(
        `SELECT fact, valid_at AS validAt, episode_uuids AS episodeUuids
         FROM voice_aspects
         WHERE aspect = ? AND valid_at >= ? ${endClause} AND invalid_at IS NULL
         ORDER BY valid_at DESC LIMIT 20`,
      )
      .all(...params) as { fact: string; validAt: string; episodeUuids: string }[];
    if (rows.length === 0) continue;
    results.push({
      aspect,
      statementCount: rows.length,
      statements: rows.map((r) => {
        let list: string[] = [];
        try {
          list = JSON.parse(r.episodeUuids) as string[];
        } catch {
          /* malformed json — leave empty */
        }
        return { fact: r.fact, validAt: r.validAt, episodeUuids: list };
      }),
    });
  }
  return results;
}

/** temporal_facets — enumerate topics/entities/aspects without episode content. */
export async function handleTemporalFacets(ctx: HandlerContext): Promise<RecallFacets> {
  const { startTime, endTime } = getTemporalDateRange(ctx);
  const effectiveStart =
    startTime || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const facetDimensions =
    ctx.routerOutput.facets?.length > 0
      ? ctx.routerOutput.facets
      : (["topics", "entities", "aspects"] as const);

  const requestedAspects = ctx.routerOutput.aspects;
  const voiceSet = new Set<string>(FACET_VOICE_ASPECTS);
  const requestedVoiceAspects = requestedAspects.filter((a) => voiceSet.has(a));
  const requestedGraphAspects = requestedAspects.filter((a) => !voiceSet.has(a));

  const topicsRaw = facetDimensions.includes("topics")
    ? getTopicsForFacets(ctx, effectiveStart, endTime)
    : null;
  const entitiesRaw = facetDimensions.includes("entities")
    ? getEntitiesForFacets(ctx, effectiveStart, endTime)
    : null;
  const aspectsRaw = facetDimensions.includes("aspects")
    ? getAspectsForFacets(
        ctx,
        effectiveStart,
        endTime,
        requestedGraphAspects.length > 0 ? requestedGraphAspects : undefined,
      )
    : null;
  const voiceAspectsRaw = facetDimensions.includes("aspects")
    ? getVoiceAspectsForTimeRange(
        effectiveStart,
        endTime,
        requestedVoiceAspects.length > 0 ? requestedVoiceAspects : undefined,
      )
    : [];

  // Resolve label names for topics
  let topics: RecallTopicFacet[] | undefined;
  if (topicsRaw) {
    const nameMap = new Map<string, string>();
    if (topicsRaw.length > 0) {
      const ph = topicsRaw.map(() => "?").join(",");
      const rows = getDb()
        .prepare(`SELECT id, name FROM labels WHERE id IN (${ph})`)
        .all(...topicsRaw.map((t) => t.labelId)) as { id: string; name: string }[];
      for (const r of rows) nameMap.set(r.id, r.name);
    }
    topics = topicsRaw.map((t) => ({
      labelId: t.labelId,
      labelName: nameMap.get(t.labelId) || t.labelId,
      episodeCount: t.episodeCount,
    }));
  }

  // Compact sessions for the top-10 labels, latest per label, truncated 2000
  const MAX_COMPACT_LENGTH = 2000;
  const TOP_LABELS_COUNT = 10;
  let compactSessions: { labelName: string; content: string }[] = [];
  if (topics && topics.length > 0) {
    const topLabelIds = [...topics]
      .sort((a, b) => b.episodeCount - a.episodeCount)
      .slice(0, TOP_LABELS_COUNT)
      .map((t) => t.labelId);

    const parts: SqlParts = {
      clauses: ["d.type = 'conversation'", "d.updated_at >= ?"],
      params: [effectiveStart],
    };
    parts.clauses.push(`dl.label_id IN (${topLabelIds.map(() => "?").join(",")})`);
    parts.params.push(...topLabelIds);
    const endUserIds = ctx.options.endUserIds;
    if (endUserIds && endUserIds.length > 0) {
      parts.clauses.push(`d.end_user_id IN (${endUserIds.map(() => "?").join(",")})`);
      parts.params.push(...endUserIds);
    }
    const docs = getDb()
      .prepare(
        `SELECT dl.label_id AS labelId, d.content AS content
         FROM documents d JOIN document_labels dl ON dl.document_id = d.id
         WHERE ${parts.clauses.join(" AND ")}
         ORDER BY d.updated_at DESC`,
      )
      .all(...parts.params) as { labelId: string; content: string }[];

    const latestByLabel = new Map<string, string>();
    for (const doc of docs) {
      if (!latestByLabel.has(doc.labelId)) latestByLabel.set(doc.labelId, doc.content ?? "");
    }
    const labelNameMap = new Map(topics.map((t) => [t.labelId, t.labelName]));
    compactSessions = Array.from(latestByLabel.entries()).map(([lid, content]) => ({
      labelName: labelNameMap.get(lid) ?? lid,
      content:
        content.length > MAX_COMPACT_LENGTH
          ? content.slice(0, MAX_COMPACT_LENGTH) + "…"
          : content,
    }));
  }

  // Aggregate stats + merged graph/voice aspect list (REF ordering)
  const totalEpisodes = topics?.reduce((sum, t) => sum + t.episodeCount, 0) ?? 0;
  const mergedAspects = [
    ...(aspectsRaw ?? []),
    ...voiceAspectsRaw.map((va) => ({
      aspect: va.aspect,
      statementCount: va.statementCount,
      statements: va.statements.map((s) => ({
        fact: s.fact,
        validAt: s.validAt,
        episodeUuid: s.episodeUuids[0] ?? "",
      })),
    })),
  ].sort((a, b) => b.statementCount - a.statementCount);
  const newFacts = mergedAspects.reduce((sum, a) => sum + a.statementCount, 0);
  const activeTopics = topics?.length ?? 0;

  const aspects: RecallAspectFacet[] = mergedAspects.map((a) => ({
    aspect: a.aspect as StatementAspect,
    statementCount: a.statementCount,
    statements: a.statements,
  }));

  return {
    topics,
    entities: entitiesRaw ?? undefined,
    aspects,
    compactSessions,
    stats: { totalEpisodes, newFacts, activeTopics },
    dateRange: { startTime: effectiveStart, endTime },
  };
}

// ---------------------------------------------------------------------------
// Post-processing: rerank, compacts, invalidated facts, voice search, budget
// ---------------------------------------------------------------------------

/**
 * Vector batchScore rerank (the built-in rerank — Cohere path skipped per port
 * map). DOCUMENT-type rows are scored against the compacted_session namespace
 * (their embeddings live there, not in the episode ns — without this the
 * vector rerank would silently drop every session compact).
 */
async function applyEpisodeReranking(
  episodes: EpisodicNode[],
  ctx: HandlerContext,
  options?: { threshold?: number },
): Promise<RankedEpisode[]> {
  const enableReranking = ctx.options.enableReranking !== false;
  const query = ctx.options.query;
  const maxEpisodes = ctx.options.maxEpisodes || 20;
  const threshold = options?.threshold ?? RERANK_KEEP_THRESHOLD;

  if (!enableReranking || !query || episodes.length <= 1) {
    return episodes.slice(0, maxEpisodes);
  }

  try {
    const queryEmbedding = await getEmbedding(query);
    if (!queryEmbedding?.length) return episodes.slice(0, maxEpisodes);

    const regularUuids = episodes.filter((e) => e.type !== "DOCUMENT").map((e) => e.uuid);
    const docUuids = episodes.filter((e) => e.type === "DOCUMENT").map((e) => e.uuid);
    const scores = batchScore("episode", queryEmbedding, regularUuids);
    const docScores = docUuids.length
      ? batchScore("compacted_session", queryEmbedding, docUuids)
      : new Map<string, number>();

    return episodes
      .map((ep) => ({
        ...ep,
        relevanceScore: scores.get(ep.uuid) ?? docScores.get(ep.uuid) ?? 0,
      }))
      .filter((ep) => (ep.relevanceScore ?? 0) >= threshold)
      .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
      .slice(0, maxEpisodes);
  } catch (err) {
    logPathError("episode rerank", err);
    return episodes.slice(0, maxEpisodes);
  }
}

/** Statement rerank via the statement namespace (REF Cohere → batchScore). */
async function applyStatementReranking(
  statements: StatementNode[],
  ctx: HandlerContext,
  options?: { threshold?: number },
): Promise<StatementNode[]> {
  const enableReranking = ctx.options.enableReranking !== false;
  const query = ctx.options.query;
  const maxStatements = ctx.options.maxStatements || 50;
  const threshold = options?.threshold ?? RERANK_KEEP_THRESHOLD;

  if (!enableReranking || !query || statements.length <= 1) {
    return statements.slice(0, maxStatements);
  }
  try {
    const queryEmbedding = await getEmbedding(query);
    if (!queryEmbedding?.length) return statements.slice(0, maxStatements);
    const scores = batchScore("statement", queryEmbedding, statements.map((s) => s.uuid));
    return statements
      .map((s) => ({ s, score: scores.get(s.uuid) ?? 0 }))
      .filter((x) => x.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxStatements)
      .map((x) => x.s);
  } catch (err) {
    logPathError("statement rerank", err);
    return statements.slice(0, maxStatements);
  }
}

/**
 * Replace runs of >2 episodes from one session with that session's compact
 * document (REF replaceWithCompacts): compact takes the FIRST episode's
 * position, carries the group's max relevance score and the union of the
 * episodes' labels. endUserIds re-filters the compact lookup so a compact
 * stamped with a different counterparty can't sneak in.
 */
function replaceWithCompacts(
  episodes: RankedEpisode[],
  ctx: HandlerContext,
): RecallEpisode[] {
  if (episodes.length === 0) return [];

  const sessionGroups = new Map<
    string,
    { episodes: RankedEpisode[]; highestScore: number; firstIndex: number }
  >();
  episodes.forEach((ep, index) => {
    if (ep.sessionId && ep.type !== "DOCUMENT") {
      if (!sessionGroups.has(ep.sessionId)) {
        sessionGroups.set(ep.sessionId, {
          episodes: [],
          highestScore: ep.relevanceScore || 0,
          firstIndex: index,
        });
      }
      const group = sessionGroups.get(ep.sessionId)!;
      group.episodes.push(ep);
      if ((ep.relevanceScore || 0) > group.highestScore) {
        group.highestScore = ep.relevanceScore || 0;
      }
    }
  });

  const compactMap = new Map<
    string,
    { id: string; content: string; createdAt: string }
  >();
  if (sessionGroups.size > 0) {
    const sessionIds = Array.from(sessionGroups.keys());
    const parts: SqlParts = {
      clauses: [
        "d.type = 'conversation'",
        `d.session_id IN (${sessionIds.map(() => "?").join(",")})`,
      ],
      params: [...sessionIds],
    };
    const endUserIds = ctx.options.endUserIds;
    if (endUserIds && endUserIds.length > 0) {
      parts.clauses.push(`d.end_user_id IN (${endUserIds.map(() => "?").join(",")})`);
      parts.params.push(...endUserIds);
    }
    const rows = getDb()
      .prepare(
        `SELECT d.id AS id, d.session_id AS sessionId, d.content AS content,
                d.created_at AS createdAt
         FROM documents d WHERE ${parts.clauses.join(" AND ")}`,
      )
      .all(...parts.params) as {
      id: string;
      sessionId: string;
      content: string;
      createdAt: string;
    }[];
    for (const r of rows) compactMap.set(r.sessionId, r);
  }

  const result: RecallEpisode[] = [];
  const processedSessions = new Set<string>();

  for (const ep of episodes) {
    const sessionId = ep.sessionId;
    const isDocument = ep.type === "DOCUMENT";

    if (sessionId && !isDocument) {
      if (processedSessions.has(sessionId)) continue; // compact already added

      const compactDoc = compactMap.get(sessionId);
      const group = sessionGroups.get(sessionId)!;

      // Only replace when > 2 episodes came from this session
      if (compactDoc && group.episodes.length >= COMPACT_REPLACE_MIN_EPISODES) {
        const sessionLabelIds = Array.from(
          new Set(group.episodes.flatMap((e) => e.labelIds || [])),
        );
        result.push({
          uuid: compactDoc.id,
          content: compactDoc.content,
          createdAt: compactDoc.createdAt,
          labelIds: sessionLabelIds,
          isCompact: true,
          relevanceScore: group.highestScore,
        });
        processedSessions.add(sessionId);
      } else {
        result.push({
          uuid: ep.uuid,
          content: ep.originalContent || ep.content,
          createdAt: ep.createdAt,
          labelIds: ep.labelIds || [],
          relevanceScore: ep.relevanceScore,
        });
      }
    } else {
      result.push({
        uuid: ep.uuid,
        content: ep.originalContent || ep.content,
        createdAt: ep.createdAt,
        labelIds: ep.labelIds || [],
        isDocument,
        relevanceScore: ep.relevanceScore,
      });
    }
  }
  return result;
}

/** Invalidated statements sourced from the returned episodes (A3 surfacing). */
function extractInvalidatedFactsFor(episodes: EpisodicNode[]): RecallInvalidatedFact[] {
  if (episodes.length === 0) return [];
  try {
    return getEpisodesInvalidFacts(episodes.map((e) => e.uuid)).map((s) => ({
      fact: s.fact,
      validAt: s.validAt,
      invalidAt: s.invalidAt,
      relevantScore: 0,
    }));
  } catch (err) {
    logPathError("invalidated facts", err);
    return [];
  }
}

/**
 * Voice-aspect vector search over the query (REF searchVoiceAspectsForQuery):
 * runs on ANY episode-returning query; router-named voice aspects filter the
 * results, otherwise the top matches across all voice aspects are kept.
 */
async function searchVoiceAspectsForQuery(
  ctx: HandlerContext,
): Promise<RecallVoiceAspect[]> {
  const query = ctx.options.query;
  if (!query) return [];
  try {
    const queryEmbedding = await getEmbedding(query);
    if (!queryEmbedding?.length) return [];

    // Over-fetch (validity filter runs in SQL below), keep REF's top 10 / 0.5
    const hits = vectorSearch("voice_aspect", queryEmbedding, {
      limit: 20,
      threshold: VOICE_SEARCH_THRESHOLD,
    });
    if (hits.length === 0) return [];

    const ph = hits.map(() => "?").join(",");
    const rows = getDb()
      .prepare(
        `SELECT uuid, fact, aspect FROM voice_aspects
         WHERE uuid IN (${ph}) AND invalid_at IS NULL`,
      )
      .all(...hits.map((h) => h.uuid)) as { uuid: string; fact: string; aspect: string }[];
    const byUuid = new Map(rows.map((r) => [r.uuid, r]));

    const results = hits
      .map((h) => {
        const row = byUuid.get(h.uuid);
        return row
          ? { uuid: row.uuid, fact: row.fact, aspect: row.aspect as VoiceAspect, score: h.score }
          : null;
      })
      .filter((r): r is RecallVoiceAspect & { score: number } => !!r)
      .slice(0, 10);

    const voiceAspectSet = new Set(VOICE_ASPECTS as readonly string[]);
    const requestedVoiceAspects = ctx.routerOutput.aspects.filter((a) =>
      voiceAspectSet.has(a),
    );
    return requestedVoiceAspects.length > 0
      ? results.filter((r) => (requestedVoiceAspects as string[]).includes(r.aspect))
      : results;
  } catch (err) {
    logPathError("voice aspect search", err);
    return [];
  }
}

/** Normalize a handler result to RecallResult (REF normalizeToRecallResult). */
function normalizeToRecallResult(
  handlerResult: {
    episodes?: RankedEpisode[];
    statements?: StatementNode[];
    entities?: EntityNode[];
  },
  ctx: HandlerContext,
): RecallResult {
  const rawEpisodes = handlerResult.episodes || [];
  const episodes = replaceWithCompacts(rawEpisodes, ctx);
  const invalidatedFacts = extractInvalidatedFactsFor(rawEpisodes);

  const statements: RecallResult["statements"] =
    handlerResult.statements?.map((s) => ({
      fact: s.fact,
      validAt: s.validAt,
      attributes: (s.attributes || {}) as Record<string, string>,
      aspect: s.aspect ?? null,
    })) || [];

  const entity: RecallResult["entity"] = handlerResult.entities?.[0]
    ? {
        uuid: handlerResult.entities[0].uuid,
        name: handlerResult.entities[0].name,
        attributes: (handlerResult.entities[0].attributes || {}) as Record<string, string>,
      }
    : null;

  return { episodes, invalidatedFacts, statements, entity };
}

/**
 * Token-budget trim: drop least-relevant episodes from the TAIL until total
 * content tokens fit (REF applyTokenBudget — order preserved, no mid-episode
 * cuts). Exported for index.ts and the smoke harness.
 */
export function applyTokenBudget<T extends { uuid: string; content: string }>(
  episodes: T[],
  budget: number = TOKEN_BUDGET_DEFAULT,
): { episodes: T[]; droppedCount: number; totalTokens: number } {
  if (episodes.length === 0) return { episodes: [], droppedCount: 0, totalTokens: 0 };

  const withTokens = episodes.map((ep) => ({ ep, tokens: countTokens(ep.content) }));
  let totalTokens = withTokens.reduce((sum, et) => sum + et.tokens, 0);
  if (totalTokens <= budget) return { episodes, droppedCount: 0, totalTokens };

  const kept = [...withTokens];
  let droppedCount = 0;
  while (totalTokens > budget && kept.length > 0) {
    const dropped = kept.pop()!;
    totalTokens -= dropped.tokens;
    droppedCount++;
  }
  return { episodes: kept.map((et) => et.ep), droppedCount, totalTokens };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Route to the appropriate handler and apply the post-chain (REF
 * routeToHandler): parallel voice search for episode-returning types, rerank,
 * compact replacement, invalidated-fact extraction.
 */
export async function routeToHandler(ctx: HandlerContext): Promise<RecallResult> {
  const { queryType } = ctx.routerOutput;

  switch (queryType) {
    case "entity_lookup": {
      const result = await handleEntityLookup(ctx).catch(
        (err) => (logPathError("entity_lookup", err), null),
      );
      if (result === null) return normalizeToRecallResult({}, ctx);

      if (result.mode === "attribute") {
        return normalizeToRecallResult({ entities: result.entities }, ctx);
      }

      const voiceAspects = await searchVoiceAspectsForQuery(ctx);
      const rerankedEpisodes = await applyEpisodeReranking(result.episodes, ctx);
      const broadResult = normalizeToRecallResult(
        { episodes: rerankedEpisodes, entities: result.entities },
        ctx,
      );
      if (voiceAspects.length > 0) broadResult.voiceAspects = voiceAspects;
      return broadResult;
    }

    case "temporal": {
      const [episodes, voiceAspects] = await Promise.all([
        handleTemporal(ctx).catch(
          (err) => (logPathError("temporal", err), [] as EpisodicNode[]),
        ),
        searchVoiceAspectsForQuery(ctx),
      ]);
      // Rerank only with a topic focus — pure date-range queries have no
      // semantic content to score against; sort by recency instead.
      const hasTopic =
        ctx.routerOutput.entityHints.length > 0 ||
        ctx.routerOutput.selectedLabels.length > 0 ||
        ctx.routerOutput.aspects.length > 0;
      const rerankedEpisodes = hasTopic
        ? await applyEpisodeReranking(episodes, ctx)
        : [...episodes]
            .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
            .slice(0, ctx.options.maxEpisodes || 10);
      const temporalResult = normalizeToRecallResult({ episodes: rerankedEpisodes }, ctx);
      if (voiceAspects.length > 0) temporalResult.voiceAspects = voiceAspects;
      return temporalResult;
    }

    case "temporal_facets": {
      const facets = await handleTemporalFacets(ctx);
      return { episodes: [], invalidatedFacts: [], statements: [], entity: null, facets };
    }

    case "exploratory": {
      const [episodes, voiceAspects] = await Promise.all([
        handleExploratory(ctx).catch(
          (err) => (logPathError("exploratory", err), [] as EpisodicNode[]),
        ),
        searchVoiceAspectsForQuery(ctx),
      ]);
      const rerankedEpisodes = await applyEpisodeReranking(episodes, ctx, {
        threshold: RERANK_EXPLORATORY_THRESHOLD,
      });
      const exploratoryResult = normalizeToRecallResult({ episodes: rerankedEpisodes }, ctx);
      if (voiceAspects.length > 0) exploratoryResult.voiceAspects = voiceAspects;
      return exploratoryResult;
    }

    case "relationship": {
      const statements = await handleRelationship(ctx).catch(
        (err) => (logPathError("relationship", err), [] as StatementNode[]),
      );
      const rerankedStatements = await applyStatementReranking(statements, ctx);
      return normalizeToRecallResult({ statements: rerankedStatements }, ctx);
    }

    case "aspect_query":
    default: {
      // Unknown types fall back to aspect_query (REF default branch)
      const [episodes, voiceAspects] = await Promise.all([
        handleAspectQuery(ctx).catch(
          (err) => (logPathError("aspect_query", err), [] as EpisodicNode[]),
        ),
        searchVoiceAspectsForQuery(ctx),
      ]);
      const rerankedEpisodes = await applyEpisodeReranking(episodes, ctx);
      const result = normalizeToRecallResult({ episodes: rerankedEpisodes }, ctx);
      if (voiceAspects.length > 0) result.voiceAspects = voiceAspects;
      return result;
    }
  }
}
