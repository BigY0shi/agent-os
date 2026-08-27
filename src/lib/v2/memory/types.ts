import { z } from "zod";

/**
 * Memory V2 client-safe types (A1.1). NO node imports.
 * Ported from REF packages/types/src/graph/graph.entity.ts and
 * REF apps/webapp/app/services/search-v2/types.ts. Adaptations:
 *  - Date fields -> UTC ISO-8601 strings (repo timestamp convention, SPEC-A §2)
 *  - workspaceId dropped (single-user collapse); agentId added (CONVENTIONS §4)
 *  - zod v4 syntax (z.enum takes the readonly tuple directly)
 * The ASPECT_DEFINITIONS / QUERY_TYPE_DEFINITIONS texts are load-bearing prompt
 * material — kept verbatim from the reference.
 */

// ---------------------------------------------------------------------------
// Entity types (11) — REF graph.entity.ts EntityTypes
// ---------------------------------------------------------------------------

export const EntityTypes = [
  "Person",       // People: Sarah, John, Dr. Chen, Mike
  "Organization", // Companies/teams: Google, Red Planet, Design Team
  "Place",        // Locations: Bangalore, San Francisco, Office HQ
  "Event",        // Occurrences: React Conference, Q2 Planning, Sprint Review
  "Project",      // Work initiatives: CORE, MVP, Website Redesign
  "Task",         // Tracked items: CORE-123, Issue #456, TODO-789
  "Technology",   // Tools/frameworks: TypeScript, PostgreSQL, React, Neo4j
  "Product",      // Products/services: iPhone, Slack, ChatGPT, Figma
  "Standard",     // Methodologies: OAuth 2.0, REST API, Agile, SOLID
  "Concept",      // Abstract topics: Fat Loss, Code Review, Search Pipeline
  "Predicate",    // Relationships: "works at", "lives in", "manages"
] as const;

export type EntityType = (typeof EntityTypes)[number];

// ---------------------------------------------------------------------------
// Aspects (12) with the voice/graph split — REF graph.entity.ts
// 'Task' deliberately appears in BOTH lists (load-bearing upstream behavior).
// ---------------------------------------------------------------------------

export const StatementAspects = [
  "Identity",     // Who they are - role, location, affiliation (slow-changing)
  "Knowledge",    // What they know - expertise, skills, understanding
  "Belief",       // Why they think that way - values, opinions, reasoning
  "Preference",   // How they want things - likes, dislikes, style choices
  "Habit",        // What they do regularly - recurring behaviors, habits, routines
  "Goal",         // What they want to achieve - future targets, aims
  "Task",         // One-time commitments - follow-ups, promises, action items
  "Directive",    // Rules and automation - always do X, notify when Y, remind me to Z
  "Decision",     // Choices made, conclusions reached
  "Event",        // Specific occurrences with timestamps
  "Problem",      // Blockers, issues, challenges
  "Relationship", // Connections between people
] as const;

export type StatementAspect = (typeof StatementAspects)[number];

/** User's voice: stored WHOLE (never SPO) in the voice_aspects table. */
export const VOICE_ASPECTS = [
  "Directive",    // Standing rules: always do X, notify when Y
  "Preference",   // How they want things: likes, dislikes, style choices
  "Habit",        // Recurring behaviors: routines, patterns
  "Belief",       // Values, opinions, reasoning
  "Goal",         // Future targets, aims, aspirations
  "Task",         // One-time commitments: follow-ups, promises, action items
] as const;

export type VoiceAspect = (typeof VOICE_ASPECTS)[number];

/** User's world: stored as atomic SPO triples in the statements/edges tables. */
export const GRAPH_ASPECTS = [
  "Identity",     // Who they are: role, location, affiliation
  "Event",        // Specific occurrences with timestamps
  "Relationship", // Connections between people
  "Decision",     // Choices made, conclusions reached
  "Knowledge",    // Expertise, skills, understanding
  "Problem",      // Blockers, issues, challenges
  "Task",         // One-time commitments: follow-ups, promises, action items
] as const;

export type GraphAspect = (typeof GRAPH_ASPECTS)[number];

// ---------------------------------------------------------------------------
// Episode type
// ---------------------------------------------------------------------------

export const EpisodeType = {
  CONVERSATION: "CONVERSATION",
  DOCUMENT: "DOCUMENT",
  IMAGE: "IMAGE",
} as const;

export type EpisodeType = (typeof EpisodeType)[keyof typeof EpisodeType];

