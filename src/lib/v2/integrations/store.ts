import { getDb } from "../db";
import { uuid, now } from "../ids";
import { redactArgs } from "../redact";
import { sealJson, openJson } from "./crypto";
import type {
  AccountSummary,
  ActivityRow,
  CallLogRow,
  SyncRunRow,
  LastSyncSummary,
} from "./types";

/**
 * SPEC-D G2.1 — all SQL for the migration-040 integration tables. Secrets
 * discipline: config_enc is written ONLY through sealJson and read ONLY through
 * openJson; no function here ever returns a config_enc blob or decrypted config
 * inside an API-projection shape (AccountSummary & friends carry none).
 */

export class IntegrationError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "IntegrationError";
    this.status = status;
  }
}

// ─── Definitions ─────────────────────────────────────────────────────────────

interface DefinitionDbRow {
  slug: string;
  enabled: number;
  config_enc: string | null;
  updated_at: string;
}

/** Decrypted definition config ({} when unconfigured). Server-side only. */
export function getDefinitionConfig(slug: string): Record<string, string> {
  const row = getDb()
    .prepare("SELECT config_enc FROM integration_definitions WHERE slug = ?")
    .get(slug) as { config_enc: string | null } | undefined;
  return openJson(row?.config_enc);
}

export function isDefinitionEnabled(slug: string): boolean {
  const row = getDb()
    .prepare("SELECT enabled FROM integration_definitions WHERE slug = ?")
    .get(slug) as { enabled: number } | undefined;
  return row ? row.enabled === 1 : true; // no row yet = enabled
}

/** Merge (never replace wholesale) keys into the encrypted definition config.
 *  Empty-string values DELETE the key (UI "clear" affordance). */
export function patchDefinitionConfig(
  slug: string,
  patch: Record<string, string>,
  enabled?: boolean,
): void {
  const db = getDb();
  const current = getDefinitionConfig(slug);
  for (const [k, v] of Object.entries(patch)) {
    if (v === "") delete current[k];
    else current[k] = v;
  }
  const sealed = sealJson(current);
  const ts = now();
  db.prepare(
    `INSERT INTO integration_definitions(slug, enabled, config_enc, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET
       config_enc = excluded.config_enc,
       enabled    = CASE WHEN ? THEN excluded.enabled ELSE integration_definitions.enabled END,
       updated_at = excluded.updated_at`,
  ).run(slug, enabled === false ? 0 : 1, sealed, ts, enabled === undefined ? 0 : 1);
}

/** Which definition-config keys are present — booleans ONLY (never values). */
export function definitionConfiguredKeys(slug: string): Record<string, boolean> {
  const cfg = getDefinitionConfig(slug);
  return {
    clientId: !!cfg.clientId,
    clientSecret: !!cfg.clientSecret,
    webhookSecret: !!cfg.webhookSecret,
  };
}

// ─── Accounts ────────────────────────────────────────────────────────────────

