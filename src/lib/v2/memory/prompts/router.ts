import type { LabelMatch } from "../types";
import {
  ASPECT_DEFINITIONS,
  QUERY_TYPE_DEFINITIONS,
  StatementAspects,
} from "../types";

/**
 * A4.1 — Search-V2 router prompt (rule 17: prompts are data). Ported verbatim
 * from REF apps/webapp/app/services/search-v2/router.ts
 * buildAspectExtractionPrompt(): the labelsContext conditional yields TWO
 * prompt variants (with / without matched labels) — both kept, selected by the
 * matchedLabels argument exactly as upstream.
 *
 * The zod schema for the structured call is AspectExtractionSchema in
 * ../types.ts (already ported — reuse, do not duplicate).
 *
 * Cache keys: REF passes distinct cacheKeys per variant to its model layer.
 * Our llm.ts modelCall has no prompt cache (yet) — the keys are preserved
 * here as named exports so a future cache layer keys identically.
 */

export const ROUTER_CACHE_KEY_WITH_LABELS = "search-v2-router-with-labels";
export const ROUTER_CACHE_KEY_NO_LABELS = "search-v2-router";

export function routerCacheKey(matchedLabels: LabelMatch[]): string {
  return matchedLabels.length > 0
    ? ROUTER_CACHE_KEY_WITH_LABELS
    : ROUTER_CACHE_KEY_NO_LABELS;
}

/**
 * Build the aspect extraction prompt for the LLM.
 * @param matchedLabels Labels matched from vector search to provide context
 */