// ---------------------------------------------------------------------------
// LLM chat message (A2.1/A2.2) — replaces REF's `ModelMessage` from the "ai"
// SDK. Client-safe; consumed by llm.ts and every prompts/*.ts template fn.
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// ---------------------------------------------------------------------------
// Node interfaces — REF graph.entity.ts (Date -> ISO string)
// ---------------------------------------------------------------------------

export interface EpisodicNode {
  uuid: string;
  content: string;
  originalContent: string;
  metadata: Record<string, unknown>;
  source: string;
  createdAt: string;
  validAt: string;
  labelIds: string[];
  userId: string;

  /** Counterparty this episode is about (visitor, customer, contact). */
  endUserId?: string | null;
  /** Owning agent scope (CONVENTIONS §4 — NOT a counterparty). */
  agentId?: string | null;

  sessionId: string; // Required - groups chunks together
  queueId?: string | null;
  type?: EpisodeType;
  chunkIndex?: number | null;
  totalChunks?: number | null;

  version?: number;
  contentHash?: string | null;
  chunkHashes?: string[];

  recallCount?: number;
}

export interface EntityNode {
  uuid: string;
  name: string;
  type?: EntityType | null;
  attributes?: Record<string, unknown>;
  createdAt: string;
  userId: string;
}

export interface StatementNode {
  uuid: string;
  fact: string;
  createdAt: string;
  validAt: string;
  invalidAt: string | null;
  invalidatedBy?: string | null; // episode uuid that invalidated this statement
  attributes: Record<string, unknown>;
  userId: string;
  aspect?: StatementAspect | null;
}

export interface VoiceAspectNode {
  uuid: string;
  fact: string;                   // Complete statement as user expressed it
  aspect: VoiceAspect;
  userId: string;
  episodeUuids: string[];         // All episodes that mention/reinforce this aspect
  createdAt: string;
  validAt: string;
  invalidAt: string | null;
  invalidatedBy?: string | null;  // episode uuid that invalidated this
}

/** A triple connects subject/predicate/object entities via a statement node. */
export interface Triple {
  statement: StatementNode;
  subject: EntityNode;
  predicate: EntityNode;
  object: EntityNode;
  provenance: EpisodicNode;
}

export interface ExtractedTripleData {
  source: string;
  sourceType?: string;
  predicate: string;
  target: string;
  targetType?: string;
  fact: string;
  aspect?: StatementAspect | null;
  attributes?: Record<string, unknown>;
}

export type AddEpisodeParams = {
  episodeBody: string;
  originalEpisodeBody: string;
  referenceTime: string; // ISO
  metadata?: Record<string, unknown>;
  source: string;
  userId: string;
  userName?: string; // User's display name for user-centric extraction
  labelIds?: string[];
  sessionId: string;
  queueId: string;
  type?: EpisodeType;
  endUserId?: string;
  agentId?: string;

  chunkIndex?: number;
  totalChunks?: number;

  version?: number;
  contentHash?: string;
  chunkHashes?: string[];

  /** Set in preprocessing — episode already saved to graph (race-fix ordering). */
  episodeUuid?: string;
};

export type AddEpisodeResult = {
  episodeUuid: string | null;
  type: EpisodeType;
  statementsCreated: number;
  voiceAspectsCreated: number;
  processingTimeMs: number;
  totalChunks?: number;
  currentChunk?: number;
};

// ---------------------------------------------------------------------------
// Search V2 — REF apps/webapp/app/services/search-v2/types.ts
// ---------------------------------------------------------------------------

export const QueryTypes = [
  "entity_lookup", // Direct entity information lookup
  "aspect_query", // Filter by statement aspects (most common)
  "temporal", // Time-based queries (recent, last week, etc.)
  "temporal_facets", // Enumerate what exists in a time range (topics, people, aspects) without reading content
  "exploratory", // Open-ended exploration (what do you know about X)
  "relationship", // Connections between entities
] as const;

export type QueryType = (typeof QueryTypes)[number];

export const FacetDimensions = ["topics", "entities", "aspects"] as const;
export type FacetDimension = (typeof FacetDimensions)[number];

export const TemporalTypeSchema = z.enum([
  "recent", // Last N days
  "range", // Between start and end
  "before", // Before a date
  "after", // After a date
  "all", // No temporal filter
]);

export type TemporalType = z.infer<typeof TemporalTypeSchema>;

