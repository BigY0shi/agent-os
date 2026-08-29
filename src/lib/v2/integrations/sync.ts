import { emit } from "../events";
import { tx } from "../db";
import { getConnector } from "./registry";
import {
  IntegrationError,
  finishSyncRun,
  getAccount,
  getAccountState,
  insertActivity,
  mergeAccountState,
  startSyncRun,
  type AccountRow,
} from "./store";
import { buildCallCtx } from "./runtime";
import { getActivePreFilters, applyPreFilters } from "./rules";
import { ingestActivity } from "./ingest";
import type { SyncResult, SyncRunRow } from "./types";

/**
 * SPEC-D G2.4 — the per-account sync driver. Watermark state is merged back
 * ONLY by the keys the connector returns; pre-filters reject deterministically
 * with a named reason; every accepted activity emits 'activity.created' on the
 * REAL bus and rides the ingest seam. One integration_sync_runs row per run,
 * error included. Sync failures are SOFT (decision 6): the run row records the
 * error, 'sync.failed' is emitted, nothing throws.
 */

declare global {
  // eslint-disable-next-line no-var
  var __agentosIntSyncInFlight: Set<string> | undefined;
}

function inFlight(): Set<string> {
  if (!globalThis.__agentosIntSyncInFlight) globalThis.__agentosIntSyncInFlight = new Set();
  return globalThis.__agentosIntSyncInFlight;
}

export function isSyncRunning(accountId: string): boolean {
  return inFlight().has(accountId);
}

export interface SyncOutcome {
  ok: boolean;
  running?: boolean; // overlap guard hit — nothing ran (watermarks mean nothing is lost)
  activitiesCount: number; // accepted (non-rejected) activities created
  rejectedCount: number;
  state?: Record<string, string>;
  error?: string;
}

/**
 * Apply one SyncResult (from sync OR webhook process) to an account:
 * pre-filter → activity rows → activity.created emits → ingest seam → state merge.
 */
export async function applySyncResult(
  account: AccountRow,
  result: SyncResult,
): Promise<{ accepted: number; rejected: number }> {
  const filters = getActivePreFilters(account.id);
  let accepted = 0;
  let rejected = 0;

  // Phase 1 — SYNCHRONOUS transaction: activity rows + watermark commit
  // together. Without this, a crash after inserts but before the state merge
  // leaves the watermark behind and the next run re-inserts the same
  // activities as duplicates (review finding, 2026-08-27). Emits and the
  // async ingest seam run AFTER commit so listeners only ever see
  // committed rows.
  //
  // Dedupe (hardening item 7): insertActivity returns null when the item's
  // dedupeKey already exists for this account (INSERT OR IGNORE) — the
  // duplicate is silently skipped, and crucially gets NO activity.created
  // emit and NO re-ingest (so overlap windows / crash replays / webhook
  // redeliveries can never double-trigger automations or memory).
  const acceptedRows = tx(() => {
    const rows: NonNullable<ReturnType<typeof insertActivity>>[] = [];
    for (const item of result.activities ?? []) {
      const verdict = applyPreFilters(item.text, filters);
      if (verdict.rejected) {
        insertActivity({
          accountId: account.id,
          text: item.text,
          sourceUrl: item.sourceURL,
          eventType: item.eventType,
          payload: item.payload,
          rejectionReason: verdict.reason,
          ingestStatus: "rejected",
          dedupeKey: item.dedupeKey,
        });
        rejected++;
        continue;
      }
      const row = insertActivity({
        accountId: account.id,
        text: item.text,
        sourceUrl: item.sourceURL,
        eventType: item.eventType,
        payload: item.payload,
        ingestStatus: "pending",
        dedupeKey: item.dedupeKey,
      });
      if (row) {
        rows.push(row);
        accepted++;
      }
    }
    // Watermark rule: merge ONLY the keys the connector returned.
    if (result.state && Object.keys(result.state).length > 0) {
      mergeAccountState(account.id, result.state);
    }
    return rows;
  });

  // Phase 2 — post-commit side effects.
  for (const row of acceptedRows) {
    emit(
      "activity.created",
      {
        activityId: row.id,
        accountId: account.id,
        slug: account.definitionSlug,
        eventType: row.eventType ?? null,
      },
      "integrations",
    );
    await ingestActivity(row, account); // never throws (marks 'failed' internally)
  }
  return { accepted, rejected };
}

/** Run one sync for one account. Overlap-guarded; soft-errored. */
export async function runAccountSync(
  accountId: string,
  trigger: SyncRunRow["trigger"],
): Promise<SyncOutcome> {
  if (isSyncRunning(accountId)) {
    return { ok: false, running: true, activitiesCount: 0, rejectedCount: 0 };
  }
  const account = getAccount(accountId);
  if (!account) throw new IntegrationError(`account ${accountId} not found`, 404);
  if (!account.isActive) throw new IntegrationError(`account ${accountId} is disconnected`, 409);
  const connector = getConnector(account.definitionSlug);
  if (!connector) throw new IntegrationError(`unknown connector '${account.definitionSlug}'`, 404);
  if (!connector.sync) {
    throw new IntegrationError(`connector '${account.definitionSlug}' has no sync`, 400);
  }

  inFlight().add(accountId);
  const runId = startSyncRun(accountId, trigger);
  try {
    const ctx = buildCallCtx(account);
    const result = await connector.sync({
      config: ctx.config,
      defConfig: ctx.defConfig,
      timezone: ctx.timezone,
      accountId: account.id, // G3: token-refresh persistence seam (googleClient)
      state: getAccountState(accountId),
    });
    const { accepted, rejected } = await applySyncResult(account, result);
    finishSyncRun(runId, { ok: true, activitiesCount: accepted });
    const state = getAccountState(accountId);
    return { ok: true, activitiesCount: accepted, rejectedCount: rejected, state };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    finishSyncRun(runId, { ok: false, error: message });
    emit(
      "sync.failed",
      { accountId, slug: account.definitionSlug, trigger, error: message },
      "integrations",
    );
    return { ok: false, activitiesCount: 0, rejectedCount: 0, error: message };
  } finally {
    inFlight().delete(accountId);
  }
}
