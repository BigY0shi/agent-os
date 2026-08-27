import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { ensureDb, dbPath } from "./db";
import { ensureV2Scheduler, registerJobHandler, scheduleJob } from "./scheduler";
import { ensureMemoryQueue } from "./memory/queue";
import { registerTaskWakeHandler } from "./tasks/recurrence";

/**
 * V2 foundations boot — called once from instrumentation register().
 * Idempotent via globalThis flag. Never throws (a broken foundation must not
 * take the whole app down; it logs loudly instead).
 */

declare global {
  // eslint-disable-next-line no-var
  var __agentosV2Booted: boolean | undefined;
}

const BACKUP_KEEP = 14;

function registerCoreJobs(): void {
  // F1.6 nightly backup. Push-to-.99 is a stub hook (network creds out of scope here).
  registerJobHandler("db.backup", async () => {
    const db = ensureDb();
    const dir = path.join(os.homedir(), ".agentic-os", "backups");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const dest = path.join(dir, `agentos-${stamp}.db`);
    await db.backup(dest);

    // Retention: keep newest BACKUP_KEEP, exile (never delete) the rest.
    const snaps = fs
      .readdirSync(dir)
      .filter((f) => /^agentos-\d{8}\.db$/.test(f))
      .sort()
      .reverse();
    if (snaps.length > BACKUP_KEEP) {
      const exileDir = path.join(
        os.homedir(),
        ".agentic-os",
        ".exile",
        new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-"),
      );
      fs.mkdirSync(exileDir, { recursive: true });
      for (const old of snaps.slice(BACKUP_KEEP)) {
        fs.renameSync(path.join(dir, old), path.join(exileDir, old));
      }
    }
    // TODO(.99 backup transport): rsync/scp the newest snapshot to the homelab box.
  });

  scheduleJob({
    id: "core:db-backup",
    kind: "db.backup",
    name: "Nightly DB backup",
    rrule: "FREQ=DAILY;BYHOUR=3;BYMINUTE=30",
  });
}

export function ensureV2(): void {
  if (globalThis.__agentosV2Booted) return;
  try {
    ensureDb();
    registerCoreJobs();
    registerTaskWakeHandler(); // SPEC-B B1: wake jobs survive restarts, handler re-registers at boot
    ensureV2Scheduler();
    ensureMemoryQueue(); // A2.4: drains PENDING ingestion_queue rows (5s poll)
    globalThis.__agentosV2Booted = true;
    console.log(`[v2] foundations booted (db: ${dbPath()})`);
  } catch (err) {
    console.error("[v2] FOUNDATIONS BOOT FAILED — v2 features unavailable:", err);
  }
}
