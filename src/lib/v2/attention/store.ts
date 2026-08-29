import { getDb } from "../db";
import { uuid, now } from "../ids";

/**
 * SPEC-D H4.1 — attention_items store (migration 041). One row per dedupe_key.
 *
 * Status semantics (the chunk-5 "decide + document" ruling):
 *  - open       → re-flag REFRESHES title/severity/body/route/payload in place.
 *  - done (auto_resolved_at set — autoResolve cleared it because the source
 *    condition ended) → re-flag REOPENS the row (the condition came back).
 *  - done (user pressed ✓, auto_resolved_at null) → re-flag REOPENS too: "done"
 *    means "I handled that occurrence", and a fresh flag is a new occurrence.
 *  - dismissed  → NEVER resurrected by a re-flag. "Dismiss" means "stop telling
 *    me about this key"; the payload still refreshes so a later manual look at
 *    the row is current, but status stays dismissed.
 *
 * autoResolve(dedupeKey) marks an OPEN row done + stamps auto_resolved_at; it
 * never touches user-resolved (done/dismissed) rows.
 */

export type AttentionSeverity = "info" | "warn" | "urgent";
export type AttentionStatus = "open" | "done" | "dismissed";

export const ATTENTION_SEVERITIES: readonly AttentionSeverity[] = ["info", "warn", "urgent"];

/** Sort weight: urgent first. */
const SEVERITY_ORDER: Record<AttentionSeverity, number> = { urgent: 0, warn: 1, info: 2 };

export interface AttentionItem {
  id: string;
  dedupeKey: string;
  kind: string;
  severity: AttentionSeverity;
  title: string;
  body: string | null;
  route: string | null;
  payload: Record<string, unknown>;
  source: string;
  status: AttentionStatus;
  autoResolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DbRow {
  id: string;
  dedupe_key: string;
  kind: string;
  severity: string;
  title: string;
  body: string | null;
  route: string | null;
  payload_json: string;
  source: string;
  status: string;
  auto_resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

function fromDb(r: DbRow): AttentionItem {
  return {
    id: r.id,
    dedupeKey: r.dedupe_key,
    kind: r.kind,
    severity: (ATTENTION_SEVERITIES as readonly string[]).includes(r.severity)
      ? (r.severity as AttentionSeverity)
      : "info",
    title: r.title,
    body: r.body,
    route: r.route,
    payload: safeParse(r.payload_json),
    source: r.source,
    status: r.status as AttentionStatus,
    autoResolvedAt: r.auto_resolved_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function normalizeSeverity(v: unknown): AttentionSeverity {
  return typeof v === "string" && (ATTENTION_SEVERITIES as readonly string[]).includes(v)
    ? (v as AttentionSeverity)
    : "info";
}

export interface UpsertAttentionInput {
  dedupeKey: string;
  kind: string;
  title: string;
  severity?: AttentionSeverity | string;
  body?: string | null;
  route?: string | null;
  payload?: Record<string, unknown>;
  source?: string;
}

/**
 * Upsert by dedupe_key: refresh on re-flag, reopen auto-resolved/user-done rows,
 * never duplicate, never resurrect a dismissed row (see module header).
 */
export function upsertByDedupeKey(input: UpsertAttentionInput): AttentionItem {
  const db = getDb();
  const ts = now();
  const severity = normalizeSeverity(input.severity);
  const payloadJson = JSON.stringify(input.payload ?? {});
  const existing = db
    .prepare("SELECT * FROM attention_items WHERE dedupe_key = ?")
    .get(input.dedupeKey) as DbRow | undefined;

  if (existing) {
    const reopen = existing.status === "done"; // auto-resolved OR user-done — both reopen
    db.prepare(
      `UPDATE attention_items
       SET kind = ?, severity = ?, title = ?, body = ?, route = ?, payload_json = ?,
           source = ?, status = ?, auto_resolved_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      input.kind,
      severity,
      input.title,
      input.body ?? existing.body,
      input.route ?? existing.route,
      payloadJson,
      input.source ?? existing.source,
      reopen ? "open" : existing.status, // dismissed stays dismissed; open stays open
      reopen ? null : existing.auto_resolved_at,
      ts,
      existing.id,
    );
    return getItem(existing.id)!;
  }

  const id = uuid();
  db.prepare(
    `INSERT INTO attention_items
       (id, dedupe_key, kind, severity, title, body, route, payload_json, source, status, auto_resolved_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL, ?, ?)`,
  ).run(
    id,
    input.dedupeKey,
    input.kind,
    severity,
    input.title,
    input.body ?? null,
    input.route ?? null,
    payloadJson,
    input.source ?? "",
    ts,
    ts,
  );
  return getItem(id)!;
}

export function getItem(id: string): AttentionItem | null {
  const r = getDb().prepare("SELECT * FROM attention_items WHERE id = ?").get(id) as
    | DbRow
    | undefined;
  return r ? fromDb(r) : null;
}

export function getByDedupeKey(dedupeKey: string): AttentionItem | null {
  const r = getDb()
    .prepare("SELECT * FROM attention_items WHERE dedupe_key = ?")
    .get(dedupeKey) as DbRow | undefined;
  return r ? fromDb(r) : null;
}

/** User action: handled. auto_resolved_at stays NULL (this was a human). */
export function markDone(id: string): AttentionItem {
  const info = getDb()
    .prepare("UPDATE attention_items SET status = 'done', updated_at = ? WHERE id = ?")
    .run(now(), id);
  if (info.changes === 0) throw new AttentionError(`attention item ${id} not found`, 404);
  return getItem(id)!;
}

/** User action: stop telling me about this key — re-flags will NOT reopen it. */
export function dismissItem(id: string): AttentionItem {
  const info = getDb()
    .prepare("UPDATE attention_items SET status = 'dismissed', updated_at = ? WHERE id = ?")
    .run(now(), id);
  if (info.changes === 0) throw new AttentionError(`attention item ${id} not found`, 404);
  return getItem(id)!;
}

/**
 * The source condition ended (sync recovered, approval resolved): mark the OPEN
 * row done + stamp auto_resolved_at. done/dismissed rows are untouched.
 * Returns true when a row was resolved.
 */
export function autoResolve(dedupeKey: string): boolean {
  const ts = now();
  const info = getDb()
    .prepare(
      `UPDATE attention_items SET status = 'done', auto_resolved_at = ?, updated_at = ?
       WHERE dedupe_key = ? AND status = 'open'`,
    )
    .run(ts, ts, dedupeKey);
  return info.changes > 0;
}

export interface ListAttentionFilter {
  status?: AttentionStatus;
  kind?: string;
  excludeKinds?: readonly string[]; // settings.attention.muteKinds
  limit?: number;
}

/** Sorted urgent → warn → info, newest first within a severity. */
export function listItems(filter: ListAttentionFilter = {}): AttentionItem[] {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const where: string[] = [];
  const args: unknown[] = [];
  if (filter.status) {
    where.push("status = ?");
    args.push(filter.status);
  }
  if (filter.kind) {
    where.push("kind = ?");
    args.push(filter.kind);
  }
  if (filter.excludeKinds?.length) {
    where.push(`kind NOT IN (${filter.excludeKinds.map(() => "?").join(",")})`);
    args.push(...filter.excludeKinds);
  }
  const rows = getDb()
    .prepare(
      `SELECT * FROM attention_items ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...args, limit) as DbRow[];
  return rows
    .map(fromDb)
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0),
    );
}

export class AttentionError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "AttentionError";
    this.status = status;
  }
}

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
