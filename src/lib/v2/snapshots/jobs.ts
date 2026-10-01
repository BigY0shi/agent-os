// S37 Snapshots: the scheduled job and the status the gear shows.
//
// One system job on the real F2 scheduler, `core:snapshots` (kind `snapshots.take`), so it
// appears in Jarvis > Standing orders with its cadence, last and next run, and "Run it now"
// like the nightly DB backup. The RRULE follows settings.snapshots.cadence; "off" keeps the
// row but disables it (Standing orders shows it as held). The job is re-synced at boot,
// after every PATCH from the gear, and after every run, so a cadence change takes effect
// without a restart. Holding it in Standing orders lasts until the next sync.

import { readSettings } from "../../settings";
import { registerJobHandler, scheduleJob, listJobs, type JobRow } from "../scheduler";
import { CADENCE_RRULE, exclusionSummary, snapshotRootDir, snapshotSettings, snapshotSourceDir, type SnapshotSettings } from "./config";
import { applyRetention, listExiled, listSnapshots, takeSnapshot, type SnapshotSummary, type TakeResult } from "./take";

export const SNAPSHOT_JOB_KIND = "snapshots.take";
export const SNAPSHOT_JOB_ID = "core:snapshots";
export const SNAPSHOT_JOB_NAME = "Snapshot of Agent OS state";

declare global {
  // eslint-disable-next-line no-var
  var __agentosSnapshotRunning: boolean | undefined;
}

export function isSnapshotRunning(): boolean {
  return globalThis.__agentosSnapshotRunning === true;
}

export class SnapshotBusyError extends Error {
  status = 409;
  constructor() { super("a snapshot is already being taken; wait for it to finish"); }
}

/** Take a snapshot and apply retention, one at a time per process. Throws loudly. */
export async function takeSnapshotNow(reason: "schedule" | "manual"): Promise<TakeResult> {
  if (isSnapshotRunning()) throw new SnapshotBusyError();
  globalThis.__agentosSnapshotRunning = true;
  try {
    return await takeSnapshot(reason);
  } finally {
    globalThis.__agentosSnapshotRunning = false;
  }
}

/** The job row as settings.snapshots.cadence wants it (upsert; an unchanged rrule keeps run_at). */
export function syncSnapshotJob(settings: SnapshotSettings = snapshotSettings()): JobRow {
  const rrule = settings.cadence === "off" ? CADENCE_RRULE.weekly : CADENCE_RRULE[settings.cadence];
  return scheduleJob({
    id: SNAPSHOT_JOB_ID,
    kind: SNAPSHOT_JOB_KIND,
    name: SNAPSHOT_JOB_NAME,
    rrule,
    enabled: settings.cadence !== "off",
  });
}

export function snapshotJob(): JobRow | null {
  return listJobs().find((j) => j.id === SNAPSHOT_JOB_ID) ?? null;
}

/** Boot entry (boot.ts ensureV2). Idempotent. */
export function ensureSnapshotJobs(): void {
  registerJobHandler(SNAPSHOT_JOB_KIND, async () => {
    // Read per run: the cadence may have been switched off since the job was queued.
    if (snapshotSettings().cadence === "off") {
      console.warn("[snapshots] scheduled snapshot skipped: the cadence is Off in the Snapshots gear");
      syncSnapshotJob();
      return;
    }
    const r = await takeSnapshotNow("schedule");
    console.log(`[snapshots] ${r.snapshot.name}: ${r.snapshot.fileCount} files, ${r.snapshot.totalBytes} bytes${r.exiled.length ? `; exiled ${r.exiled.join(", ")}` : ""}`);
    syncSnapshotJob();
  });
  try {
    syncSnapshotJob();
  } catch (err) {
    console.error("[snapshots] could not register the snapshot job:", err instanceof Error ? err.message : err);
  }
}

export interface SnapshotStatus {
  settings: SnapshotSettings;
  source: string;
  root: string | null;
  rootError: string | null;
  running: boolean;
  job: null | { enabled: boolean; rrule: string | null; nextRunAt: string | null; lastRunAt: string | null; lastStatus: string | null; lastError: string | null };
  latest: SnapshotSummary | null;
  snapshots: SnapshotSummary[];
  exiled: { stamp: string; names: string[] }[];
  leavesOut: { always: string[]; secrets: string[] };
}

/** Everything the Snapshots card shows. Unknown stays null; nothing is estimated. */
export function snapshotStatus(): SnapshotStatus {
  const settings = snapshotSettings();
  let root: string | null = null;
  let rootError: string | null = null;
  try { root = snapshotRootDir(settings); } catch (err) { rootError = err instanceof Error ? err.message : String(err); }
  const snapshots = root ? listSnapshots(root) : [];
  const j = snapshotJob();
  return {
    settings,
    source: snapshotSourceDir(),
    root,
    rootError,
    running: isSnapshotRunning(),
    job: j ? { enabled: j.enabled === 1, rrule: j.rrule, nextRunAt: j.enabled === 1 ? j.run_at : null, lastRunAt: j.last_run_at, lastStatus: j.last_status, lastError: j.last_error } : null,
    latest: snapshots[0] ?? null,
    snapshots,
    exiled: root ? listExiled(root) : [],
    leavesOut: exclusionSummary(settings.includeSecrets),
  };
}

/** Retention on its own (the gear's keep-last-N was lowered). */
export async function pruneSnapshots(): Promise<string[]> {
  const settings = snapshotSettings();
  return applyRetention(snapshotRootDir(settings), settings.keep);
}

/** True when settings.snapshots exists in the file (the gear has been used at least once). */
export function snapshotsConfigured(): boolean {
  return typeof readSettings().snapshots === "object" && readSettings().snapshots !== null;
}