// Flat shape with .nullable() everywhere — tuned for strict structured output;
// keep the shape even for <output>-tag-parsing providers (SPEC-A §8.8).
export const TemporalFilterSchema = z.object({
  type: z.enum(["recent", "range", "before", "after", "all"]),
  days: z.number().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
});

export type TemporalFilter = z.infer<typeof TemporalFilterSchema>;

export const LookupModes = ["attribute", "broad"] as const;
export type LookupMode = (typeof LookupModes)[number];

/** Zod schema for the router's structured aspect-extraction LLM call. */
export const AspectExtractionSchema = z.object({
  aspects: z
    .array(z.enum(StatementAspects))
    .describe("Statement aspects relevant to this query"),

  queryType: z
    .enum(QueryTypes)
    .describe("Classification of the query type"),

  temporal: TemporalFilterSchema.describe(
    "Temporal filter extracted from the query",
  ),

  shouldSearch: z
    .boolean()
    .describe("Whether this query requires a memory search"),

  entityHints: z
    .array(z.string())
    .describe("Entity names mentioned in the query"),

  selectedLabels: z
    .array(z.string())
    .describe(
      "Label names from the matched topics that are relevant to this query. Only include labels that directly relate to the query intent.",
    ),

  facets: z
    .array(z.enum(FacetDimensions))
    .default([])
    .describe(
      "For temporal_facets queries: which dimensions to enumerate. Use ['topics'] for topic/label questions, ['entities'] for people/entity questions, ['aspects'] for preference/goal/decision questions. Can combine multiple. Empty for non-temporal_facets queries.",
    ),

  lookupMode: z
    .enum(LookupModes)
    .describe(
      "For entity_lookup queries: 'attribute' for specific attribute lookup (phone, email, etc.), 'broad' for general entity information",
    ),

  attributeHint: z
    .string()
    .nullable()
    .describe(
      "For entity_lookup with lookupMode='attribute': the specific attribute being asked for (e.g., 'phone', 'email', 'team', 'role'). Null for broad lookups.",
    ),

  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Confidence in the extraction (0-1)"),
});

export type AspectExtraction = z.infer<typeof AspectExtractionSchema>;

/** Label match from vector search */
export interface LabelMatch {
  labelId: string;
  labelName: string;
  score: number;
}

/** Combined router output (vector labels + LLM aspects) */
export interface RouterOutput {
  // From vector search on labels
  matchedLabels: LabelMatch[];

  // From LLM extraction
  aspects: StatementAspect[];
  queryType: QueryType;
  temporal: TemporalFilter;
  shouldSearch: boolean;
  entityHints: string[];
  selectedLabels: string[]; // Label names selected by LLM from matchedLabels
  lookupMode: LookupMode;
  attributeHint: string | null;
  facets: FacetDimension[];
  confidence: number;

  // Metadata
  routingTimeMs: number;
}

// ---------------------------------------------------------------------------
// Recall result shapes (ISO strings in place of upstream Date)
// ---------------------------------------------------------------------------

/** Unified episode row: regular episodes, compacted sessions (📦), documents (📄). */
export interface RecallEpisode {
  uuid: string;
  content: string;
  createdAt: string;
  labelIds: string[];
  isCompact?: boolean;
  isDocument?: boolean;
  relevanceScore?: number; // From reranking
}

export interface RecallInvalidatedFact {
  fact: string;
  validAt: string;
  invalidAt: string | null;
  relevantScore: number;
}

export interface RecallStatement {
  fact: string;
  validAt: string;
  attributes: Record<string, string>;
  aspect: StatementAspect | null;
}

export interface RecallEntity {
  uuid: string;
  name: string;
  attributes: Record<string, string>;
}

export interface RecallTopicFacet {
  labelId: string;
  labelName: string;
  episodeCount: number;
}

export interface RecallEntityFacet {
  entityUuid: string;
  entityName: string;
  mentionCount: number;
}

export interface RecallAspectFacet {
  aspect: StatementAspect;
  statementCount: number;
  statements: {
    fact: string;
    validAt: string;
    episodeUuid: string;
  }[];
}

export interface RecallFacetCompactSession {
  labelName: string;
  content: string;
}

export interface RecallFacetStats {
  totalEpisodes: number;
  newFacts: number;
  activeTopics: number;
}

export interface RecallFacets {
  topics?: RecallTopicFacet[];
  entities?: RecallEntityFacet[];
  aspects?: RecallAspectFacet[];
  compactSessions?: RecallFacetCompactSession[];
  stats?: RecallFacetStats;
  dateRange: {
    startTime: string;
    endTime?: string;
  };
}