export interface AccountRow {
  id: string;
  definitionSlug: string;
  accountId: string;
  displayName: string | null;
  settings: Record<string, unknown>; // parsed settings_json (state, autoActivityRead, triggersEnabled)
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface AccountDbRow {
  id: string;
  definition_slug: string;
  account_id: string;
  display_name: string | null;
  config_enc: string;
  settings_json: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

function accountFromDb(r: AccountDbRow): AccountRow {
  return {
    id: r.id,
    definitionSlug: r.definition_slug,
    accountId: r.account_id,
    displayName: r.display_name,
    settings: safeParse(r.settings_json),
    isActive: r.is_active === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * UNIQUE(definition_slug, account_id) upsert (upstream semantics): reconnecting
 * the same external account refreshes config/displayName on the SAME row (id
 * and settings preserved, is_active flips back on).
 */
export function upsertAccount(input: {
  definitionSlug: string;
  accountId: string;
  displayName?: string;
  config: Record<string, string>;
  settings?: Record<string, unknown>;
}): AccountRow {
  const db = getDb();
  // Ensure the definition row exists (FK target) without touching its config.
  db.prepare(
    "INSERT OR IGNORE INTO integration_definitions(slug, enabled, config_enc, updated_at) VALUES (?, 1, NULL, ?)",
  ).run(input.definitionSlug, now());

  const existing = db
    .prepare(
      "SELECT * FROM integration_accounts WHERE definition_slug = ? AND account_id = ?",
    )
    .get(input.definitionSlug, input.accountId) as AccountDbRow | undefined;
  const ts = now();
  const sealed = sealJson(input.config);

  if (existing) {
    const settings = { ...safeParse(existing.settings_json), ...(input.settings ?? {}) };
    db.prepare(
      `UPDATE integration_accounts
       SET display_name = ?, config_enc = ?, settings_json = ?, is_active = 1, updated_at = ?
       WHERE id = ?`,
    ).run(
      input.displayName ?? existing.display_name,
      sealed,
      JSON.stringify(settings),
      ts,
      existing.id,
    );
    return getAccount(existing.id)!;
  }

  const id = uuid();
  db.prepare(
    `INSERT INTO integration_accounts
       (id, definition_slug, account_id, display_name, config_enc, settings_json, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(
    id,
    input.definitionSlug,
    input.accountId,
    input.displayName ?? null,
    sealed,
    JSON.stringify(input.settings ?? {}),
    ts,
    ts,
  );
  return getAccount(id)!;
}

export function getAccount(id: string): AccountRow | null {
  const row = getDb()
    .prepare("SELECT * FROM integration_accounts WHERE id = ?")
    .get(id) as AccountDbRow | undefined;
  return row ? accountFromDb(row) : null;
}

export function findAccountByExternalId(
  definitionSlug: string,
  accountId: string,
): AccountRow | null {
  const row = getDb()
    .prepare(
      "SELECT * FROM integration_accounts WHERE definition_slug = ? AND account_id = ?",
    )
    .get(definitionSlug, accountId) as AccountDbRow | undefined;
  return row ? accountFromDb(row) : null;
}

export function listAccounts(definitionSlug?: string): AccountRow[] {
  const rows = (
    definitionSlug
      ? getDb()
          .prepare(
            "SELECT * FROM integration_accounts WHERE definition_slug = ? ORDER BY created_at",
          )
          .all(definitionSlug)
      : getDb().prepare("SELECT * FROM integration_accounts ORDER BY created_at").all()
  ) as AccountDbRow[];
  return rows.map(accountFromDb);
}

export function listActiveAccounts(): AccountRow[] {
  const rows = getDb()
    .prepare("SELECT * FROM integration_accounts WHERE is_active = 1 ORDER BY created_at")
    .all() as AccountDbRow[];
  return rows.map(accountFromDb);
}

/** Decrypted per-account config. Server-side only — NEVER serialize. */
export function getAccountConfig(id: string): Record<string, string> {
  const row = getDb()
    .prepare("SELECT config_enc FROM integration_accounts WHERE id = ?")
    .get(id) as { config_enc: string } | undefined;
  if (!row) throw new IntegrationError(`account ${id} not found`, 404);
  return openJson(row.config_enc);
}

/** Re-seal a refreshed config (e.g. OAuth token refresh persistence). */
export function setAccountConfig(id: string, config: Record<string, string>): void {
  const info = getDb()
    .prepare("UPDATE integration_accounts SET config_enc = ?, updated_at = ? WHERE id = ?")
    .run(sealJson(config), now(), id);
  if (info.changes === 0) throw new IntegrationError(`account ${id} not found`, 404);
}

/** Merge keys into settings_json (autoActivityRead / triggersEnabled / ...). */
export function patchAccountSettings(
  id: string,
  patch: Record<string, unknown>,
): AccountRow {
  const account = getAccount(id);
  if (!account) throw new IntegrationError(`account ${id} not found`, 404);
  const settings = { ...account.settings, ...patch };
  getDb()
    .prepare("UPDATE integration_accounts SET settings_json = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(settings), now(), id);
  return getAccount(id)!;
}

export function setAccountDisplayName(id: string, displayName: string): void {
  getDb()
    .prepare("UPDATE integration_accounts SET display_name = ?, updated_at = ? WHERE id = ?")
    .run(displayName, now(), id);
}

/** Deactivate = disconnect (rows retained, exile-equivalent). Reactivation is the reconnect upsert. */
export function setAccountActive(id: string, active: boolean): AccountRow {
  const info = getDb()
    .prepare("UPDATE integration_accounts SET is_active = ?, updated_at = ? WHERE id = ?")
    .run(active ? 1 : 0, now(), id);
  if (info.changes === 0) throw new IntegrationError(`account ${id} not found`, 404);
  return getAccount(id)!;
}

/** Sync watermark state (settings_json.state). */
export function getAccountState(id: string): Record<string, string> {
  const account = getAccount(id);
  if (!account) throw new IntegrationError(`account ${id} not found`, 404);
  const state = account.settings.state;
  return state && typeof state === "object" ? { ...(state as Record<string, string>) } : {};
}

/** Merge ONLY the keys the connector returned (SPEC-D G2.4 watermark rule). */
export function mergeAccountState(id: string, patch: Record<string, string>): void {
  const state = { ...getAccountState(id), ...patch };
  patchAccountSettings(id, { state });
}

export function toAccountSummary(account: AccountRow): AccountSummary {
  const latest = latestSyncRun(account.id);
  const lastSync: LastSyncSummary | undefined =
    latest && latest.finishedAt
      ? {
          at: latest.finishedAt,
          ok: latest.ok === true,
          activitiesCount: latest.activitiesCount,
          ...(latest.error ? { error: latest.error } : {}),
        }
      : undefined;
  return {
    id: account.id,
    accountId: account.accountId,
    displayName: account.displayName,
    isActive: account.isActive,
    autoActivityRead: account.settings.autoActivityRead !== false,
    triggersEnabled: account.settings.triggersEnabled !== false,
    ...(lastSync ? { lastSync } : {}),
  };
}

// ─── Activities ──────────────────────────────────────────────────────────────

interface ActivityDbRow {
  id: string;
  account_id: string;
  text: string;
  source_url: string | null;
  event_type: string | null;
  payload_json: string | null;
  rejection_reason: string | null;
  ingest_status: string;
  created_at: string;
}

function activityFromDb(r: ActivityDbRow): ActivityRow {
  return {
    id: r.id,
    accountId: r.account_id,
    text: r.text,
    sourceUrl: r.source_url,
    eventType: r.event_type,
    payload: r.payload_json ? safeParse(r.payload_json) : null,
    rejectionReason: r.rejection_reason,
    ingestStatus: r.ingest_status as ActivityRow["ingestStatus"],
    createdAt: r.created_at,
  };
}

export function insertActivity(input: {
  accountId: string;
  text: string;
  sourceUrl?: string;
  eventType?: string;
  payload?: Record<string, unknown>;
  rejectionReason?: string;
  ingestStatus?: ActivityRow["ingestStatus"];
}): ActivityRow {
  const id = uuid();
  getDb()
    .prepare(
      `INSERT INTO activities
         (id, account_id, text, source_url, event_type, payload_json, rejection_reason, ingest_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.accountId,
      input.text,
      input.sourceUrl ?? null,
      input.eventType ?? null,
      input.payload ? JSON.stringify(input.payload) : null,
      input.rejectionReason ?? null,
      input.ingestStatus ?? (input.rejectionReason ? "rejected" : "pending"),
      now(),
    );
  return getActivity(id)!;
}

export function getActivity(id: string): ActivityRow | null {
  const row = getDb().prepare("SELECT * FROM activities WHERE id = ?").get(id) as
    | ActivityDbRow
    | undefined;
  return row ? activityFromDb(row) : null;
}

export function setActivityIngestStatus(
  id: string,
  status: ActivityRow["ingestStatus"],
): void {
  getDb().prepare("UPDATE activities SET ingest_status = ? WHERE id = ?").run(status, id);
}

export function listActivities(
  accountId: string,
  opts: { limit?: number; before?: string } = {},
): ActivityRow[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = (
    opts.before
      ? getDb()
          .prepare(
            `SELECT * FROM activities WHERE account_id = ? AND created_at < ?
             ORDER BY created_at DESC LIMIT ?`,
          )
          .all(accountId, opts.before, limit)
      : getDb()
          .prepare(
            "SELECT * FROM activities WHERE account_id = ? ORDER BY created_at DESC LIMIT ?",
          )
          .all(accountId, limit)
  ) as ActivityDbRow[];
  return rows.map(activityFromDb);
}

// ─── Call logs ───────────────────────────────────────────────────────────────

const ARGS_LOG_CAP = 4096;

/** args are redacted via the shared redactArgs (CONVENTIONS §9.3) + 4KB-capped.
 *  Pass resolved secret values so value-equality masking applies. */
export function insertCallLog(input: {
  accountId: string;
  toolName: string;
  source?: string;
  args?: unknown;
  secretValues?: readonly string[];
  ok: boolean;
  error?: string;
  durationMs?: number;
}): void {
  let argsJson = JSON.stringify(redactArgs(input.args ?? {}, input.secretValues ?? []));
  if (argsJson.length > ARGS_LOG_CAP) argsJson = JSON.stringify({ truncated: true });
  getDb()
    .prepare(
      `INSERT INTO integration_call_logs
         (id, account_id, tool_name, source, args_json, ok, error, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      uuid(),
      input.accountId,
      input.toolName,
      input.source ?? null,
      argsJson,
      input.ok ? 1 : 0,
      input.error ?? null,
      input.durationMs ?? null,
      now(),
    );
}

interface CallLogDbRow {
  id: string;
  account_id: string;
  tool_name: string;
  source: string | null;
  args_json: string;
  ok: number;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
}

export function listCallLogs(accountId: string, limit = 100): CallLogRow[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM integration_call_logs WHERE account_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(accountId, Math.min(Math.max(limit, 1), 500)) as CallLogDbRow[];
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    toolName: r.tool_name,
    source: r.source,
    args: safeParse(r.args_json),
    ok: r.ok === 1,
    error: r.error,
    durationMs: r.duration_ms,
    createdAt: r.created_at,
  }));
}

// ─── Sync runs ───────────────────────────────────────────────────────────────

interface SyncRunDbRow {
  id: string;
  account_id: string;
  trigger: string;
  started_at: string;
  finished_at: string | null;
  ok: number | null;
  activities_count: number;
  error: string | null;
}

function syncRunFromDb(r: SyncRunDbRow): SyncRunRow {
  return {
    id: r.id,
    accountId: r.account_id,
    trigger: r.trigger as SyncRunRow["trigger"],
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    ok: r.ok === null ? null : r.ok === 1,
    activitiesCount: r.activities_count,
    error: r.error,
  };
}

export function startSyncRun(accountId: string, trigger: SyncRunRow["trigger"]): string {
  const id = uuid();
  getDb()
    .prepare(
      "INSERT INTO integration_sync_runs(id, account_id, trigger, started_at) VALUES (?, ?, ?, ?)",
    )
    .run(id, accountId, trigger, now());
  return id;
}

export function finishSyncRun(
  id: string,
  outcome: { ok: boolean; activitiesCount?: number; error?: string },
): void {
  getDb()
    .prepare(
      "UPDATE integration_sync_runs SET finished_at = ?, ok = ?, activities_count = ?, error = ? WHERE id = ?",
    )
    .run(now(), outcome.ok ? 1 : 0, outcome.activitiesCount ?? 0, outcome.error ?? null, id);
}

export function latestSyncRun(accountId: string): SyncRunRow | null {
  const row = getDb()
    .prepare(
      "SELECT * FROM integration_sync_runs WHERE account_id = ? ORDER BY started_at DESC LIMIT 1",
    )
    .get(accountId) as SyncRunDbRow | undefined;
  return row ? syncRunFromDb(row) : null;
}

export function listSyncRuns(accountId: string, limit = 100): SyncRunRow[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM integration_sync_runs WHERE account_id = ? ORDER BY started_at DESC LIMIT ?",
    )
    .all(accountId, Math.min(Math.max(limit, 1), 500)) as SyncRunDbRow[];
  return rows.map(syncRunFromDb);
}

// ─── OAuth sessions (persisted state — restart-resilient, SPEC-D §1 decision 4) ──

const OAUTH_TTL_MS = 15 * 60 * 1000;

export function putOauthSession(input: {
  state: string;
  definitionSlug: string;
  codeVerifier?: string;
  redirectUrl: string;
}): void {
  purgeExpiredOauthSessions();
  getDb()
    .prepare(
      `INSERT INTO oauth_sessions(state, definition_slug, code_verifier, redirect_url, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(input.state, input.definitionSlug, input.codeVerifier ?? null, input.redirectUrl, now());
}

export interface OauthSessionRow {
  state: string;
  definitionSlug: string;
  codeVerifier: string | null;
  redirectUrl: string;
  createdAt: string;
}

/** ONE-SHOT: returns the session and deletes it (replay-proof). Expired → null. */
export function popOauthSession(state: string): OauthSessionRow | null {
  purgeExpiredOauthSessions();
  const db = getDb();
  const row = db.prepare("SELECT * FROM oauth_sessions WHERE state = ?").get(state) as
    | {
        state: string;
        definition_slug: string;
        code_verifier: string | null;
        redirect_url: string;
        created_at: string;
      }
    | undefined;
  if (!row) return null;
  db.prepare("DELETE FROM oauth_sessions WHERE state = ?").run(state);
  return {
    state: row.state,
    definitionSlug: row.definition_slug,
    codeVerifier: row.code_verifier,
    redirectUrl: row.redirect_url,
    createdAt: row.created_at,
  };
}

export function purgeExpiredOauthSessions(): number {
  const cutoff = new Date(Date.now() - OAUTH_TTL_MS).toISOString();
  const info = getDb().prepare("DELETE FROM oauth_sessions WHERE created_at < ?").run(cutoff);
  return info.changes;
}

// ─── util ────────────────────────────────────────────────────────────────────

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
