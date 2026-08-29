import { getDb } from "../db";
import { uuid, now } from "../ids";
import { emit } from "../events";
import { readSettings } from "../../settings";

/**
 * SPEC-B B5 — scratchpad page store (migration 021 v2_pages/v2_page_comments).
 *
 * Yjs is DEFERRED (SPEC-B §1.1): pages are single-client TipTap JSON with a
 * rev-based optimistic lock. ALL doc I/O goes through loadPageDoc/savePage/
 * savePageDocInternal — that contract is the seam a future Yjs transport swaps
 * in behind without changing callers (REF hocuspocus/content.server.ts,
 * pattern-only: headless Yjs mutation → plain JSON mutation + rev bump).
 *
 * Comment anchors (REF butler-comment.server.ts, pattern-only): paragraph
 * attrs.nodeId + normalized-text fallback instead of Yjs relative positions.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal TipTap/ProseMirror JSON node shape (client-safe). */
export interface PageDocNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: PageDocNode[];
  text?: string;
  marks?: unknown[];
}

export interface Page {
  id: string;
  date: string | null; // 'YYYY-MM-DD' in settings.tasks.timezone; null = non-daily
  title: string;
  doc: PageDocNode;
  rev: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PageComment {
  id: string;
  pageId: string;
  anchorNodeId: string | null;
  anchorTextNorm: string | null;
  author: "jarvis" | "user";
  bodyMd: string;
  conversationId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/** Stale-save rejection: HTTP layer maps this to 409 + the current doc. */
export class RevConflictError extends Error {
  status = 409 as const;
  current: { docJson: PageDocNode; rev: number };
  constructor(current: { docJson: PageDocNode; rev: number }) {
    super("stale rev: page changed since this client loaded it");
    this.current = current;
  }
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

interface PageRow {
  id: string;
  date: string | null;
  title: string;
  doc_json: string;
  rev: number;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export function emptyDoc(): PageDocNode {
  return { type: "doc", content: [] };
}

function parseDoc(s: string): PageDocNode {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as PageDocNode) : emptyDoc();
  } catch {
    return emptyDoc();
  }
}

function parseMeta(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function rowToPage(r: PageRow): Page {
  return {
    id: r.id,
    date: r.date,
    title: r.title,
    doc: parseDoc(r.doc_json),
    rev: r.rev,
    metadata: parseMeta(r.metadata),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function getRow(id: string): PageRow | undefined {
  return getDb().prepare("SELECT * FROM v2_pages WHERE id = ?").get(id) as
    | PageRow
    | undefined;
}

// ---------------------------------------------------------------------------
// Daily date key (settings.tasks.timezone — the single tz source)
// ---------------------------------------------------------------------------

/** 'YYYY-MM-DD' for a UTC instant in the user's timezone. NOT imported from
 *  tasks/recurrence to avoid the dispatch→pages import cycle. */
export function localDateStr(d: Date = new Date()): string {
  const tz = readSettings().tasks?.timezone;
  const zone = typeof tz === "string" && tz.trim() ? tz.trim() : "America/Chicago";
  try {
    // en-CA renders YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function getPage(id: string): Page | null {
  const r = getRow(id);
  return r ? rowToPage(r) : null;
}

export function getPageByDate(date: string): Page | null {
  const r = getDb().prepare("SELECT * FROM v2_pages WHERE date = ?").get(date) as
    | PageRow
    | undefined;
  return r ? rowToPage(r) : null;
}

/** Find-or-create the daily page for a 'YYYY-MM-DD' key (default: today in
 *  settings.tasks.timezone). */
export function getOrCreateDailyPage(date?: string): Page {
  const key = date && DATE_RE.test(date) ? date : localDateStr();
  const existing = getPageByDate(key);
  if (existing) return existing;
  const id = uuid();
  const ts = now();
  try {
    getDb()
      .prepare(
        "INSERT INTO v2_pages(id, date, title, doc_json, rev, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, 0, '{}', ?, ?)",
      )
      .run(id, key, key, JSON.stringify(emptyDoc()), ts, ts);
  } catch {
    // Unique(date) race: someone else created it between select and insert.
    const raced = getPageByDate(key);
    if (raced) return raced;
    throw new Error(`failed to create daily page for ${key}`);
  }
  emit("page.created", { pageId: id, date: key }, "pages");
  return getPage(id)!;
}

export function listPages(limit = 60): Page[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM v2_pages ORDER BY (date IS NULL), date DESC, created_at DESC LIMIT ?",
    )
    .all(Math.min(Math.max(limit, 1), 500)) as PageRow[];
  return rows.map(rowToPage);
}

export interface SavePageInput {
  id: string;
  docJson: PageDocNode;
  rev: number; // the rev the client loaded — CAS token
}

/**
 * Client save with optimistic-lock CAS: the UPDATE only lands when the stored
 * rev still equals the client's. A stale rev throws RevConflictError carrying
 * the CURRENT doc+rev so the client can refetch-merge (SPEC-B §1.1).
 */
export function savePage(input: SavePageInput): Page {
  const db = getDb();
  const row = getRow(input.id);
  if (!row) throw new Error(`page ${input.id} not found`);
  const res = db
    .prepare(
      "UPDATE v2_pages SET doc_json = ?, rev = rev + 1, updated_at = ? WHERE id = ? AND rev = ?",
    )
    .run(JSON.stringify(input.docJson ?? emptyDoc()), now(), input.id, input.rev);
  if (res.changes === 0) {
    const current = getRow(input.id)!;
    throw new RevConflictError({ docJson: parseDoc(current.doc_json), rev: current.rev });
  }
  return getPage(input.id)!;
}

/**
 * Server-side doc mutation (butler attr write-backs, node strips): bumps rev
 * WITHOUT a CAS token — the client's next stale save 409s and refetches, which
 * is exactly the recovery contract. Part of the Yjs seam.
 */
export function savePageDocInternal(id: string, doc: PageDocNode): Page {
  const db = getDb();
  const res = db
    .prepare("UPDATE v2_pages SET doc_json = ?, rev = rev + 1, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(doc ?? emptyDoc()), now(), id);
  if (res.changes === 0) throw new Error(`page ${id} not found`);
  return getPage(id)!;
}

/** Merge-patch page metadata (lastIngestHash etc). Does NOT bump rev — metadata
 *  is server bookkeeping, not doc content. */
export function patchPageMetadata(id: string, patch: Record<string, unknown>): Page {
  const row = getRow(id);
  if (!row) throw new Error(`page ${id} not found`);
  const merged = { ...parseMeta(row.metadata), ...patch };
  getDb()
    .prepare("UPDATE v2_pages SET metadata = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(merged), now(), id);
  return getPage(id)!;
}

// ---------------------------------------------------------------------------
// Doc tree helpers (REF page-outlinks.server.ts tree-walkers, verbatim-adapt)
// ---------------------------------------------------------------------------

/** Depth-first walk; fn returning false prunes descent into that node. */
export function walkNodes(node: PageDocNode, fn: (node: PageDocNode, parent: PageDocNode | null) => boolean | void, parent: PageDocNode | null = null): void {
  if (!node || typeof node !== "object") return;
  if (fn(node, parent) === false) return;
  if (Array.isArray(node.content)) {
    for (const child of node.content) walkNodes(child, fn, node);
  }
}

/** Concatenated text of a node's subtree. */
export function nodeText(node: PageDocNode): string {
  let out = "";
  walkNodes(node, (n) => {
    if (typeof n.text === "string") out += n.text;
  });
  return out;
}

/** Normalized paragraph text: whitespace collapsed, trimmed, lowercased —
 *  the comment dedupe key + fallback anchor (REF comment-tools.ts). */
export function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Every taskItem node in the doc (with its own text). */
export function findTaskItemNodes(doc: PageDocNode): Array<{ node: PageDocNode; text: string }> {
  const out: Array<{ node: PageDocNode; text: string }> = [];
  walkNodes(doc, (n) => {
    if (n.type === "taskItem") {
      out.push({ node: n, text: nodeText(n).trim() });
      return false; // taskItems don't nest taskItems we care about separately
    }
  });
  return out;
}

/** taskUuids currently bound in the doc. */
export function collectTaskUuids(doc: PageDocNode): string[] {
  const out: string[] = [];
  for (const { node } of findTaskItemNodes(doc)) {
    const id = node.attrs?.taskUuid;
    if (typeof id === "string" && id) out.push(id);
  }
  return out;
}

/** Remove every taskItem bound to taskUuid; prunes taskLists left empty.
 *  Returns true when the doc changed. Mutates in place. */
export function removeTaskItemNodes(doc: PageDocNode, taskUuid: string): boolean {
  let changed = false;
  const prune = (node: PageDocNode): void => {
    if (!Array.isArray(node.content)) return;
    const before = node.content.length;
    node.content = node.content.filter(
      (c) => !(c.type === "taskItem" && c.attrs?.taskUuid === taskUuid),
    );
    if (node.content.length !== before) changed = true;
    for (const child of node.content) prune(child);
    // A taskList with no items left is invalid — drop it.
    node.content = node.content.filter(
      (c) => !(c.type === "taskList" && (!Array.isArray(c.content) || c.content.length === 0)),
    );
  };
  prune(doc);
  return changed;
}

// ---------------------------------------------------------------------------
// Page ↔ task links (v2_page_task_links, migration 020)
// ---------------------------------------------------------------------------

export function linkTaskToPage(pageId: string, taskId: string): void {
  getDb()
    .prepare("INSERT OR IGNORE INTO v2_page_task_links(page_id, task_id) VALUES (?, ?)")
    .run(pageId, taskId);
}

export function unlinkTaskFromPage(pageId: string, taskId: string): void {
  getDb()
    .prepare("DELETE FROM v2_page_task_links WHERE page_id = ? AND task_id = ?")
    .run(pageId, taskId);
}

export function listPageTaskIds(pageId: string): string[] {
  return (
    getDb()
      .prepare("SELECT task_id FROM v2_page_task_links WHERE page_id = ?")
      .all(pageId) as { task_id: string }[]
  ).map((r) => r.task_id);
}

export function pagesForTask(taskId: string): string[] {
  return (
    getDb()
      .prepare("SELECT page_id FROM v2_page_task_links WHERE task_id = ?")
      .all(taskId) as { page_id: string }[]
  ).map((r) => r.page_id);
}

/**
 * Strip a task's bound taskItem node from every page that references it and
 * drop the link rows — fills the dispatch.ts buffer-GC TODO (chunk-2 handoff).
 * Returns the number of pages whose doc changed.
 */
export function removeTaskItemFromPages(taskUuid: string): number {
  const pageIds = pagesForTask(taskUuid);
  let touched = 0;
  for (const pageId of pageIds) {
    const page = getPage(pageId);
    if (page) {
      const doc = page.doc;
      if (removeTaskItemNodes(doc, taskUuid)) {
        savePageDocInternal(pageId, doc);
        touched++;
      }
    }
    unlinkTaskFromPage(pageId, taskUuid);
  }
  return touched;
}

// ---------------------------------------------------------------------------
// Comments CRUD
// ---------------------------------------------------------------------------

interface CommentRow {
  id: string;
  page_id: string;
  anchor_node_id: string | null;
  anchor_text_norm: string | null;
  author: string;
  body_md: string;
  conversation_id: string | null;
  created_at: string;
  resolved_at: string | null;
}

function rowToComment(r: CommentRow): PageComment {
  return {
    id: r.id,
    pageId: r.page_id,
    anchorNodeId: r.anchor_node_id,
    anchorTextNorm: r.anchor_text_norm,
    author: r.author as PageComment["author"],
    bodyMd: r.body_md,
    conversationId: r.conversation_id,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
  };
}

export interface CreateCommentInput {
  pageId: string;
  bodyMd: string;
  author?: "jarvis" | "user";
  anchorNodeId?: string | null;
  anchorTextNorm?: string | null;
  conversationId?: string | null;
}

export function createPageComment(input: CreateCommentInput): PageComment {
  if (!getRow(input.pageId)) throw new Error(`page ${input.pageId} not found`);
  const id = uuid();
  getDb()
    .prepare(
      `INSERT INTO v2_page_comments(id, page_id, anchor_node_id, anchor_text_norm, author, body_md, conversation_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.pageId,
      input.anchorNodeId ?? null,
      input.anchorTextNorm ?? null,
      input.author ?? "jarvis",
      input.bodyMd,
      input.conversationId ?? null,
      now(),
    );
  return getPageComment(id)!;
}

export function getPageComment(id: string): PageComment | null {
  const r = getDb().prepare("SELECT * FROM v2_page_comments WHERE id = ?").get(id) as
    | CommentRow
    | undefined;
  return r ? rowToComment(r) : null;
}

export function listPageComments(pageId: string): PageComment[] {
  const rows = getDb()
    .prepare("SELECT * FROM v2_page_comments WHERE page_id = ? ORDER BY created_at, id")
    .all(pageId) as CommentRow[];
  return rows.map(rowToComment);
}

export function setCommentResolved(id: string, resolved: boolean): PageComment {
  const res = getDb()
    .prepare("UPDATE v2_page_comments SET resolved_at = ? WHERE id = ?")
    .run(resolved ? now() : null, id);
  if (res.changes === 0) throw new Error(`comment ${id} not found`);
  return getPageComment(id)!;
}