export function buildAspectExtractionPrompt(
  matchedLabels: LabelMatch[] = [],
): string {
  const aspectList = StatementAspects.map(
    (aspect) => `- **${aspect}**: ${ASPECT_DEFINITIONS[aspect]}`,
  ).join("\n");

  const queryTypeList = Object.entries(QUERY_TYPE_DEFINITIONS)
    .map(([type, desc]) => `- **${type}**: ${desc}`)
    .join("\n");

  // Add matched labels context if available
  const labelsContext =
    matchedLabels.length > 0
      ? `\n## Matched Topics (from vector search)
The following topics were matched for this query:
${matchedLabels.map((l) => `- **${l.labelName}** (score: ${l.score.toFixed(2)})`).join("\n")}

You MUST select which of these topics are relevant to the query and include them in selectedLabels. ONLY use the exact label names listed above.\n`
      : `\n## Matched Topics
No topics were matched from vector search. You MUST return selectedLabels as an empty array []. DO NOT invent or hallucinate any label names.\n`;

  return `You are a search query analyzer for a personal knowledge graph system. Your job is to extract structured information from natural language queries.
${labelsContext}
## Statement Aspects
The knowledge graph stores facts classified into these aspects:
${aspectList}

## Query Types
Classify the query into one of these types:
${queryTypeList}

## Entity Lookup Modes
For entity_lookup queries, determine the lookup mode:
- **attribute**: User wants a specific attribute (phone number, email, team, role, title, location, etc.)
- **broad**: User wants general information about the entity ("Who is X?", "Tell me about X", "anything about X")

## Output Format (STRICT)
Return a single JSON object with **exactly** these keys (do not rename fields):
- aspects: string[] (values must be from the Statement Aspects list above)
- queryType: string (must be one of the Query Types above)
- temporal: { type: "recent" | "range" | "before" | "after" | "all", days: number | null, startDate: string | null, endDate: string | null }
- shouldSearch: boolean
- entityHints: string[]
- selectedLabels: string[]
- lookupMode: "attribute" | "broad"
- attributeHint: string | null
- confidence: number (0 to 1)

## Instructions
Queries can be direct questions OR agent intent descriptions (e.g., "Need context about X to help with Y"). Handle both patterns.

1. Extract which aspects are relevant to the query
2. Classify the query type based on what information is needed (not how it's phrased)
3. Extract temporal information if mentioned (including implied recency like "recent", "catch up", "latest")
4. Identify entity names mentioned (can be people, projects, concepts, technologies)
5. Determine if this actually requires a memory search
${matchedLabels.length > 0 ? `6. Select which matched topics are relevant (output in selectedLabels). Only include topics that directly relate to the query intent. Use the exact label names provided above. DO NOT invent label names.` : `6. Since no topics were matched, return selectedLabels as an empty array []. DO NOT create or invent any label names.`}
7. For entity_lookup queries: set lookupMode to "attribute" if asking for specific attribute, "broad" otherwise. Set attributeHint to the attribute name if lookupMode is "attribute".

## Examples
${
  matchedLabels.length > 0
    ? `
(With matched topics: "Fitness Goals" (0.85), "Health Tracking" (0.72), "Work Projects" (0.45))
Query: "What are my fitness goals?"
→ aspects: ["Goal"], queryType: "aspect_query", temporal: {type: "all", ...}, entityHints: [], selectedLabels: ["Fitness Goals", "Health Tracking"], lookupMode: "broad", attributeHint: null, shouldSearch: true

(With matched topics: "Email Writing Style" (0.80), "Personal Finance" (0.58), "Persona" (0.54))
Query: "How do I write emails?"
→ aspects: ["Preference", "Knowledge"], queryType: "aspect_query", temporal: {type: "all", ...}, entityHints: [], selectedLabels: ["Email Writing Style"], lookupMode: "broad", attributeHint: null, shouldSearch: true
`
    : `
(No matched topics - selectedLabels MUST be empty array)
`
}
Query: "What are my fitness goals?"
→ aspects: ["Goal"], queryType: "aspect_query", temporal: {type: "all", days: null, startDate: null, endDate: null}, entityHints: [], selectedLabels: [], lookupMode: "broad", attributeHint: null, facets: [], shouldSearch: true

Query: "Need to understand what preferences and goals the user has for fitness tracking"
→ aspects: ["Preference", "Goal"], queryType: "aspect_query", temporal: {type: "all", days: null, startDate: null, endDate: null}, entityHints: ["fitness"], selectedLabels: [], lookupMode: "broad", attributeHint: null, facets: [], shouldSearch: true

Query: "What is John's phone number?"
→ aspects: ["Identity"], queryType: "entity_lookup", temporal: {type: "all", days: null, startDate: null, endDate: null}, entityHints: ["John"], selectedLabels: [], lookupMode: "attribute", attributeHint: "phone", facets: [], shouldSearch: true

Query: "John's email address?"
→ aspects: ["Identity"], queryType: "entity_lookup", temporal: {type: "all", days: null, startDate: null, endDate: null}, entityHints: ["John"], selectedLabels: [], lookupMode: "attribute", attributeHint: "email", facets: [], shouldSearch: true

Query: "What team does Sarah work on?"
→ aspects: ["Identity", "Relationship"], queryType: "entity_lookup", temporal: {type: "all", days: null, startDate: null, endDate: null}, entityHints: ["Sarah"], selectedLabels: [], lookupMode: "attribute", attributeHint: "team", facets: [], shouldSearch: true

Query: "Who is Sarah?"
→ aspects: ["Identity"], queryType: "entity_lookup", temporal: {type: "all", days: null, startDate: null, endDate: null}, entityHints: ["Sarah"], selectedLabels: [], lookupMode: "broad", attributeHint: null, facets: [], shouldSearch: true

Query: "anything about airbnb email"
→ aspects: ["Knowledge", "Habit"], queryType: "entity_lookup", temporal: {type: "all", days: null, startDate: null, endDate: null}, entityHints: ["airbnb email"], selectedLabels: [], lookupMode: "broad", attributeHint: null, facets: [], shouldSearch: true

Query: "Looking for information about Sarah to understand her role and background"
→ aspects: ["Identity", "Knowledge"], queryType: "entity_lookup", temporal: {type: "all", days: null, startDate: null, endDate: null}, entityHints: ["Sarah"], selectedLabels: [], lookupMode: "broad", attributeHint: null, facets: [], shouldSearch: true

Query: "What happened last week with the CORE project?"
→ aspects: ["Event", "Habit"], queryType: "temporal", temporal: {type: "recent", days: 7, startDate: null, endDate: null}, entityHints: ["CORE"], selectedLabels: [], lookupMode: "broad", attributeHint: null, facets: [], shouldSearch: true

Query: "Need recent context about CORE project activities to catch up on progress"
→ aspects: ["Habit", "Event", "Decision"], queryType: "temporal", temporal: {type: "recent", days: 7, startDate: null, endDate: null}, entityHints: ["CORE"], selectedLabels: [], lookupMode: "broad", attributeHint: null, facets: [], shouldSearch: true

Query: "What topics did I speak about last week?"
→ aspects: [], queryType: "temporal_facets", temporal: {type: "recent", days: 7, startDate: null, endDate: null}, entityHints: [], selectedLabels: [], lookupMode: "broad", attributeHint: null, facets: ["topics"], shouldSearch: true

Query: "Who are the people I spoke about this month?"
→ aspects: [], queryType: "temporal_facets", temporal: {type: "recent", days: 30, startDate: null, endDate: null}, entityHints: [], selectedLabels: [], lookupMode: "broad", attributeHint: null, facets: ["entities"], shouldSearch: true

Query: "What preferences were identified last week?"
→ aspects: ["Preference"], queryType: "temporal_facets", temporal: {type: "recent", days: 7, startDate: null, endDate: null}, entityHints: [], selectedLabels: [], lookupMode: "broad", attributeHint: null, facets: ["aspects"], shouldSearch: true

Query: "What decisions and goals came up last month?"
→ aspects: ["Decision", "Goal"], queryType: "temporal_facets", temporal: {type: "recent", days: 30, startDate: null, endDate: null}, entityHints: [], selectedLabels: [], lookupMode: "broad", attributeHint: null, facets: ["aspects"], shouldSearch: true

Query: "Give me an overview of last week — topics, people, and what I decided"
→ aspects: ["Decision"], queryType: "temporal_facets", temporal: {type: "recent", days: 7, startDate: null, endDate: null}, entityHints: [], selectedLabels: [], lookupMode: "broad", attributeHint: null, facets: ["topics", "entities", "aspects"], shouldSearch: true

Query: "Give me an overview of the last 7 days (2026-06-09 to 2026-06-16) — topics, people, and what was learned. Return topics with episode counts, entities with mention counts, and aspects grouped by type (Identity, Event, Task, Knowledge, Relationship, Decision, Problem)."
→ aspects: ["Identity", "Event", "Task", "Knowledge", "Relationship", "Decision", "Problem"], queryType: "temporal_facets", temporal: {type: "range", days: 7, startDate: "2026-06-09", endDate: "2026-06-16"}, entityHints: [], selectedLabels: [], lookupMode: "broad", attributeHint: null, facets: ["topics", "entities", "aspects"], shouldSearch: true

Query: "Weekly digest: last 7 days topics, people, decisions. Include any existing summaries already generated."
→ aspects: ["Decision", "Knowledge"], queryType: "temporal_facets", temporal: {type: "recent", days: 7, startDate: null, endDate: null}, entityHints: [], selectedLabels: [], lookupMode: "broad", attributeHint: null, facets: ["topics", "entities", "aspects"], shouldSearch: true

Query: "search implementation in CORE"
→ aspects: ["Knowledge", "Habit", "Decision"], queryType: "exploratory", temporal: {type: "all", days: null, startDate: null, endDate: null}, entityHints: ["search", "CORE"], selectedLabels: [], lookupMode: "broad", attributeHint: null, facets: [], shouldSearch: true

Query: "I need context about authentication implementation and security discussions to help review this PR"
→ aspects: ["Knowledge", "Habit", "Decision"], queryType: "exploratory", temporal: {type: "all", days: null, startDate: null, endDate: null}, entityHints: ["authentication", "security"], selectedLabels: [], lookupMode: "broad", attributeHint: null, facets: [], shouldSearch: true

Query: "How does John know Mike?"
→ aspects: ["Relationship"], queryType: "relationship", temporal: {type: "all", days: null, startDate: null, endDate: null}, entityHints: ["John", "Mike"], selectedLabels: [], lookupMode: "broad", attributeHint: null, facets: [], shouldSearch: true

Query: "Need to understand the connection between John and Mike for team planning"
→ aspects: ["Relationship"], queryType: "relationship", temporal: {type: "all", days: null, startDate: null, endDate: null}, entityHints: ["John", "Mike"], selectedLabels: [], lookupMode: "broad", attributeHint: null, facets: [], shouldSearch: true

Query: "Hello!"
→ aspects: [], queryType: "exploratory", temporal: {type: "all", days: null, startDate: null, endDate: null}, entityHints: [], selectedLabels: [], lookupMode: "broad", attributeHint: null, facets: [], shouldSearch: false

Query: "What's the weather like?"
→ aspects: [], queryType: "exploratory", temporal: {type: "all", days: null, startDate: null, endDate: null}, entityHints: [], selectedLabels: [], lookupMode: "broad", attributeHint: null, facets: [], shouldSearch: false`;
}
