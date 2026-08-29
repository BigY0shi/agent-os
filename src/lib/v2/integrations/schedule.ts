import { readSettings } from "../../settings";
import { registerJobHandler, scheduleJob, removeJob, cronToRrule } from "../scheduler";
import { getConnector } from "./registry";
import { listActiveAccounts, getAccount, listRetryableIngestFailures, type AccountRow } from "./store";
import { runAccountSync, isSyncRunning } from "./sync";
import { ingestActivity, INGEST_MAX_ATTEMPTS } from "./ingest";
import { sweepWebhookInbox } from "./webhooks";

/**
 * SPEC-D G2.8 — scheduling glue on the REAL V2 scheduler (no croner fallback;
 * CONVENTIONS §2). One deterministic job per active account whose connector
 * declares spec.schedule and whose settings.autoActivityRead !== false, honoring
 * the per-connector cron `spec.schedule.frequency` via cronToRrule (decision 5
 * — upstream hardcoded every-15-min). Handler kind 'integration.sync' is registered at
 * boot so jobs survive DB rehydration (no inline closures).
 *
 * Overlap guard: sync.ts's in-flight set — a fire while a sync runs is skipped
 * (watermark state means nothing is lost). Master kill switch
 * settings.integrations.syncEnabled gates SCHEDULED fires only (manual sync
 * always runs).
 */

export const SYNC_JOB_KIND = "integration.sync";
export const INGEST_RETRY_JOB_KIND = "integration.ingest.retry";

export function syncJobId(accountId: string): string {
  return `integration-sync:${accountId}`;
}

/**
 * Reconcile the schedule job for ONE account: registers it when the account is
 * active + connector has a schedule + autoActivityRead is on; removes it
 * otherwise (deactivate/disconnect path — G2.8 "unregister on account
 * deactivate"). Call after connect, account PATCH, and DELETE.
 */
export function ensureAccountSyncJob(account: AccountRow): void {
  const connector = getConnector(account.definitionSlug);
  const frequency = connector?.spec.schedule?.frequency;
  const wanted =
    !!frequency && account.isActive && account.settings.autoActivityRead !== false;
  if (!wanted) {
    removeJob(syncJobId(account.id));
    return;
  }
  scheduleJob({
    id: syncJobId(account.id),
    kind: SYNC_JOB_KIND,
    name: `sync ${account.definitionSlug} (${account.displayName ?? account.accountId})`,
    rrule: cronToRrule(frequency),
    payload: { accountId: account.id },
  });
}

export function removeAccountSyncJob(accountId: string): void {
  removeJob(syncJobId(accountId));
}

/**
 * Boot entry (wired from boot.ts ensureV2): registers the handler kind and
 * reconciles jobs for every active account. Idempotent — scheduleJob upserts
 * on the deterministic id.
 */
export function ensureIntegrationSync(): void {
  registerJobHandler(SYNC_JOB_KIND, async (payload) => {
    const accountId = typeof payload.accountId === "string" ? payload.accountId : "";
    if (!accountId) return;
    if (readSettings().integrations?.syncEnabled === false) return; // master kill switch
    if (isSyncRunning(accountId)) return; // overlap guard — skip, don't queue
    const account = getAccount(accountId);
    if (!account || !account.isActive) {
      // Account vanished/deactivated out from under the job — clean up.
      removeAccountSyncJob(accountId);
      return;
    }
    await runAccountSync(accountId, "schedule"); // soft-errors internally
  });

  // HARDENING-2026-08-27 item 8: activities whose memory enqueue failed used
  // to stay ingest_status='failed' forever. Hourly sweep re-attempts them
  // (attempt cap INGEST_MAX_ATTEMPTS, counted in activities.ingest_attempts).
  // The webhook-inbox sweep (item 11) rides the same tick as a belt to the
  // boot-time sweep below.
  registerJobHandler(INGEST_RETRY_JOB_KIND, async () => {
    await retryFailedIngests();
    await sweepWebhookInbox();
  });
  scheduleJob({
    id: "integration:ingest-retry",
    kind: INGEST_RETRY_JOB_KIND,
    name: "Retry failed integration ingests",
    rrule: "FREQ=HOURLY",
  });

  for (const account of listActiveAccounts()) {
    try {
      ensureAccountSyncJob(account);
    } catch (err) {
      // cronToRrule throws loudly on unsupported shapes — surface, don't die.
      console.error(
        `[integrations/schedule] could not schedule sync for account ${account.id}:`,
        err,
      );
    }
  }

  // Item 11 boot sweep: webhook deliveries persisted before their 200 but
  // never dispatched (crash) get re-processed now. Async — never blocks boot.
  void sweepWebhookInbox().catch((err) =>
    console.error("[integrations/schedule] webhook inbox boot sweep failed:", err),
  );
}

/** One retry pass over failed ingest rows (exported for the smoke). */
export async function retryFailedIngests(): Promise<number> {
  let retried = 0;
  for (const activity of listRetryableIngestFailures(INGEST_MAX_ATTEMPTS)) {
    const account = getAccount(activity.accountId);
    if (!account || !account.isActive) continue; // account gone — leave the row
    await ingestActivity(activity, account); // settles 'ingested' or failed+attempts++
    retried++;
  }
  return retried;
}
