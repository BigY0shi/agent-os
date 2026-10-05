import { getDb } from "../db";
import { uuid, now } from "../ids";

/**
 * SPEC-C C3 — jarvis_conversations / jarvis_messages CRUD (migration 031).
 * Message content is the RAW user/assistant text only — pageContext is
 * per-request and never stored (C5 privacy rule; smoke asserts the negative).
 */

export type JarvisChannel = "overlay" | "page";
/** Where the conversation was started from (migration 035). null = the dashboard. */
export type JarvisOrigin = "glasses";

export interface JarvisConversation {
  id: string;
  title: string;
  channel: JarvisChannel;
  origin: JarvisOrigin | null;
  createdAt: string;
  updatedAt: string;
  /** C3.6: non-null = archived (soft delete — rows are never destroyed). */
  archivedAt: string | null;
}

export interface JarvisConversationSummary extends JarvisConversation {
  messageCount: number;
}

export interface JarvisMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls: JarvisToolCallSummary[] | null;
  /** This turn's context contained integration-labeled recall (§9.4). Replaying
   *  a tainted message into a fresh session must re-taint it — the warm-session
   *  taint flag alone dies with the process (review finding, 2026-08-27). */
  tainted?: boolean;
  createdAt: string;
}

/** Sentinel row inside tool_calls_json marking a §9.4-tainted turn — stored
 *  in-band so no migration is needed; stripped out of toolCalls on read. */
const TAINT_MARKER = "__recall_taint__";

export interface JarvisToolCallSummary {
  name: string;
  summary: string;
  ok: boolean;
}

interface ConvRow {
  id: string;
  title: string;
  channel: JarvisChannel;
  origin?: JarvisOrigin | null;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
}
interface MsgRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  tool_calls_json: string | null;
  created_at: string;
}

const TITLE_CAP = 80;

function mapConv(r: ConvRow): JarvisConversation {
  return {
    id: r.id,
    title: r.title,
    channel: r.channel,
    origin: r.origin ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    archivedAt: r.archived_at ?? null,
  };
}

function mapMsg(r: MsgRow): JarvisMessage {
  let toolCalls: JarvisToolCallSummary[] | null = null;
  let tainted = false;
  if (r.tool_calls_json) {
    try {
      const parsed = JSON.parse(r.tool_calls_json);
      if (Array.isArray(parsed)) {
        const real = (parsed as JarvisToolCallSummary[]).filter((t) => {
          if (t && t.name === TAINT_MARKER) {
            tainted = true;
            return false;
          }
          return true;
        });
        toolCalls = real.length ? real : null;
      }
    } catch {
      /* malformed tolerated — surfaces as null */
    }
  }
  return {
    id: r.id,
    conversationId: r.conversation_id,
    role: r.role,
    content: r.content,
    toolCalls,
    ...(tainted ? { tainted: true } : {}),
    createdAt: r.created_at,
  };
}

