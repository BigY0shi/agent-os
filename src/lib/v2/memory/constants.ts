/**
 * Memory V2 numeric thresholds (A1.1). Every value verified against the
 * reference repo (AgentOSCore) — the REF file:line is cited per constant.
 * Similarity scores are cosine similarity in [0,1] (sim = 1 - vec0 distance).
 */

// ---- Router (A4.1) ----

/** Label-namespace vector match threshold for the router's candidate labels.
 *  REF apps/webapp/app/env.server.ts:211 SEARCH_LABEL_VECTOR_THRESHOLD default 0.7 */
export const LABEL_ROUTER_THRESHOLD = 0.7;

/** Router gate: skip search entirely when extraction confidence is below this.
 *  REF apps/webapp/app/services/search-v2/router.ts:352 (confidence < 0.2) */
export const ROUTER_CONFIDENCE_GATE = 0.2;

/** Confidence stamped on the router's error-fallback (exploratory) output.
 *  REF apps/webapp/app/services/search-v2/router.ts:290 */
export const ROUTER_ERROR_CONFIDENCE = 0.3;

/** getMatchedLabelIds score fallback when the LLM named no labels.
 *  REF apps/webapp/app/services/search-v2/router.ts:365 (threshold = 0.5) */
export const LABEL_SELECT_FALLBACK_THRESHOLD = 0.5;

// ---- Search handlers (A4.2/A4.3) ----

/** Entity-hint resolution: entity-ns vector threshold per hint.
 *  REF apps/webapp/app/services/search-v2/handlers.ts:184 (and :675) */
export const ENTITY_HINT_THRESHOLD = 0.65;

/** Max entity hints embedded per query (slice(0, 5)).
 *  REF apps/webapp/app/services/search-v2/handlers.ts:173 (and :667) */
export const ENTITY_HINTS_MAX = 5;

/** Entity-ns KNN top-k per hint (limit: 3).
 *  REF apps/webapp/app/services/search-v2/handlers.ts:182 */
export const ENTITY_HINT_TOP = 3;

/** entity_lookup handler: entity-ns semantic threshold.
 *  REF apps/webapp/app/services/search-v2/handlers.ts:360 */
export const ENTITY_LOOKUP_THRESHOLD = 0.7;

/** Raw episode-vector fallback threshold (only when no labels matched).
 *  REF apps/webapp/app/services/search-v2/handlers.ts:236 */
export const EPISODE_FALLBACK_THRESHOLD = 0.3;

/** Rerank keep threshold (drop below this after batchScore rerank).
 *  REF apps/webapp/app/services/search-v2/handlers.ts:772 and :845 (?? 0.1) */
export const RERANK_KEEP_THRESHOLD = 0.1;

/** Rerank keep threshold for the exploratory handler.
 *  REF apps/webapp/app/services/search-v2/handlers.ts:1565 */
export const RERANK_EXPLORATORY_THRESHOLD = 0.2;

/** Parallel voice-aspect search threshold during recall.
 *  REF apps/webapp/app/services/search-v2/handlers.ts:1404 */
export const VOICE_SEARCH_THRESHOLD = 0.5;

/** replaceWithCompacts: minimum episodes from one session before the compact
 *  replaces them (upstream `group.episodes.length > 2`, i.e. >= 3).
 *  REF apps/webapp/app/services/search-v2/handlers.ts:956 */
export const COMPACT_REPLACE_MIN_EPISODES = 3;

/** Token budget applied to recall episodes (drop tail until under budget).
 *  REF apps/webapp/app/services/search/tokenBudget.ts:8 DEFAULT_TOKEN_BUDGET */
export const TOKEN_BUDGET_DEFAULT = 10000;

// ---- Ingestion / resolution (A2) ----

/** Related-memories context fetch during ingest (episode ns).
 *  REF apps/webapp/app/services/knowledgeGraph.server.ts:853 (minSimilarity ?? 0.75) */
export const RELATED_MEMORIES_THRESHOLD = 0.75;

/** Session context window: last N episodes of the same session fed to ingest.
 *  REF apps/webapp/app/services/knowledgeGraph.server.ts:66 DEFAULT_EPISODE_WINDOW */
export const SESSION_EPISODE_WINDOW = 5;

/** Entity dedupe candidate threshold (graph-resolution).
 *  REF apps/webapp/app/jobs/ingest/graph-resolution.logic.ts:597 */
export const ENTITY_DEDUPE_THRESHOLD = 0.7;

/** Statement semantic-similarity candidate threshold (graph-resolution).
 *  REF apps/webapp/app/jobs/ingest/graph-resolution.logic.ts:882 */
export const STATEMENT_SIMILAR_THRESHOLD = 0.7;

/** Voice aspect same-aspect similarity threshold (aspect-resolution).
 *  REF apps/webapp/app/jobs/ingest/aspect-resolution.logic.ts:85 */
export const VOICE_SIMILAR_THRESHOLD = 0.75;

/** Label semantic-match ladder threshold (exact -> 0.85 semantic -> create).
 *  REF apps/webapp/app/jobs/labels/label-assignment.logic.ts:22 LABEL_SIMILARITY_THRESHOLD */
export const LABEL_SEMANTIC_MATCH_THRESHOLD = 0.85;

// ---- Prompts (A2.2) ----

/** Name substituted where REF interpolates a userName into ingestion prompts.
 *  Single-user install — the owner. (A6.1 persona synthetics reuse this.) */
export const DEFAULT_USER_NAME = "Yoshi";

// ---- Chunker (A2.3) ----
// REF apps/webapp/app/services/episodeChunker.server.ts:41-44

/** Text above this token count gets chunked (maxChunkSize). */
export const CHUNK_MAX_TOKENS = 1800;
/** Target tokens per chunk (targetChunkSize). */
export const CHUNK_TARGET_TOKENS = 1250;
/** Minimum tokens per chunk (minChunkSize). */
export const CHUNK_MIN_TOKENS = 750;
/** Minimum paragraph size considered for boundaries (minParagraphSize). */
export const CHUNK_MIN_PARAGRAPH_TOKENS = 100;
