import { readSettings } from "../../settings";
import { registerJobHandler, scheduleJob, removeJob, cronToRrule } from "../scheduler";
import { getConnector } from "./registry";
import { listActiveAccounts, getAccount, type AccountRow } from "./store";
import { runAccountSync, isSyncRunning } from "./sync";

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
}
