import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import DatabaseCtor, { type Database } from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { MIGRATIONS } from "./dbSchema";

/**
 * THE single opener for agentos.db (CONVENTIONS §1.2): no other module may open
 * this file, with any driver. Never call getDb() at module import time — only
 * inside instrumentation register() or request handlers (CONVENTIONS §1.3).
 */

declare global {
  // eslint-disable-next-line no-var
  var __agentosDb: Database | undefined;
}

export function dbPath(): string {
  const override = process.env.AGENTIC_OS_DB;
  if (override && override.trim()) return override.trim();
  return path.join(os.homedir(), ".agentic-os", "agentos.db");
}

function open(): Database {
  const file = dbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseCtor(file);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  sqliteVec.load(db);
  migrate(db);
  return db;
}

function migrate(db: Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );`);
  const applied = new Set(
    (db.prepare("SELECT version FROM migrations").all() as { version: number }[]).map(
      (r) => r.version,
    ),
  );
  const pending = MIGRATIONS.filter((m) => !applied.has(m.version)).sort(
    (a, b) => a.version - b.version,
  );
  for (const m of pending) {
    const run = db.transaction(() => {
      m.up(db);
      db.prepare(
        "INSERT INTO migrations(version, name, applied_at) VALUES (?, ?, ?)",
      ).run(m.version, m.name, new Date().toISOString());
    });
    run();
  }
}

/** Idempotent open+migrate; call from instrumentation register(). */
export function ensureDb(): Database {
  if (!globalThis.__agentosDb) {
    globalThis.__agentosDb = open();
  }
  return globalThis.__agentosDb;
}

export function getDb(): Database {
  return ensureDb();
}

/** Synchronous transaction helper. */
export function tx<T>(fn: (db: Database) => T): T {
  const db = getDb();
  return db.transaction(() => fn(db))();
}

/** Test-only: close and forget the singleton (lets AGENTIC_OS_DB point elsewhere). */
export function __closeForTests(): void {
  if (globalThis.__agentosDb) {
    globalThis.__agentosDb.close();
    globalThis.__agentosDb = undefined;
  }
}
