// SPEC-F K3.3 — scheduler registration on the REAL F2 scheduler.
//
// CONVENTIONS §2 deletes SPEC-F's croner fallback by name ("croner fallbacks
// (D, F)"), so there is none: the scheduler is a merged prerequisite and this
// registers against it directly. Handler kinds are registered at BOOT (no
// inline `run` closures — those do not survive DB rehydration), and the job row
// carries a deterministic id so re-registering on every boot upserts.
//
// `newsletter.edition` IS registered here as of chunk 4 (K4.1): chunk 3 left it
// out on purpose because its handler did not exist yet, and scheduling a job
// whose kind has no handler emits a `job.failed` every single day. The handler
// now exists (edition.ts buildEdition), so the job lands with it.

import { readSettings } from "../../settings";
import { registerJobHandler, scheduleJob, removeJob } from "../scheduler";
import { gmailConfigured } from "./config";
import { buildEdition } from "./edition";
import { today } from "./store";
import { isSyncRunning, syncOnce } from "./sync";

export const SYNC_JOB_KIND = "newsletter.sync";
export const SYNC_JOB_ID = "newsletter:sync";
export const DEFAULT_SYNC_RRULE = "FREQ=MINUTELY;INTERVAL=30";

export const EDITION_JOB_KIND = "newsletter.edition";
export const EDITION_JOB_ID = "newsletter:edition";
export const DEFAULT_EDITION_TIME = "06:30";

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

export function editionEnabled(): boolean {
  return readSettings().newsletter?.editionEnabled !== false;
}

/**
 * `settings.newsletter.editionTime` ("HH:MM", local) → a daily RRULE. An
 * unparseable value is LOUD and falls back to the default — never a silent skip
 * (the project's natural-language-schedule bug class).
 */
export function editionRrule(): string {
  const raw = readSettings().newsletter?.editionTime;
  const value = typeof raw === "string" ? raw.trim() : "";
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  const h = m ? Number(m[1]) : NaN;
  const min = m ? Number(m[2]) : NaN;
  if (!m || !Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) {
    if (value) {
      console.error(
        `[newsletter/jobs] settings.newsletter.editionTime ('${value}') is not HH:MM — ` +
          `falling back to ${DEFAULT_EDITION_TIME}. Fix it in the Newsletter gear.`,
      );
    }
    const [dh, dm] = DEFAULT_EDITION_TIME.split(":");
    return `FREQ=DAILY;BYHOUR=${Number(dh)};BYMINUTE=${Number(dm)}`;
  }
  return `FREQ=DAILY;BYHOUR=${h};BYMINUTE=${min}`;
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
  // ── K4.1 — the daily edition build ────────────────────────────────────────
  registerJobHandler(EDITION_JOB_KIND, async (payload) => {
    if (!editionEnabled()) return; // kill switch — SCHEDULED builds only
    const date = typeof payload?.date === "string" && payload.date.trim() ? payload.date.trim() : today();
    // NOT forced: the idempotency guard means a day that already has an
    // edition is left exactly as it was read.
    const result = await buildEdition(date);
    if (result.classification === "fallback") {
      console.warn(
        `[newsletter/jobs] edition ${date} was sectioned by FALLBACK (the model call failed): ` +
          `${result.classificationError ?? "unknown reason"}`,
      );
    }
  });

  scheduleJob({
    id: EDITION_JOB_ID,
    kind: EDITION_JOB_KIND,
    name: "Newsletter daily edition",
    rrule: editionRrule(),
  });

  globalThis.__agentosNewsletterJobs = true;
}

/** Used by the gear when the module is switched off entirely. */
export function removeNewsletterJobs(): void {
  removeJob(SYNC_JOB_ID);
  removeJob(EDITION_JOB_ID);
}
