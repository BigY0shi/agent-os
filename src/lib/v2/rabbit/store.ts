// Rabbit R1 bridge — rabbit_sessions / rabbit_messages CRUD (migration 044).
// Opens the DB through the ONE opener (CONVENTIONS §1.2), never at import time
// (§1.3); timestamps are TEXT UTC ISO via ids.now() (§1.4).
//
// The OpenAI dialect has no conversation id: every request carries the whole
// message list. A session is re-linked by the sha256 of the LAST assistant
// reply the client sends back — the bridge wrote that text, so a match means
// "this is the same conversation continuing". No match (first turn, or the
// idle gap expired) = a new session. Archive is a soft flag; rows are never
// destroyed (house rule).

import { createHash } from "node:crypto";
import { getDb, tx } from "../db";
import { uuid, now } from "../ids";

export interface RabbitSession {
  id: string;
  title: string;
  model: string;
  client: string;
  messageCount: number;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface RabbitMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
}

export type SessionFilter = "active" | "archived" | "all";

interface SessRow {
  id: string; title: string; model: string; client: string;
  message_count: number; input_tokens: number; output_tokens: number;
  created_at: string; updated_at: string; archived_at: string | null;
}
interface MsgRow {
  id: string; session_id: string; role: RabbitMessage["role"]; content: string;
  model: string | null; input_tokens: number | null; output_tokens: number | null;
  duration_ms: number | null; error: string | null; created_at: string;
}

const TITLE_CAP = 80;

function mapSess(r: SessRow): RabbitSession {
  return {
    id: r.id, title: r.title, model: r.model, client: r.client,
    messageCount: r.message_count, inputTokens: r.input_tokens, outputTokens: r.output_tokens,
    createdAt: r.created_at, updatedAt: r.updated_at, archivedAt: r.archived_at ?? null,
  };
}
function mapMsg(r: MsgRow): RabbitMessage {
  return {
    id: r.id, sessionId: r.session_id, role: r.role, content: r.content, model: r.model,
    inputTokens: r.input_tokens, outputTokens: r.output_tokens, durationMs: r.duration_ms,
    error: r.error, createdAt: r.created_at,
  };
}

export function hashText(s: string): string {
  return createHash("sha256").update(s.trim()).digest("hex");
}

export function titleFrom(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > TITLE_CAP ? t.slice(0, TITLE_CAP - 1) + "…" : t;
}

export function createSession(input: { title: string; model: string; client?: string }): RabbitSession {
  const ts = now();
  const row: SessRow = {
    id: uuid(), title: titleFrom(input.title) || "Untitled", model: input.model, client: input.client ?? "",
    message_count: 0, input_tokens: 0, output_tokens: 0, created_at: ts, updated_at: ts, archived_at: null,
  };
  getDb().prepare(
    `INSERT INTO rabbit_sessions (id, title, model, client, message_count, input_tokens, output_tokens, created_at, updated_at, archived_at)
     VALUES (@id, @title, @model, @client, @message_count, @input_tokens, @output_tokens, @created_at, @updated_at, @archived_at)`,
  ).run(row);
  return mapSess(row);
}

export function findSessionByLastReply(replyText: string, gapMinutes: number): RabbitSession | null {
  const since = new Date(Date.now() - Math.max(1, gapMinutes) * 60_000).toISOString();
  const r = getDb().prepare(
    `SELECT * FROM rabbit_sessions
      WHERE archived_at IS NULL AND last_assistant_hash = ? AND updated_at >= ?
      ORDER BY updated_at DESC LIMIT 1`,
  ).get(hashText(replyText), since) as SessRow | undefined;
  return r ? mapSess(r) : null;
}

/** Continue the session whose last reply the client echoed back, else start one. */
export function linkSession(input: {
  priorAssistant: string | null;
  firstUser: string;
  model: string;
  client?: string;
  gapMinutes: number;
}): { session: RabbitSession; resumed: boolean } {
  if (input.priorAssistant) {
    const found = findSessionByLastReply(input.priorAssistant, input.gapMinutes);
    if (found) return { session: found, resumed: true };
  }
  return { session: createSession({ title: input.firstUser, model: input.model, client: input.client }), resumed: false };
}