export function createConversation(
  input: { title?: string; channel?: JarvisChannel; origin?: JarvisOrigin } = {},
): JarvisConversation {
  const ts = now();
  const row: ConvRow = {
    id: uuid(),
    title: (input.title ?? "").slice(0, TITLE_CAP),
    channel: input.channel ?? "overlay",
    origin: input.origin ?? null,
    created_at: ts,
    updated_at: ts,
  };
  getDb()
    .prepare(
      "INSERT INTO jarvis_conversations (id, title, channel, origin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(row.id, row.title, row.channel, row.origin, row.created_at, row.updated_at);
  return mapConv(row);
}

export function getConversation(id: string): JarvisConversation | null {
  const r = getDb().prepare("SELECT * FROM jarvis_conversations WHERE id = ?").get(id) as
    | ConvRow
    | undefined;
  return r ? mapConv(r) : null;
}

/** Live conversations newest-first with message counts (C3.6 list contract).
 *  Archived rows are excluded unless includeArchived. */
export function listConversations(
  limit = 50,
  opts: { includeArchived?: boolean } = {},
): JarvisConversationSummary[] {
  const where = opts.includeArchived ? "" : "WHERE c.archived_at IS NULL";
  const rows = getDb()
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM jarvis_messages m WHERE m.conversation_id = c.id) AS message_count
       FROM jarvis_conversations c ${where} ORDER BY c.updated_at DESC LIMIT ?`,
    )
    .all(Math.min(Math.max(limit, 1), 200)) as (ConvRow & { message_count: number })[];
  return rows.map((r) => ({ ...mapConv(r), messageCount: r.message_count }));
}

/** C3.6 PATCH: rename. Returns null when the id is unknown. */
export function renameConversation(id: string, title: string): JarvisConversation | null {
  const clean = title.trim().slice(0, TITLE_CAP);
  const info = getDb()
    .prepare("UPDATE jarvis_conversations SET title = ?, updated_at = ? WHERE id = ?")
    .run(clean, now(), id);
  if (info.changes === 0) return null;
  return getConversation(id);
}

/** C3.6 DELETE semantics: ARCHIVE (soft flag), never row destruction.
 *  Idempotent — archiving an archived conversation keeps the original stamp. */
export function archiveConversation(id: string): JarvisConversation | null {
  const existing = getConversation(id);
  if (!existing) return null;
  if (existing.archivedAt) return existing;
  getDb()
    .prepare("UPDATE jarvis_conversations SET archived_at = ? WHERE id = ?")
    .run(now(), id);
  return getConversation(id);
}

/** Resolve-or-create: an unknown/absent id starts a fresh conversation.
 *  First user text seeds the title. */
export function ensureConversation(
  id: string | undefined,
  opts: { titleSeed?: string; channel?: JarvisChannel; origin?: JarvisOrigin } = {},
): JarvisConversation {
  if (id) {
    const existing = getConversation(id);
    if (existing) return existing;
  }
  return createConversation({
    title: opts.titleSeed?.trim().slice(0, TITLE_CAP),
    channel: opts.channel,
    origin: opts.origin,
  });
}

/** The newest live conversation started from `origin`, or null. The glasses
 *  lane uses it to continue a thread (Even sends no history of its own). */
export function latestConversationByOrigin(origin: JarvisOrigin): JarvisConversation | null {
  const r = getDb()
    .prepare(
      "SELECT * FROM jarvis_conversations WHERE origin = ? AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 1",
    )
    .get(origin) as ConvRow | undefined;
  return r ? mapConv(r) : null;
}

export function appendJarvisMessage(input: {
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: JarvisToolCallSummary[] | null;
  tainted?: boolean;
}): JarvisMessage {
  const ts = now();
  const serialized = input.tainted
    ? [...(input.toolCalls ?? []), { name: TAINT_MARKER, summary: "", ok: true }]
    : (input.toolCalls ?? []);
  const row: MsgRow = {
    id: uuid(),
    conversation_id: input.conversationId,
    role: input.role,
    content: input.content,
    tool_calls_json: serialized.length ? JSON.stringify(serialized) : null,
    created_at: ts,
  };
  const db = getDb();
  db.prepare(
    "INSERT INTO jarvis_messages (id, conversation_id, role, content, tool_calls_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(row.id, row.conversation_id, row.role, row.content, row.tool_calls_json, row.created_at);
  db.prepare("UPDATE jarvis_conversations SET updated_at = ? WHERE id = ?").run(ts, input.conversationId);
  return mapMsg(row);
}

export function listMessages(conversationId: string, limit = 200): JarvisMessage[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM jarvis_messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC LIMIT ?",
    )
    .all(conversationId, Math.min(Math.max(limit, 1), 1000)) as MsgRow[];
  return rows.map(mapMsg);
}

// ---------------------------------------------------------------------------
// S13 Sessions tab (2026-09-28, _design/jarvis-v3-plan.md)
// ---------------------------------------------------------------------------

/** Undo an archive. Archive never destroyed anything; this makes that reversible
 *  from the UI. Returns null when the id is unknown. Idempotent. */
export function restoreConversation(id: string): JarvisConversation | null {
  const existing = getConversation(id);
  if (!existing) return null;
  if (!existing.archivedAt) return existing;
  getDb().prepare("UPDATE jarvis_conversations SET archived_at = NULL WHERE id = ?").run(id);
  return getConversation(id);
}

export type SessionScope = "live" | "archived" | "all";

export interface SessionHit extends JarvisConversationSummary {
  /** When the query matched a message (not only the title), an excerpt around it. */
  snippet: string | null;
  lastMessageAt: string | null;
}

/** Search titles AND message bodies. Empty query = plain listing in that scope.
 *  LIKE with escaped wildcards, so a user's "%" or "_" is literal. */
export function searchConversations(
  q: string,
  opts: { scope?: SessionScope; limit?: number } = {},
): SessionHit[] {
  const scope = opts.scope ?? "live";
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);
  const needle = q.trim().slice(0, 200);
  const where: string[] = [];
  const args: unknown[] = [];
  if (scope === "live") where.push("c.archived_at IS NULL");
  if (scope === "archived") where.push("c.archived_at IS NOT NULL");
  let like = "";
  if (needle) {
    like = `%${needle.replace(/[\\%_]/g, (ch) => "\\" + ch)}%`;
    where.push(
      "(c.title LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM jarvis_messages m2 WHERE m2.conversation_id = c.id AND m2.content LIKE ? ESCAPE '\\'))",
    );
    args.push(like, like);
  }
  const rows = getDb()
    .prepare(
      `SELECT c.*,
         (SELECT COUNT(*) FROM jarvis_messages m WHERE m.conversation_id = c.id) AS message_count,
         (SELECT MAX(m.created_at) FROM jarvis_messages m WHERE m.conversation_id = c.id) AS last_message_at
       FROM jarvis_conversations c
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY c.updated_at DESC LIMIT ?`,
    )
    .all(...args, limit) as (ConvRow & { message_count: number; last_message_at: string | null })[];
  const snip = getDb().prepare(
    "SELECT content FROM jarvis_messages WHERE conversation_id = ? AND content LIKE ? ESCAPE '\\' ORDER BY created_at ASC LIMIT 1",
  );
  return rows.map((r) => {
    let snippet: string | null = null;
    if (like) {
      const hit = snip.get(r.id, like) as { content: string } | undefined;
      if (hit) {
        const at = hit.content.toLowerCase().indexOf(needle.toLowerCase());
        const from = Math.max(0, at - 60);
        snippet = (from > 0 ? "…" : "") + hit.content.slice(from, from + 180).replace(/\s+/g, " ").trim() + (hit.content.length > from + 180 ? "…" : "");
      }
    }
    return { ...mapConv(r), messageCount: r.message_count, snippet, lastMessageAt: r.last_message_at };
  });
}

/** Header counts for the Sessions tab: live, archived, total messages. Measured. */
export function sessionCounts(): { live: number; archived: number; messages: number } {
  const db = getDb();
  const live = (db.prepare("SELECT COUNT(*) AS n FROM jarvis_conversations WHERE archived_at IS NULL").get() as { n: number }).n;
  const archived = (db.prepare("SELECT COUNT(*) AS n FROM jarvis_conversations WHERE archived_at IS NOT NULL").get() as { n: number }).n;
  const messages = (db.prepare("SELECT COUNT(*) AS n FROM jarvis_messages").get() as { n: number }).n;
  return { live, archived, messages };
}
