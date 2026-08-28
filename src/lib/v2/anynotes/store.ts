// SPEC-F I1.1 — CRUD over `anynotes` / `anynote_replies` (migration 060).
// Opens the DB through the ONE opener (CONVENTIONS §1.2) and never at module
// import time (§1.3). Timestamps are TEXT UTC ISO via ids.now() (§1.4).
//
// DELETE is EXILE: the row (and its whole thread) is copied into
// anynotes_exile / anynote_replies_exile before being removed from the live
// tables. Nothing an agent captured is ever destroyed (house rule).

import { randomBytes } from "node:crypto";
import { getDb } from "../db";
import { now } from "../ids";
import {
  isNoteStatus,
  isNoteType,
  type Note,
  type NoteStatus,
  type NoteType,
  type Reply,
  type ReplyAuthor,
} from "./types";

// ── ids ──────────────────────────────────────────────────────────────────────

const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** 12-char lowercase-alnum id (the spec's nanoid(12); nanoid is not a dep). */
export function shortId(len = 12): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return out;
}

// ── row mapping ──────────────────────────────────────────────────────────────

interface NoteDbRow {
  id: string;
  url: string | null;
  type: string;
  title: string;
  author: string | null;
  site: string | null;
  content_md: string;
  media_path: string | null;
  thumb_url: string | null;
  status: string;
  labels: string;
  meta: string;
  episode_id: string | null;
  captured_at: string;
  updated_at: string | null;
}

