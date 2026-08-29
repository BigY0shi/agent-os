import { ingestFromModule } from "../memory/queue";
import { markActivityIngestFailed, setActivityIngestStatus, type AccountRow } from "./store";
import type { ActivityRow } from "./types";

/** Hardening item 8: 'failed' rows are retried by the hourly
 *  'integration.ingest.retry' scheduler job until this attempt cap. */
export const INGEST_MAX_ATTEMPTS = 5;

/**
 * SPEC-D G2.4 — the Memory V2 ingest seam for accepted activities.
 *
 * UNTRUSTED-CONTENT FRAMING (SPEC-D §8.11): activity text is third-party
 * content (emails, Slack messages, webhook payloads). The framing that makes
 * it safe downstream is the LABEL `integration:<slug>` — CONVENTIONS §9.4's
 * recall-taint gate in the Jarvis brain keys on EXACTLY that label shape
 * (recall carrying integration:*-labeled episodes forces approval on
 * destructive/spawning actions). DO NOT change the label shape, and DO NOT
 * strip it: it is the security boundary, not decoration. metadata.untrusted
 * is an additive marker for future consumers; the label is the contract.
 *
 * ingest_status semantics: 'ingested' means QUEUED into Memory V2's
 * ingestion_queue (the pipeline settles it from there); 'failed' means the
 * enqueue itself failed and a retry is safe.
 */
export async function ingestActivity(
  activity: ActivityRow,
  account: AccountRow,
): Promise<void> {
  const slug = account.definitionSlug;
  try {
    await ingestFromModule({
      episodeBody: activity.text,
      source: `integration:${slug}`,
      sourceURL: activity.sourceUrl ?? undefined,
      labelNames: [`integration:${slug}`], // §9.4 taint contract — exact shape
      metadata: {
        accountId: account.id,
        externalAccountId: account.accountId,
        activityId: activity.id,
        untrusted: true,
        ...(activity.eventType ? { eventType: activity.eventType } : {}),
      },
    });
    setActivityIngestStatus(activity.id, "ingested");
  } catch (err) {
    console.error(`[integrations/ingest] enqueue failed for activity ${activity.id}:`, err);
    markActivityIngestFailed(activity.id); // status 'failed' + attempts++ (item 8)
  }
}