export interface RecallVoiceAspect {
  uuid: string;
  fact: string;
  aspect: VoiceAspect;
  score?: number;
}

/** Main recall result interface (structured output). */
export interface RecallResult {
  episodes: RecallEpisode[];
  invalidatedFacts?: RecallInvalidatedFact[];
  statements?: RecallStatement[];
  voiceAspects?: RecallVoiceAspect[];
  entity?: RecallEntity | null;
  facets?: RecallFacets;
  /** Warning message (e.g. token budget exceeded for temporal queries). */
  warning?: string;
}

export interface SearchV2Options {
  /** Original query (for reranking). */
  query?: string;

  limit?: number;
  maxStatements?: number;
  maxEpisodes?: number;

  /** Token budget for recall output (default: TOKEN_BUDGET_DEFAULT).
   *  Drops least relevant episodes from tail until total tokens <= budget. */
  tokenBudget?: number;

  // Temporal filters (can be set directly or extracted by router) — ISO strings
  validAt?: string;
  startTime?: string;
  endTime?: string;

  /** Label filters (if already known, skip vector search). */
  labelIds?: string[];

  /** Counterparty scoping — every query path MUST thread these (SPEC-A §8.7). */
  endUserIds?: string[];

  /** Owning-agent scoping — episodes.agent_id filter (CONVENTIONS §4). */
  agentId?: string;

  /** true = RecallResult, false = markdown string. */
  structured?: boolean;

  sortBy?: "relevance" | "recency";

  enableFallback?: boolean;
  fallbackThreshold?: number; // Label match score threshold

  enableReranking?: boolean;

  /** Source tracking (e.g., "claude-code", "jarvis", "mcp"). */
  source?: string;
}

/** Handler context passed to query handlers. */
export interface HandlerContext {
  userId: string;
  routerOutput: RouterOutput;
  options: SearchV2Options;
}

export const FallbackStrategies = [
  "semantic_search", // Fall back to statement vector search
  "entity_bfs", // Fall back to BFS from entity hints
  "recent_episodes", // Fall back to recent episodes
  "none", // No fallback, return empty
] as const;

export type FallbackStrategy = (typeof FallbackStrategies)[number];

// ---------------------------------------------------------------------------
// LLM prompt definitions — VERBATIM from the reference (load-bearing text)
// ---------------------------------------------------------------------------

export const ASPECT_DEFINITIONS: Record<StatementAspect, string> = {
  Identity:
    "Who they are - role, location, affiliation (slow-changing facts about a person)",
  Knowledge: "What they know - expertise, skills, technical understanding",
  Belief: "Why they think that way - values, opinions, reasoning, worldview",
  Preference:
    "How they want things - likes, dislikes, style choices, preferences",
  Habit: "What they do regularly - recurring behaviors, habits, routines",
  Goal: "What they want to achieve - future targets, aims, objectives",
  Directive:
    "Rules and automation - always do X, notify when Y, remind me to Z",
  Decision: "Choices made, conclusions reached, determinations",
  Event:
    "Specific occurrences with timestamps - meetings, milestones, incidents",
  Problem: "Blockers, issues, challenges, obstacles, difficulties",
  Relationship: "Connections between people - who knows whom, team dynamics",
  Task: "Trackable units of work - todos, action items, deliverables",
};

export const QUERY_TYPE_DEFINITIONS: Record<QueryType, string> = {
  entity_lookup:
    "Direct lookup of entity information (e.g., 'Who is John?', 'Tell me about Project X', 'Need information about Sarah for context')",
  aspect_query:
    "Query filtered by statement aspects (e.g., 'What are my goals?', 'What does John prefer?', 'Need to understand user preferences for feature X')",
  temporal:
    "Time-based queries that retrieve episode content (e.g., 'What happened last week?', 'Recent updates', 'What did I work on last month?')",
  temporal_facets:
    "Enumerate what categories exist in a time range WITHOUT reading episode content (e.g., 'What topics did I speak about last week?', 'Who are the people I mentioned this month?', 'What preferences were identified last week?', 'What decisions were made recently?')",
  exploratory:
    "Open-ended exploration and context gathering (e.g., 'What do you know about me?', 'I need context about X to help with Y', 'Looking for information about authentication implementation')",
  relationship:
    "Connections between entities (e.g., 'How does John know Sarah?', 'Who works on Project X?', 'Need to understand connection between A and B')",
};