interface ReplyDbRow {
  id: string;
  note_id: string;
  author: string;
  body: string;
  pending: number;
  error: string | null;
  created_at: string;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const v = JSON.parse(raw);
    return v === null || v === undefined ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

function toNote(r: NoteDbRow): Note {
  const labels = parseJson<unknown>(r.labels, []);
  return {
    id: r.id,
    url: r.url,
    type: (isNoteType(r.type) ? r.type : "text") as NoteType,
    title: r.title,
    author: r.author,
    site: r.site,
    contentMd: r.content_md,
    mediaPath: r.media_path,
    thumbUrl: r.thumb_url,
    status: (isNoteStatus(r.status) ? r.status : "inbox") as NoteStatus,
    labels: Array.isArray(labels) ? labels.filter((l): l is string => typeof l === "string") : [],
    meta: parseJson<Record<string, unknown>>(r.meta, {}),
    episodeId: r.episode_id,
    capturedAt: r.captured_at,
    updatedAt: r.updated_at,
  };
}

function toReply(r: ReplyDbRow): Reply {
  return {
    id: r.id,
    noteId: r.note_id,
    author: (r.author === "jarvis" ? "jarvis" : "user") as ReplyAuthor,
    body: r.body,
    pending: r.pending === 1,
    error: r.error,
    createdAt: r.created_at,
  };
}

// ── notes ────────────────────────────────────────────────────────────────────

export interface CreateNoteInput {
  type: NoteType;
  url?: string | null;
  title?: string;
  author?: string | null;
  site?: string | null;
  contentMd?: string;
  mediaPath?: string | null;
  thumbUrl?: string | null;
  status?: NoteStatus;
  labels?: string[];
  meta?: Record<string, unknown>;
}

export function createNote(input: CreateNoteInput): Note {
  const id = shortId();
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO anynotes
         (id, url, type, title, author, site, content_md, media_path, thumb_url,
          status, labels, meta, episode_id, captured_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)`,
    )
    .run(
      id,
      input.url ?? null,
      input.type,
      input.title ?? "",
      input.author ?? null,
      input.site ?? null,
      input.contentMd ?? "",
      input.mediaPath ?? null,
      input.thumbUrl ?? null,
      input.status ?? "inbox",
      JSON.stringify(input.labels ?? []),
      JSON.stringify(input.meta ?? {}),
      ts,
    );
  return getNote(id)!;
}

export interface ListFilter {
  status?: NoteStatus | "all";
  type?: NoteType;
  label?: string;
  q?: string;
  limit?: number;
  /** ISO cursor — return notes captured strictly BEFORE this (keyset paging). */
  before?: string;
}

export function listNotes(filter: ListFilter = {}): Note[] {
  const limit = Math.min(Math.max(filter.limit ?? 60, 1), 500);
  const where: string[] = [];
  const args: unknown[] = [];

  if (filter.status && filter.status !== "all") {
    where.push("status = ?");
    args.push(filter.status);
  }
  if (filter.type) {
    where.push("type = ?");
    args.push(filter.type);
  }
  if (filter.label) {
    // labels is a JSON string[] — match the quoted element, not a substring of
    // some other label ("ai" must not match "ai-agents").
    where.push("labels LIKE ?");
    args.push(`%${JSON.stringify(filter.label)}%`);
  }
  if (filter.q && filter.q.trim()) {
    where.push("(title LIKE ? OR content_md LIKE ? OR url LIKE ?)");
    const like = `%${filter.q.trim()}%`;
    args.push(like, like, like);
  }
  if (filter.before) {
    where.push("captured_at < ?");
    args.push(filter.before);
  }

  const rows = getDb()
    .prepare(
      `SELECT * FROM anynotes
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY captured_at DESC, id DESC
       LIMIT ?`,
    )
    .all(...args, limit) as NoteDbRow[];
  return rows.map(toNote);
}

export function getNote(id: string): Note | null {
  const row = getDb().prepare("SELECT * FROM anynotes WHERE id = ?").get(id) as
    | NoteDbRow
    | undefined;
  return row ? toNote(row) : null;
}

export function countsByStatus(): Record<NoteStatus, number> {
  const rows = getDb()
    .prepare("SELECT status, COUNT(*) AS n FROM anynotes GROUP BY status")
    .all() as { status: string; n: number }[];
  const out: Record<NoteStatus, number> = { inbox: 0, kept: 0, archived: 0 };
  for (const r of rows) if (isNoteStatus(r.status)) out[r.status] = r.n;
  return out;
}

export interface PatchNoteInput {
  status?: NoteStatus;
  labels?: string[];
  title?: string;
  /** Internal (I2.2) — the Memory V2 queue id for this note's episode. */
  episodeId?: string | null;
  /** Internal — shallow-merged into the existing meta JSON. */
  meta?: Record<string, unknown>;
}

export function patchNote(id: string, patch: PatchNoteInput): Note | null {
  const existing = getNote(id);
  if (!existing) return null;

  const sets: string[] = [];
  const args: unknown[] = [];
  if (patch.status !== undefined) {
    sets.push("status = ?");
    args.push(patch.status);
  }
  if (patch.labels !== undefined) {
    sets.push("labels = ?");
    args.push(JSON.stringify(patch.labels));
  }
  if (patch.title !== undefined) {
    sets.push("title = ?");
    args.push(patch.title);
  }
  if (patch.episodeId !== undefined) {
    sets.push("episode_id = ?");
    args.push(patch.episodeId);
  }
  if (patch.meta !== undefined) {
    sets.push("meta = ?");
    args.push(JSON.stringify({ ...existing.meta, ...patch.meta }));
  }
  if (sets.length === 0) return existing;

  sets.push("updated_at = ?");
  args.push(now(), id);
  getDb()
    .prepare(`UPDATE anynotes SET ${sets.join(", ")} WHERE id = ?`)
    .run(...args);
  return getNote(id);
}

/**
 * Exile (the house-rule "delete"): copy the note AND its whole thread into the
 * *_exile tables, then remove them from the live tables — replies first, so the
 * anynote_replies → anynotes foreign key (db.ts runs `foreign_keys = ON`) never
 * trips. One transaction: a crash mid-exile cannot half-erase a note.
 */
export function exileNote(id: string): boolean {
  const db = getDb();
  const run = db.transaction((noteId: string) => {
    const row = db.prepare("SELECT id FROM anynotes WHERE id = ?").get(noteId);
    if (!row) return false;
    const ts = now();
    db.prepare(
      `INSERT OR REPLACE INTO anynote_replies_exile
         (id, note_id, author, body, pending, error, created_at, exiled_at)
       SELECT id, note_id, author, body, pending, error, created_at, ?
         FROM anynote_replies WHERE note_id = ?`,
    ).run(ts, noteId);
    db.prepare(
      `INSERT OR REPLACE INTO anynotes_exile
         (id, url, type, title, author, site, content_md, media_path, thumb_url,
          status, labels, meta, episode_id, captured_at, updated_at, exiled_at)
       SELECT id, url, type, title, author, site, content_md, media_path, thumb_url,
              status, labels, meta, episode_id, captured_at, updated_at, ?
         FROM anynotes WHERE id = ?`,
    ).run(ts, noteId);
    db.prepare("DELETE FROM anynote_replies WHERE note_id = ?").run(noteId);
    db.prepare("DELETE FROM anynotes WHERE id = ?").run(noteId);
    return true;
  });
  return run(id) as boolean;
}

/** The exiled row (audit / smoke assertions). */
export function getExiledNote(id: string): (Note & { exiledAt: string }) | null {
  const row = getDb().prepare("SELECT * FROM anynotes_exile WHERE id = ?").get(id) as
    | (NoteDbRow & { exiled_at: string })
    | undefined;
  return row ? { ...toNote(row), exiledAt: row.exiled_at } : null;
}

// ── replies ──────────────────────────────────────────────────────────────────

export interface AddReplyInput {
  noteId: string;
  author: ReplyAuthor;
  body: string;
  pending?: boolean;
}

export function addReply(input: AddReplyInput): Reply {
  const id = shortId();
  getDb()
    .prepare(
      `INSERT INTO anynote_replies (id, note_id, author, body, pending, error, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    )
    .run(id, input.noteId, input.author, input.body, input.pending ? 1 : 0, now());
  return getReply(id)!;
}

export function getReply(id: string): Reply | null {
  const row = getDb().prepare("SELECT * FROM anynote_replies WHERE id = ?").get(id) as
    | ReplyDbRow
    | undefined;
  return row ? toReply(row) : null;
}

export function listReplies(noteId: string): Reply[] {
  const rows = getDb()
    .prepare("SELECT * FROM anynote_replies WHERE note_id = ? ORDER BY created_at, id")
    .all(noteId) as ReplyDbRow[];
  return rows.map(toReply);
}

/**
 * Settle a pending jarvis reply. EXACTLY ONE of body/error wins and pending
 * always clears — a row can never be left "thinking…" forever (rule 11: a
 * failure is loud in the thread, not silence).
 */
export function setReplyResult(
  id: string,
  result: { body: string } | { error: string },
): Reply | null {
  const isError = "error" in result;
  getDb()
    .prepare("UPDATE anynote_replies SET body = ?, error = ?, pending = 0 WHERE id = ?")
    .run(isError ? "" : result.body, isError ? result.error : null, id);
  return getReply(id);
}

/** Count of jarvis replies still generating (widget/attention side data). */
export function pendingJarvisCount(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM anynote_replies WHERE author = 'jarvis' AND pending = 1")
    .get() as { n: number };
  return row.n;
}
