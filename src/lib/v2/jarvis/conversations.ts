import { getDb } from "../db";
import { uuid, now } from "../ids";

/**
 * SPEC-C C3 — jarvis_conversations / jarvis_messages CRUD (migration 031).
 * Message content is the RAW user/assistant text only — pageContext is
 * per-request and never stored (C5 privacy rule; smoke asserts the negative).
 */

export type JarvisChannel = "overlay" | "page";

export interface JarvisConversation {
  id: string;
  title: string;
  channel: JarvisChannel;
  createdAt: string;
  updatedAt: string;
}

export interface JarvisMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls: JarvisToolCallSummary[] | null;
  createdAt: string;
}

export interface JarvisToolCallSummary {
  name: string;
  summary: string;
  ok: boolean;
}

interface ConvRow {
  id: string;
  title: string;
  channel: JarvisChannel;
  created_at: string;
  updated_at: string;
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
  return { id: r.id, title: r.title, channel: r.channel, createdAt: r.created_at, updatedAt: r.updated_at };
}

function mapMsg(r: MsgRow): JarvisMessage {
  let toolCalls: JarvisToolCallSummary[] | null = null;
  if (r.tool_calls_json) {
    try {
      const parsed = JSON.parse(r.tool_calls_json);
      if (Array.isArray(parsed)) toolCalls = parsed as JarvisToolCallSummary[];
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
    createdAt: r.created_at,
  };
}

export function createConversation(input: { title?: string; channel?: JarvisChannel } = {}): JarvisConversation {
  const ts = now();
  const row: ConvRow = {
    id: uuid(),
    title: (input.title ?? "").slice(0, TITLE_CAP),
    channel: input.channel ?? "overlay",
    created_at: ts,
    updated_at: ts,
  };
  getDb()
    .prepare(
      "INSERT INTO jarvis_conversations (id, title, channel, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(row.id, row.title, row.channel, row.created_at, row.updated_at);
  return mapConv(row);
}

export function getConversation(id: string): JarvisConversation | null {
  const r = getDb().prepare("SELECT * FROM jarvis_conversations WHERE id = ?").get(id) as
    | ConvRow
    | undefined;
  return r ? mapConv(r) : null;
}

export function listConversations(limit = 50): JarvisConversation[] {
  const rows = getDb()
    .prepare("SELECT * FROM jarvis_conversations ORDER BY updated_at DESC LIMIT ?")
    .all(Math.min(Math.max(limit, 1), 200)) as ConvRow[];
  return rows.map(mapConv);
}

/** Resolve-or-create: an unknown/absent id starts a fresh conversation.
 *  First user text seeds the title. */
export function ensureConversation(
  id: string | undefined,
  opts: { titleSeed?: string; channel?: JarvisChannel } = {},
): JarvisConversation {
  if (id) {
    const existing = getConversation(id);
    if (existing) return existing;
  }
  return createConversation({
    title: opts.titleSeed?.trim().slice(0, TITLE_CAP),
    channel: opts.channel,
  });
}

export function appendJarvisMessage(input: {
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: JarvisToolCallSummary[] | null;
}): JarvisMessage {
  const ts = now();
  const row: MsgRow = {
    id: uuid(),
    conversation_id: input.conversationId,
    role: input.role,
    content: input.content,
    tool_calls_json: input.toolCalls?.length ? JSON.stringify(input.toolCalls) : null,
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
