import { timingSafeEqual } from "node:crypto";
import { emit } from "../events";
import { getConnector } from "./registry";
import {
  findAccountByExternalId,
  finishSyncRun,
  getDefinitionConfig,
  startSyncRun,
  type AccountRow,
} from "./store";
import { buildCallCtx } from "./runtime";
import { applySyncResult } from "./sync";
import type { WebhookInput } from "./types";

/**
 * SPEC-D G2.5 — webhook dispatch for /api/hooks/[slug] (§5.9). The route owns
 * the HTTP contract (raw-body-first read, unknown-slug 200, secret 401,
 * always-200 fire-and-forget); this module owns the IDENTIFY → accounts →
 * PROCESS flow, gated per account on autoActivityRead (upstream contract).
 * Connector-specific verification (Slack signing-secret HMAC over rawBody)
 * lands with G3.6 — checkWebhookSecret is the generic x-hook-secret gate.
 */

/** Generic secret gate: x-hook-secret must equal the definition's webhookSecret.
 *  Unconfigured secret = fail CLOSED (401) — a hook nobody set up accepts nothing. */
export function checkWebhookSecret(slug: string, headers: Record<string, string>): boolean {
  const expected = getDefinitionConfig(slug).webhookSecret;
  if (!expected) return false;
  const got = headers["x-hook-secret"] ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Run one connector's PROCESS for one account (activity path shared with sync). */
export async function runProcess(
  account: AccountRow,
  webhook: WebhookInput,
): Promise<{ accepted: number; rejected: number }> {
  const connector = getConnector(account.definitionSlug);
  if (!connector?.process) return { accepted: 0, rejected: 0 };
  const runId = startSyncRun(account.id, "webhook");
  try {
    const ctx = buildCallCtx(account);
    const result = await connector.process(webhook, {
      config: ctx.config,
      defConfig: ctx.defConfig,
      timezone: ctx.timezone,
      accountId: account.id, // G3: token-refresh persistence seam (googleClient)
    });
    const counts = await applySyncResult(account, result);
    finishSyncRun(runId, { ok: true, activitiesCount: counts.accepted });
    return counts;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    finishSyncRun(runId, { ok: false, error: message });
    emit(
      "sync.failed",
      { accountId: account.id, slug: account.definitionSlug, trigger: "webhook", error: message },
      "integrations",
    );
    return { accepted: 0, rejected: 0 };
  }
}

/** IDENTIFY → active accounts (autoActivityRead-gated) → PROCESS each. */
export async function dispatchWebhook(slug: string, webhook: WebhookInput): Promise<void> {
  const connector = getConnector(slug);
  if (!connector?.identify || !connector.process) return;
  let externalIds: string[] = [];
  try {
    externalIds = await connector.identify(webhook);
  } catch (err) {
    console.error(`[integrations/webhooks] ${slug} identify failed:`, err);
    return;
  }
  for (const externalId of externalIds) {
    const account = findAccountByExternalId(slug, externalId);
    if (!account || !account.isActive) continue;
    if (account.settings.autoActivityRead === false) continue; // upstream gate
    await runProcess(account, webhook);
  }
}
