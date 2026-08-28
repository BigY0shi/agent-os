// SPEC-F K3.3 — scheduler registration on the REAL F2 scheduler.
//
// CONVENTIONS §2 deletes SPEC-F's croner fallback by name ("croner fallbacks
// (D, F)"), so there is none: the scheduler is a merged prerequisite and this
// registers against it directly. Handler kinds are registered at BOOT (no
// inline `run` closures — those do not survive DB rehydration), and the job row
// carries a deterministic id so re-registering on every boot upserts.
//
// The `newsletter.edition` job is NOT registered here: its handler (K4.1
// buildEdition) is chunk 4's task, and scheduling a job whose kind has no
// handler would emit a `job.failed` every single day. It lands with the builder.

import { readSettings } from "../../settings";
import { registerJobHandler, scheduleJob, removeJob } from "../scheduler";
import { gmailConfigured } from "./config";
import { isSyncRunning, syncOnce } from "./sync";

export const SYNC_JOB_KIND = "newsletter.sync";
export const SYNC_JOB_ID = "newsletter:sync";
export const DEFAULT_SYNC_RRULE = "FREQ=MINUTELY;INTERVAL=30";

declare global {
  // eslint-disable-next-line no-var
  var __agentosNewsletterJobs: boolean | undefined;
}

/** The configured RRULE, validated. An unparseable value is LOUD, never silent. */
export function syncRrule(): string {
  const raw = readSettings().newsletter?.syncRrule;
  if (typeof raw !== "string" || !raw.trim()) return DEFAULT_SYNC_RRULE;
  return raw.trim();
}

export function syncEnabled(): boolean {
  return readSettings().newsletter?.syncEnabled !== false;
}

/**
 * Boot entry (wired from boot.ts ensureV2). Idempotent: the handler map is a
 * Map.set and scheduleJob upserts on the deterministic id.
 */
export function ensureNewsletterJobs(): void {
  registerJobHandler(SYNC_JOB_KIND, async () => {
    if (!syncEnabled()) return; // master kill switch — SCHEDULED fires only
    if (isSyncRunning()) return; // overlap guard: skip, never queue
    if (!gmailConfigured()) {
      // Loudly-logged no-op (SPEC-F §5), not a thrown job failure: an
      // unconnected Gmail is a setup state, not a broken scheduler.
      console.warn(
        "[newsletter/jobs] scheduled sync skipped — no active Gmail account " +
          "(connect the agent account on /integrations; CONVENTIONS §7).",
      );
      return;
    }
    const result = await syncOnce("schedule");
    if (result.reason) console.warn(`[newsletter/jobs] sync: ${result.reason}`);
  });

  const rrule = syncRrule();
  try {
    scheduleJob({
      id: SYNC_JOB_ID,
      kind: SYNC_JOB_KIND,
      name: "Newsletter Gmail sync",
      rrule,
    });
  } catch (err) {
    // A bad RRULE in settings must SHOUT (project history: unparseable
    // schedules that silent-skipped). We register the default so syncing keeps
    // happening, and the error names the offending value.
    console.error(
      `[newsletter/jobs] settings.newsletter.syncRrule ('${rrule}') is not a valid RRULE — ` +
        `falling back to '${DEFAULT_SYNC_RRULE}'. Fix it in the Newsletter gear.`,
      err instanceof Error ? err.message : err,
    );
    scheduleJob({
      id: SYNC_JOB_ID,
      kind: SYNC_JOB_KIND,
      name: "Newsletter Gmail sync (default schedule — settings RRULE was invalid)",
      rrule: DEFAULT_SYNC_RRULE,
    });
  }
  globalThis.__agentosNewsletterJobs = true;
}

/** Used by the gear when the module is switched off entirely. */
export function removeNewsletterJobs(): void {
  removeJob(SYNC_JOB_ID);
}
