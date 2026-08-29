import { getDb } from "../db";
import { redactArgs } from "../redact";

/**
 * E1.4 — browser_sessions / browser_tool_audit row writers. THIN and
 * never-throwing: an audit failure must not break a browser action (it logs
 * loudly instead). Timestamps are TEXT UTC ISO-8601 (CONVENTIONS §1.4).
 *
 * CONVENTIONS §9.3: browser_fill / browser_type audit rows store the field
 * NAME only, never the typed value — value/text args are stripped before the
 * redacted preview is built. args_preview is capped at 2048 chars.
 */

const ARGS_PREVIEW_CAP = 2048;

/** Tool args whose VALUES must never reach the audit table (typed content —
 *  could be a password mid-login even though secrets never arrive as args by
 *  design). Field identity (element/ref/session) is kept. */
const VALUE_STRIPPED_TOOLS: Record<string, string[]> = {
  browser_fill: ["value"],
  browser_type: ["text"],
};

export function buildArgsPreview(tool: string, args: Record<string, unknown>): string {
  const stripped: Record<string, unknown> = { ...args };
  for (const key of VALUE_STRIPPED_TOOLS[tool] ?? []) {
    if (key in stripped) stripped[key] = "[value withheld — field name only]";
  }
  let json: string;
  try {
    json = JSON.stringify(redactArgs(stripped));
  } catch {
    json = "[unserializable args]";
  }
  return json.length > ARGS_PREVIEW_CAP ? json.slice(0, ARGS_PREVIEW_CAP) : json;
}

export function recordSessionRow(input: {
  sessionName: string;
  profileName: string;
  createdBy?: string;
  taskId?: string | null;
  agentId?: string | null;
}): number | null {
  try {
    const res = getDb()
      .prepare(
        `INSERT INTO browser_sessions
           (session_name, profile_name, created_by, task_id, agent_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.sessionName,
        input.profileName,
        input.createdBy ?? "user",
        input.taskId ?? null,
        input.agentId ?? null,
        new Date().toISOString(),
      );
    return Number(res.lastInsertRowid);
  } catch (err) {
    console.error("[browser/audit] recordSessionRow failed:", err);
    return null;
  }
}

/** Stamp last_used_at on the newest open row for a session. */
export function touchSession(sessionName: string): void {
  try {
    getDb()
      .prepare(
        `UPDATE browser_sessions SET last_used_at = ?
         WHERE id = (SELECT id FROM browser_sessions
                     WHERE session_name = ? AND closed_at IS NULL
                     ORDER BY id DESC LIMIT 1)`,
      )
      .run(new Date().toISOString(), sessionName);
  } catch (err) {
    console.error("[browser/audit] touchSession failed:", err);
  }
}

/** Stamp closed_at on every open row for a session (E4.1c). */
export function closeSessionRow(sessionName: string): void {
  try {
    getDb()
      .prepare(
        `UPDATE browser_sessions SET closed_at = ?
         WHERE session_name = ? AND closed_at IS NULL`,
      )
      .run(new Date().toISOString(), sessionName);
  } catch (err) {
    console.error("[browser/audit] closeSessionRow failed:", err);
  }
}

/** EVERY browser tool call lands here — success or failure (E1.4/E4.1c). */
export function recordToolCall(input: {
  sessionName: string;
  tool: string;
  caller?: string;
  args?: Record<string, unknown>;
  ok: boolean;
  error?: string;
}): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO browser_tool_audit
           (ts, session_name, tool, caller, args_preview, ok, error)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        new Date().toISOString(),
        input.sessionName,
        input.tool,
        input.caller ?? "user",
        buildArgsPreview(input.tool, input.args ?? {}),
        input.ok ? 1 : 0,
        input.error ?? null,
      );
  } catch (err) {
    console.error("[browser/audit] recordToolCall failed:", err);
  }
}

export interface BrowserAuditRow {
  id: number;
  ts: string;
  session_name: string;
  tool: string;
  caller: string;
  args_preview: string | null;
  ok: number;
  error: string | null;
}

export function listAuditRows(opts: { limit?: number; session?: string } = {}): BrowserAuditRow[] {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  try {
    if (opts.session) {
      return getDb()
        .prepare(
          `SELECT * FROM browser_tool_audit WHERE session_name = ? ORDER BY id DESC LIMIT ?`,
        )
        .all(opts.session, limit) as BrowserAuditRow[];
    }
    return getDb()
      .prepare(`SELECT * FROM browser_tool_audit ORDER BY id DESC LIMIT ?`)
      .all(limit) as BrowserAuditRow[];
  } catch (err) {
    console.error("[browser/audit] listAuditRows failed:", err);
    return [];
  }
}

export interface BrowserSessionRow {
  id: number;
  session_name: string;
  profile_name: string;
  created_by: string;
  task_id: string | null;
  agent_id: string | null;
  created_at: string;
  last_used_at: string | null;
  closed_at: string | null;
}

export function listSessionRows(opts: { limit?: number; session?: string; agentId?: string } = {}): BrowserSessionRow[] {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  try {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.session) {
      where.push("session_name = ?");
      params.push(opts.session);
    }
    if (opts.agentId) {
      where.push("agent_id = ?");
      params.push(opts.agentId);
    }
    const sql = `SELECT * FROM browser_sessions ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ?`;
    return getDb().prepare(sql).all(...params, limit) as BrowserSessionRow[];
  } catch (err) {
    console.error("[browser/audit] listSessionRows failed:", err);
    return [];
  }
}
