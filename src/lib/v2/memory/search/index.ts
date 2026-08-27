import { getDb } from "../../db";
import { now } from "../../ids";
import { readSettings } from "../../../settings";
import { TOKEN_BUDGET_DEFAULT } from "../constants";
import type { HandlerContext, RecallResult, RouterOutput, SearchV2Options } from "../types";
import { routeIntent, shouldProceedWithSearch } from "./router";
import { applyTokenBudget, routeToHandler } from "./handlers";
import { formatRecallAsMarkdown } from "./formatter";

/**
 * A4.4 — searchV2() entry point. Port of REF search-v2/index.ts searchV2 plus
 * the V2-only path of services/agent/memory.ts searchMemoryWithAgent (the V1
 * memoryAgent fallback is skipped per port map — its query-decomposition
 * prompt is preserved separately if ever needed).
 *
 * Flow: router (label vector + LLM extraction) → confidence gate → handler
 * dispatch (handlers.ts post-chain: voice search, rerank, compacts,
 * invalidated facts) → token budget → recall_logs write + episode
 * recall_count bump → markdown or structured RecallResult.
 *
 * Single-user: userId 'owner'. endUserIds / agentId / labelIds / time filters
 * thread through EVERY path via HandlerContext (SPEC-A §8.7 — one miss leaks
 * counterparty memory).
 */

const EMPTY_RESULT: RecallResult = {
  episodes: [],
  invalidatedFacts: [],
  statements: [],
  entity: null,
};

function effectiveTokenBudget(options: SearchV2Options): number {
  return (
    options.tokenBudget ?? readSettings().memory?.tokenBudget ?? TOKEN_BUDGET_DEFAULT
  );
}

/**
 * Handler dispatch + post-processing for an already-routed query. Exported so
 * the smoke harness can exercise every handler with hand-built RouterOutput
 * objects (no LLM). Applies the token budget and bumps recall_count for the
 * returned graph episodes.
 */
export async function executeSearch(
  routerOutput: RouterOutput,
  options: SearchV2Options = {},
): Promise<RecallResult> {
  const ctx: HandlerContext = {
    userId: "owner",
    routerOutput,
    options: {
      ...options,
      enableFallback: options.enableFallback ?? true,
      enableReranking: options.enableReranking ?? true,
    },
  };

  let result = await routeToHandler(ctx);

  // Token budget: drop least-relevant episodes from the tail until under budget
  if (result.episodes.length > 0) {
    const budget = effectiveTokenBudget(options);
    const { episodes, droppedCount } = applyTokenBudget(result.episodes, budget);
    if (droppedCount > 0) {
      console.warn(
        `[v2/search] token budget dropped ${droppedCount} episode(s) (budget ${budget})`,
      );
    }
    result = { ...result, episodes };
  }

  // Bump recall_count for returned graph episodes (compact/document uuids
  // aren't in the episodes table — the WHERE IN simply skips them).
  if (result.episodes.length > 0) {
    try {
      const uuids = result.episodes
        .filter((e) => !e.isCompact && !e.isDocument)
        .map((e) => e.uuid);
      if (uuids.length > 0) {
        const ph = uuids.map(() => "?").join(",");
        getDb()
          .prepare(
            `UPDATE episodes SET recall_count = recall_count + 1 WHERE uuid IN (${ph})`,
          )
          .run(...uuids);
      }
    } catch (err) {
      console.warn(
        "[v2/search] recall_count bump failed (non-blocking):",
        err instanceof Error ? err.message : err,
      );
    }
  }

  return result;
}

/** recall_logs analytics row (REF logRecallEvent) — non-blocking. */
function logRecallEvent(params: {
  query: string;
  result: RecallResult;
  responseTimeMs: number;
  routerOutput: RouterOutput;
  options: SearchV2Options;
}): void {
  const { query, result, responseTimeMs, routerOutput, options } = params;
  try {
    const episodeCount = result.episodes.length;
    const statementCount = result.statements?.length || 0;
    const hasEntity = result.entity !== null && result.entity !== undefined;
    const totalResultCount = episodeCount + statementCount + (hasEntity ? 1 : 0);

    getDb()
      .prepare(
        `INSERT INTO recall_logs
           (query, query_type, search_method, result_count, response_time_ms, context, created_at)
         VALUES (?, ?, 'search_v2', ?, ?, ?, ?)`,
      )
      .run(
        query,
        routerOutput.queryType,
        totalResultCount,
        responseTimeMs,
        JSON.stringify({
          queryType: routerOutput.queryType,
          aspects: routerOutput.aspects,
          matchedLabels: routerOutput.matchedLabels.map((l) => l.labelName),
          selectedLabels: routerOutput.selectedLabels,
          entityHints: routerOutput.entityHints,
          temporal: routerOutput.temporal,
          confidence: routerOutput.confidence,
          routingTimeMs: routerOutput.routingTimeMs,
          episodeCount,
          statementCount,
          hasEntity,
          startTime: options.startTime ?? null,
          endTime: options.endTime ?? null,
          endUserIds: options.endUserIds ?? null,
          agentId: options.agentId ?? null,
          labelIds: options.labelIds ?? null,
          sortBy: options.sortBy ?? null,
          source: options.source ?? null,
        }),
        now(),
      );
  } catch (err) {
    console.warn(
      "[v2/search] recall_logs write failed (non-blocking):",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Main Search-V2 entry point.
 *
 * @returns markdown string, or the structured RecallResult when
 *          options.structured is true.
 */
export async function searchV2(
  query: string,
  options: SearchV2Options = {},
): Promise<RecallResult | string> {
  const startTime = Date.now();

  // Step 1: route the intent (label vector match + LLM extraction)
  const routerOutput = await routeIntent(query);

  // Step 2: confidence gate — no handler dispatch, no recall log (REF)
  if (!shouldProceedWithSearch(routerOutput)) {
    return options.structured ? EMPTY_RESULT : formatRecallAsMarkdown(EMPTY_RESULT);
  }

  // Step 3-4: handler dispatch + post-processing (query threads for rerank)
  const result = await executeSearch(routerOutput, { ...options, query });

  // Step 5: log recall event (non-blocking)
  logRecallEvent({
    query,
    result,
    responseTimeMs: Date.now() - startTime,
    routerOutput,
    options,
  });

  // Step 6: format output
  if (options.structured) return result;
  return formatRecallAsMarkdown(result, effectiveTokenBudget(options));
}

/**
 * Router output without executing the search (REF analyzeQuery) — debugging
 * and golden-set tooling.
 */
export async function analyzeQuery(query: string) {
  const routerOutput = await routeIntent(query);
  return {
    shouldSearch: shouldProceedWithSearch(routerOutput),
    matchedLabels: routerOutput.matchedLabels,
    queryType: routerOutput.queryType,
    aspects: routerOutput.aspects,
    temporal: routerOutput.temporal,
    entityHints: routerOutput.entityHints,
    confidence: routerOutput.confidence,
    routingTimeMs: routerOutput.routingTimeMs,
  };
}
