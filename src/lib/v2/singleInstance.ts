import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * One machine, one Agent OS.
 *
 * Two server processes share ~/.agentic-os/agentos.db and agents/approvals.json
 * with no locking, and approvals.json is written read-modify-write: process A
 * appends a card, process B rewrites the whole file from its own stale copy, and
 * the card is gone. The run behind it then waits forever on an in-memory promise
 * that no HTTP request can reach — the POST that would resolve it may land in
 * the other process, which has no such promise and reports a clean success.
 *
 * The port does not protect us. On 2026-08-29 two servers held 3737 at once: one
 * bound 0.0.0.0 (IPv4), one bound :: (IPv6). Different address families, so the
 * second bind never raised EADDRINUSE and nothing looked wrong from the outside.
 *
 * Liveness is a HEARTBEAT, not a PID check. PIDs get recycled, and a recycled
 * PID would make a healthy boot refuse to start — a worse outage than the bug
 * being fixed here. Only a running Agent OS refreshes this file, so a recent
 * heartbeat is positive proof the holder really is one of us; a stale one means
 * the holder died and the lock is free for the taking.
 */

const BEAT_MS = 15_000;
/** Four missed beats. Generous on purpose: a false "still alive" only delays a
 *  restart by a minute, while a false "it's dead" resurrects the split brain. */
const STALE_MS = 60_000;

export interface InstanceLock {
  pid: number;
  startedAt: number;
  heartbeat: number;
  /** Which server this was, for the log line that tells a human what to kill. */
  argv?: string;
}

/** Resolved per call — smokes point AGENTIC_OS_LOCK at a temp file, mirroring
 *  the AGENTIC_OS_DB / AGENTIC_OS_AGENTS_DIR overrides used elsewhere. */
function lockPath(): string {
  const override = process.env.AGENTIC_OS_LOCK?.trim();
  return override || path.join(os.homedir(), ".agentic-os", "agentos.lock");
}

export function readLock(): InstanceLock | null {
  try {
    const l = JSON.parse(fs.readFileSync(lockPath(), "utf8")) as InstanceLock;
    return typeof l?.pid === "number" ? l : null;
  } catch {
    return null;
  }
}

/**
 * The live holder of the lock, or null when this process is free to run —
 * because the lock is absent, already ours (a re-entrant boot), or stale.
 */
export function liveHolder(now = Date.now()): InstanceLock | null {
  const l = readLock();
  if (!l) return null;
  if (l.pid === process.pid) return null;
  if (now - (l.heartbeat ?? 0) >= STALE_MS) return null;
  return l;
}

function writeLock(startedAt: number): void {
  try {
    const p = lockPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const lock: InstanceLock = {
      pid: process.pid,
      startedAt,
      heartbeat: Date.now(),
      argv: process.argv.slice(1).join(" "),
    };
    fs.writeFileSync(p, JSON.stringify(lock, null, 1), "utf8");
  } catch {
    // A lock we cannot write is a guard we do not get. Never fatal: failing to
    // take the lock must not be worse than never having had one.
  }
}

/**
 * Take the lock and keep it warm.
 *
 * There is deliberately NO release-on-exit handler. A clean shutdown and a hard
 * crash would then behave differently, and the crash path — the one that
 * actually matters — would be the one never exercised. Letting the heartbeat go
 * stale is a single code path that covers both.
 */
export function claimLock(): void {
  const startedAt = Date.now();
  writeLock(startedAt);
  const beat = setInterval(() => writeLock(startedAt), BEAT_MS);
  // Never be the reason the process stays alive.
  if (typeof beat.unref === "function") beat.unref();
}

/**
 * Guard for server boot: returns the live holder when THIS process must not run,
 * or null after successfully claiming the lock.
 */
export function checkSingleInstance(): InstanceLock | null {
  const holder = liveHolder();
  if (holder) return holder;
  claimLock();
  return null;
}
