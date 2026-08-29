import { getDb } from "../../db";
import { readSettings } from "../../../settings";
import { getEmbedding } from "../embed";
import { search as vectorSearch } from "../vector";
import { modelCall } from "../llm";
import {
  LABEL_ROUTER_THRESHOLD,
  LABEL_SELECT_FALLBACK_THRESHOLD,
  ROUTER_CONFIDENCE_GATE,
  ROUTER_ERROR_CONFIDENCE,
} from "../constants";
import {
  AspectExtractionSchema,
  type AspectExtraction,
  type LabelMatch,
  type RouterOutput,
} from "../types";
import { buildAspectExtractionPrompt } from "../prompts/router";

/**
 * A4.1 — Search-V2 hybrid router. Port of REF
 * apps/webapp/app/services/search-v2/router.ts (routeIntent /
 * shouldProceedWithSearch / getMatchedLabelIds), Prisma+pgvector swapped for
 * our label vec-namespace + labels table. Single-user: no workspaceId.
 *
 * Flow: label vector match (threshold settings.memory.labelRouterThreshold,
 * default 0.7) → structured extractAspects LLM call (medium tier; BOTH prompt
 * variants with/without label matches kept, from prompts/router.ts) →
 * confidence gate (<0.2 or shouldSearch=false skips search entirely).
 * Extraction errors fall back to exploratory with confidence 0.3 — the search
 * still runs, un-scoped (REF behavior).
 */

const LABEL_SEARCH_LIMIT = 8; // REF searchLabels default limit

function labelThreshold(): number {
  return readSettings().memory?.labelRouterThreshold ?? LABEL_ROUTER_THRESHOLD;
}

/**
 * Vector search on the label namespace to find matching topics
 * (REF searchLabels — labels already have embeddings stored at create time).
 * Embedding failures (Ollama down) log and return [] — the router still runs.
 */
export async function searchLabels(
  intent: string,
  limit: number = LABEL_SEARCH_LIMIT,
): Promise<LabelMatch[]> {
  let intentEmbedding: number[];
  try {
    intentEmbedding = await getEmbedding(intent);
  } catch (err) {
    console.warn(
      "[v2/search/router] label embedding failed (continuing without labels):",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
  if (!intentEmbedding || intentEmbedding.length === 0) return [];

  const hits = vectorSearch("label", intentEmbedding, {
    limit,
    threshold: labelThreshold(),
  });
  if (hits.length === 0) return [];

  // Resolve label names from the labels table (vector ns only knows ids)
  const placeholders = hits.map(() => "?").join(",");
  const rows = getDb()
    .prepare(`SELECT id, name FROM labels WHERE id IN (${placeholders})`)
    .all(...hits.map((h) => h.uuid)) as { id: string; name: string }[];
  const nameMap = new Map(rows.map((r) => [r.id, r.name]));

  return hits.map((h) => ({
    labelId: h.uuid,
    labelName: nameMap.get(h.uuid) || h.uuid,
    score: h.score,
  }));
}

/** REF's error-fallback extraction (router.ts:280-292). */
function fallbackExtraction(): AspectExtraction {
  return {
    aspects: [],
    queryType: "exploratory",
    temporal: { type: "all", days: null, startDate: null, endDate: null },
    shouldSearch: true,
    entityHints: [],
    selectedLabels: [],
    lookupMode: "broad",
    attributeHint: null,
    facets: [],
    confidence: ROUTER_ERROR_CONFIDENCE,
  };
}

/**
 * Structured aspect-extraction LLM call (REF extractAspects). Medium tier —
 * this is the one LLM call per search. Errors return the exploratory fallback
 * (confidence 0.3) instead of throwing.
 */
export async function extractAspects(
  intent: string,
  matchedLabels: LabelMatch[] = [],
): Promise<AspectExtraction> {
  const systemPrompt = buildAspectExtractionPrompt(matchedLabels);
  try {
    return await modelCall(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Query: "${intent}"` },
      ],
      "medium",
      { schema: AspectExtractionSchema },
    );
  } catch (err) {
    console.warn(
      "[v2/search/router] aspect extraction failed, using exploratory fallback:",
      err instanceof Error ? err.message : err,
    );
    return fallbackExtraction();
  }
}

/**
 * Route an intent through the hybrid router: label vector match first, then
 * LLM aspect extraction with the matches as context (REF routeIntent).
 */
export async function routeIntent(intent: string): Promise<RouterOutput> {
  const startTime = Date.now();

  const matchedLabels = await searchLabels(intent);
  const extraction = await extractAspects(intent, matchedLabels);

  // Anti-hallucination: selectedLabels must be a subset of the matched label
  // names (the prompt demands it; enforce it — SPEC-A task A4.1).
  const matchedNames = new Set(matchedLabels.map((l) => l.labelName.toLowerCase()));
  const selectedLabels = (extraction.selectedLabels || []).filter((n) =>
    matchedNames.has(n.toLowerCase()),
  );

  return {
    matchedLabels,
    aspects: extraction.aspects,
    queryType: extraction.queryType,
    temporal: extraction.temporal,
    shouldSearch: extraction.shouldSearch,
    entityHints: extraction.entityHints,
    selectedLabels,
    lookupMode: extraction.lookupMode,
    attributeHint: extraction.attributeHint,
    facets: extraction.facets || [],
    confidence: extraction.confidence,
    routingTimeMs: Date.now() - startTime,
  };
}

/**
 * Gate: search only proceeds when the LLM said to AND confidence >= 0.2
 * (REF shouldProceedWithSearch).
 */
export function shouldProceedWithSearch(routerOutput: RouterOutput): boolean {
  if (!routerOutput.shouldSearch) return false;
  if (routerOutput.confidence < ROUTER_CONFIDENCE_GATE) return false;
  return true;
}

/**
 * Label ids from router output: LLM-selected names when present, else the
 * score-threshold fallback (default 0.5) (REF getMatchedLabelIds).
 */
export function getMatchedLabelIds(
  routerOutput: RouterOutput,
  threshold: number = LABEL_SELECT_FALLBACK_THRESHOLD,
): string[] {
  if (routerOutput.selectedLabels && routerOutput.selectedLabels.length > 0) {
    const selectedSet = new Set(
      routerOutput.selectedLabels.map((n) => n.toLowerCase()),
    );
    return routerOutput.matchedLabels
      .filter((l) => selectedSet.has(l.labelName.toLowerCase()))
      .map((l) => l.labelId);
  }
  return routerOutput.matchedLabels
    .filter((l) => l.score >= threshold)
    .map((l) => l.labelId);
}