/** Persist one exchange (user → assistant) and roll the session counters. */
export function recordTurn(input: {
  sessionId: string;
  user: string;
  assistant: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  error?: string | null;
}): void {
  tx((db) => {
    const ts = now();
    const ins = db.prepare(
      `INSERT INTO rabbit_messages (id, session_id, role, content, model, input_tokens, output_tokens, duration_ms, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    ins.run(uuid(), input.sessionId, "user", input.user, input.model, null, null, null, null, ts);
    ins.run(uuid(), input.sessionId, "assistant", input.assistant, input.model,
      input.inputTokens ?? null, input.outputTokens ?? null, input.durationMs ?? null, input.error ?? null, now());
    db.prepare(
      `UPDATE rabbit_sessions
          SET message_count = message_count + 2,
              input_tokens  = input_tokens + ?,
              output_tokens = output_tokens + ?,
              model = ?,
              last_assistant_hash = ?,
              updated_at = ?
        WHERE id = ?`,
    ).run(input.inputTokens ?? 0, input.outputTokens ?? 0, input.model, hashText(input.assistant), now(), input.sessionId);
  });
}

export function getSession(id: string): RabbitSession | null {
  const r = getDb().prepare(`SELECT * FROM rabbit_sessions WHERE id = ?`).get(id) as SessRow | undefined;
  return r ? mapSess(r) : null;
}

export function listSessions(opts: { status?: SessionFilter; q?: string; limit?: number } = {}): RabbitSession[] {
  const status = opts.status ?? "active";
  const where: string[] = [];
  const params: unknown[] = [];
  if (status === "active") where.push("archived_at IS NULL");
  if (status === "archived") where.push("archived_at IS NOT NULL");
  if (opts.q && opts.q.trim()) {
    where.push("(title LIKE ? OR id IN (SELECT session_id FROM rabbit_messages WHERE content LIKE ?))");
    const like = `%${opts.q.trim()}%`;
    params.push(like, like);
  }
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const sql = `SELECT * FROM rabbit_sessions ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY updated_at DESC LIMIT ?`;
  return (getDb().prepare(sql).all(...params, limit) as SessRow[]).map(mapSess);
}

export function countSessions(): { active: number; archived: number } {
  const r = getDb().prepare(
    `SELECT SUM(CASE WHEN archived_at IS NULL THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN archived_at IS NOT NULL THEN 1 ELSE 0 END) AS archived
       FROM rabbit_sessions`,
  ).get() as { active: number | null; archived: number | null };
  return { active: r.active ?? 0, archived: r.archived ?? 0 };
}

export function listMessages(sessionId: string, limit = 500): RabbitMessage[] {
  return (getDb().prepare(
    `SELECT * FROM rabbit_messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC LIMIT ?`,
  ).all(sessionId, Math.min(Math.max(limit, 1), 2000)) as MsgRow[]).map(mapMsg);
}

export function setArchived(id: string, archived: boolean): RabbitSession | null {
  getDb().prepare(`UPDATE rabbit_sessions SET archived_at = ?, updated_at = updated_at WHERE id = ?`)
    .run(archived ? now() : null, id);
  return getSession(id);
}

export function renameSession(id: string, title: string): RabbitSession | null {
  getDb().prepare(`UPDATE rabbit_sessions SET title = ? WHERE id = ?`).run(titleFrom(title) || "Untitled", id);
  return getSession(id);
}

/** Archive every active session idle for more than `days`. Returns how many. */
export function archiveIdle(days: number): number {
  const cutoff = new Date(Date.now() - Math.max(0, days) * 86_400_000).toISOString();
  const r = getDb().prepare(
    `UPDATE rabbit_sessions SET archived_at = ? WHERE archived_at IS NULL AND updated_at <= ?`,
  ).run(now(), cutoff);
  return Number(r.changes ?? 0);
}
