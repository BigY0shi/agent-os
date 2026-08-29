// SPEC-F K1.2 — CRUD over the newsletter_* tables (migration 061).
//
// Opens the DB through the ONE opener (CONVENTIONS §1.2), never at module
// import time (§1.3). Timestamps are TEXT UTC ISO via ids.now() (§1.4).
//
// Ordering rule inherited from chunk 2: anything ordered by a timestamp
// tiebreaks on `rowid`, never on a random id — emails from one sync land in the
// same millisecond routinely, and a random tiebreak shuffles them.

import { randomBytes } from "node:crypto";
import { getDb } from "../db";
import { now } from "../ids";
import {
  isCadence,
  isParseStatus,
  isSubscriptionStatus,
  type Cadence,
  type NewsletterEmail,
  type ParseStatus,
  type Story,
  type StorySource,
  type Subscription,
  type SubscriptionStatus,
} from "./types";

const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** 12-char lowercase-alnum id (the spec's nanoid(12); nanoid is not a dep). */
export function shortId(len = 12): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return out;
}

/** YYYY-MM-DD in the server's local day (the edition bucket). */
export function today(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ── row mapping ──────────────────────────────────────────────────────────────

interface SubRow {
  id: string;
  name: string;
  topic: string | null;
  alias_id: string | null;
  alias_email: string | null;
  signup_url: string | null;
  cadence: string;
  status: string;
  created_at: string;
  updated_at: string | null;
}

interface EmailRow {
  id: string;
  gmail_id: string;
  thread_id: string | null;
  subscription_id: string | null;
  from_addr: string | null;
  to_addr: string | null;
  subject: string | null;
  received_at: string;
  content_md: string;
  parse_status: string;
  parse_error: string | null;
  created_at: string;
}

interface StoryRow {
  id: string;
  title: string;
  canonical_url: string | null;
  summary: string;
  topic: string | null;
  embedding: Buffer | Uint8Array | null;
  first_seen: string;
  created_at: string;
}

interface SourceRow {
  story_id: string;
  email_id: string;
  source_name: string;
  item_url: string | null;
  item_title: string | null;
}

function toSub(r: SubRow): Subscription {
  return {
    id: r.id,
    name: r.name,
    topic: r.topic,
    aliasId: r.alias_id,
    aliasEmail: r.alias_email,
    signupUrl: r.signup_url,
    cadence: (isCadence(r.cadence) ? r.cadence : "unknown") as Cadence,
    status: (isSubscriptionStatus(r.status) ? r.status : "active") as SubscriptionStatus,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toEmail(r: EmailRow): NewsletterEmail {
  return {
    id: r.id,
    gmailId: r.gmail_id,
    threadId: r.thread_id,
    subscriptionId: r.subscription_id,
    fromAddr: r.from_addr,
    toAddr: r.to_addr,
    subject: r.subject,
    receivedAt: r.received_at,
    contentMd: r.content_md,
    parseStatus: (isParseStatus(r.parse_status) ? r.parse_status : "pending") as ParseStatus,
    parseError: r.parse_error,
    createdAt: r.created_at,
  };
}

function toStory(r: StoryRow): Story {
  return {
    id: r.id,
    title: r.title,
    canonicalUrl: r.canonical_url,
    summary: r.summary,
    topic: r.topic,
    firstSeen: r.first_seen,
    createdAt: r.created_at,
  };
}

function toSource(r: SourceRow): StorySource {
  return {
    storyId: r.story_id,
    emailId: r.email_id,
    sourceName: r.source_name,
    itemUrl: r.item_url,
    itemTitle: r.item_title,
  };
}

// ── embeddings (BLOB ⇄ Float32Array, little-endian) ──────────────────────────

export function encodeEmbedding(vec: number[] | Float32Array): Buffer {
  const f32 = vec instanceof Float32Array ? vec : Float32Array.from(vec);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

export function decodeEmbedding(blob: Buffer | Uint8Array | null): Float32Array | null {
  if (!blob || blob.byteLength === 0 || blob.byteLength % 4 !== 0) return null;
  // Copy: the sqlite buffer is not guaranteed to be 4-byte aligned, and a
  // Float32Array view over a misaligned offset throws.
  const copy = Buffer.from(blob);
  return new Float32Array(copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength));
}

// ── subscriptions ────────────────────────────────────────────────────────────

export interface CreateSubscriptionInput {
  name: string;
  topic?: string | null;
  aliasId?: string | null;
  aliasEmail?: string | null;
  signupUrl?: string | null;
  cadence?: Cadence;
  status?: SubscriptionStatus;
}

export function createSubscription(input: CreateSubscriptionInput): Subscription {
  const id = shortId();
  getDb()
    .prepare(
      `INSERT INTO newsletter_subscriptions
         (id, name, topic, alias_id, alias_email, signup_url, cadence, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(
      id,
      input.name,
      input.topic ?? null,
      input.aliasId ?? null,
      input.aliasEmail ? input.aliasEmail.toLowerCase() : null,
      input.signupUrl ?? null,
      input.cadence ?? "unknown",
      input.status ?? "active",
      now(),
    );
  return getSubscription(id)!;
}

export function getSubscription(id: string): Subscription | null {
  const row = getDb().prepare("SELECT * FROM newsletter_subscriptions WHERE id = ?").get(id) as
    | SubRow
    | undefined;
  return row ? toSub(row) : null;
}

export function listSubscriptions(filter: { status?: SubscriptionStatus } = {}): Subscription[] {
  const rows = filter.status
    ? (getDb()
        .prepare(
          "SELECT * FROM newsletter_subscriptions WHERE status = ? ORDER BY created_at, rowid",
        )
        .all(filter.status) as SubRow[])
    : (getDb()
        .prepare("SELECT * FROM newsletter_subscriptions ORDER BY created_at, rowid")
        .all() as SubRow[]);
  return rows.map(toSub);
}

/** Alias → subscription, the sync's to_addr match. Case-insensitive. */
export function findSubscriptionByAlias(aliasEmail: string): Subscription | null {
  const row = getDb()
    .prepare("SELECT * FROM newsletter_subscriptions WHERE lower(alias_email) = ?")
    .get(aliasEmail.trim().toLowerCase()) as SubRow | undefined;
  return row ? toSub(row) : null;
}

export interface PatchSubscriptionInput {
  name?: string;
  topic?: string | null;
  cadence?: Cadence;
  status?: SubscriptionStatus;
  aliasId?: string | null;
  aliasEmail?: string | null;
  signupUrl?: string | null;
}

export function patchSubscription(id: string, patch: PatchSubscriptionInput): Subscription | null {
  const existing = getSubscription(id);
  if (!existing) return null;
  const sets: string[] = [];
  const args: unknown[] = [];
  const put = (col: string, val: unknown) => {
    sets.push(`${col} = ?`);
    args.push(val);
  };
  if (patch.name !== undefined) put("name", patch.name);
  if (patch.topic !== undefined) put("topic", patch.topic);
  if (patch.cadence !== undefined) put("cadence", patch.cadence);
  if (patch.status !== undefined) put("status", patch.status);
  if (patch.aliasId !== undefined) put("alias_id", patch.aliasId);
  if (patch.aliasEmail !== undefined)
    put("alias_email", patch.aliasEmail ? patch.aliasEmail.toLowerCase() : null);
  if (patch.signupUrl !== undefined) put("signup_url", patch.signupUrl);
  if (sets.length === 0) return existing;
  sets.push("updated_at = ?");
  args.push(now(), id);
  getDb()
    .prepare(`UPDATE newsletter_subscriptions SET ${sets.join(", ")} WHERE id = ?`)
    .run(...args);
  return getSubscription(id);
}

// ── emails ───────────────────────────────────────────────────────────────────

export interface InsertEmailInput {
  gmailId: string;
  threadId?: string | null;
  subscriptionId?: string | null;
  fromAddr?: string | null;
  toAddr?: string | null;
  subject?: string | null;
  /** ISO UTC — derived from the Gmail internalDate. */
  receivedAt: string;
  contentMd?: string;
  parseStatus?: ParseStatus;
}

/**
 * INSERT OR IGNORE on gmail_id — the natural idempotency key. Returns null when
 * the message was already stored, which is exactly what the watermark boundary
 * re-list produces (see sync.ts): a no-op, not a duplicate.
 */
export function insertEmail(input: InsertEmailInput): NewsletterEmail | null {
  const id = shortId();
  const res = getDb()
    .prepare(
      `INSERT OR IGNORE INTO newsletter_emails
         (id, gmail_id, thread_id, subscription_id, from_addr, to_addr, subject,
          received_at, content_md, parse_status, parse_error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .run(
      id,
      input.gmailId,
      input.threadId ?? null,
      input.subscriptionId ?? null,
      input.fromAddr ?? null,
      input.toAddr ?? null,
      input.subject ?? null,
      input.receivedAt,
      input.contentMd ?? "",
      input.parseStatus ?? "pending",
      now(),
    );
  if (res.changes === 0) return null;
  return getEmail(id);
}

export function getEmail(id: string): NewsletterEmail | null {
  const row = getDb().prepare("SELECT * FROM newsletter_emails WHERE id = ?").get(id) as
    | EmailRow
    | undefined;
  return row ? toEmail(row) : null;
}

export function getEmailByGmailId(gmailId: string): NewsletterEmail | null {
  const row = getDb().prepare("SELECT * FROM newsletter_emails WHERE gmail_id = ?").get(gmailId) as
    | EmailRow
    | undefined;
  return row ? toEmail(row) : null;
}

export function listEmails(
  filter: { parseStatus?: ParseStatus; subscriptionId?: string; limit?: number } = {},
): NewsletterEmail[] {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 1000);
  const where: string[] = [];
  const args: unknown[] = [];
  if (filter.parseStatus) {
    where.push("parse_status = ?");
    args.push(filter.parseStatus);
  }
  if (filter.subscriptionId) {
    where.push("subscription_id = ?");
    args.push(filter.subscriptionId);
  }
  const rows = getDb()
    .prepare(
      `SELECT * FROM newsletter_emails
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY received_at DESC, rowid DESC
       LIMIT ?`,
    )
    .all(...args, limit) as EmailRow[];
  return rows.map(toEmail);
}

/** Settle one email's parse outcome. Exactly one of parsed/failed/skipped. */
export function setEmailParseResult(
  id: string,
  result: { status: "parsed" | "skipped" } | { status: "failed"; error: string },
): NewsletterEmail | null {
  getDb()
    .prepare("UPDATE newsletter_emails SET parse_status = ?, parse_error = ? WHERE id = ?")
    .run(result.status, "error" in result ? result.error : null, id);
  return getEmail(id);
}

/** Newest received_at across stored emails (diagnostics / UI "last seen"). */
export function latestEmailAt(subscriptionId?: string): string | null {
  const row = subscriptionId
    ? (getDb()
        .prepare(
          "SELECT MAX(received_at) AS m FROM newsletter_emails WHERE subscription_id = ?",
        )
        .get(subscriptionId) as { m: string | null })
    : (getDb().prepare("SELECT MAX(received_at) AS m FROM newsletter_emails").get() as {
        m: string | null;
      });
  return row.m ?? null;
}

// ── stories + sources ────────────────────────────────────────────────────────

export interface CreateStoryInput {
  title: string;
  canonicalUrl?: string | null;
  summary?: string;
  topic?: string | null;
  embedding?: number[] | Float32Array | null;
  /** YYYY-MM-DD bucket; defaults to today. */
  firstSeen?: string;
}

export function createStory(input: CreateStoryInput): Story {
  const id = shortId();
  getDb()
    .prepare(
      `INSERT INTO newsletter_stories
         (id, title, canonical_url, summary, topic, embedding, first_seen, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.title,
      input.canonicalUrl ?? null,
      input.summary ?? "",
      input.topic ?? null,
      input.embedding ? encodeEmbedding(input.embedding) : null,
      input.firstSeen ?? today(),
      now(),
    );
  return getStory(id)!;
}

export function getStory(id: string): Story | null {
  const row = getDb().prepare("SELECT * FROM newsletter_stories WHERE id = ?").get(id) as
    | StoryRow
    | undefined;
  return row ? toStory(row) : null;
}

export function findStoryByCanonicalUrl(canonicalUrl: string): Story | null {
  const row = getDb()
    .prepare("SELECT * FROM newsletter_stories WHERE canonical_url = ?")
    .get(canonicalUrl) as StoryRow | undefined;
  return row ? toStory(row) : null;
}

/** Stories in a date window, WITH their embeddings — the bounded dedupe scan. */
export function listStoriesWithEmbeddings(sinceDate: string): Array<Story & { embedding: Float32Array | null }> {
  const rows = getDb()
    .prepare(
      "SELECT * FROM newsletter_stories WHERE first_seen >= ? ORDER BY first_seen DESC, rowid DESC",
    )
    .all(sinceDate) as StoryRow[];
  return rows.map((r) => ({ ...toStory(r), embedding: decodeEmbedding(r.embedding) }));
}

export function listStoriesForDate(date: string): Story[] {
  const rows = getDb()
    .prepare("SELECT * FROM newsletter_stories WHERE first_seen = ? ORDER BY created_at, rowid")
    .all(date) as StoryRow[];
  return rows.map(toStory);
}

export function patchStory(
  id: string,
  patch: { title?: string; summary?: string; topic?: string | null; canonicalUrl?: string | null },
): Story | null {
  const existing = getStory(id);
  if (!existing) return null;
  const sets: string[] = [];
  const args: unknown[] = [];
  if (patch.title !== undefined) {
    sets.push("title = ?");
    args.push(patch.title);
  }
  if (patch.summary !== undefined) {
    sets.push("summary = ?");
    args.push(patch.summary);
  }
  if (patch.topic !== undefined) {
    sets.push("topic = ?");
    args.push(patch.topic);
  }
  if (patch.canonicalUrl !== undefined) {
    sets.push("canonical_url = ?");
    args.push(patch.canonicalUrl);
  }
  if (sets.length === 0) return existing;
  args.push(id);
  getDb()
    .prepare(`UPDATE newsletter_stories SET ${sets.join(", ")} WHERE id = ?`)
    .run(...args);
  return getStory(id);
}

/**
 * Attach a source (one email's take on a story). INSERT OR IGNORE on the
 * (story_id, email_id) PK: an email that lists the same story twice contributes
 * one chip, not two. Returns true when a NEW source row landed.
 */
export function addStorySource(input: {
  storyId: string;
  emailId: string;
  sourceName: string;
  itemUrl?: string | null;
  itemTitle?: string | null;
}): boolean {
  const res = getDb()
    .prepare(
      `INSERT OR IGNORE INTO newsletter_story_sources
         (story_id, email_id, source_name, item_url, item_title)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      input.storyId,
      input.emailId,
      input.sourceName,
      input.itemUrl ?? null,
      input.itemTitle ?? null,
    );
  return res.changes > 0;
}

export function listStorySources(storyId: string): StorySource[] {
  const rows = getDb()
    .prepare("SELECT * FROM newsletter_story_sources WHERE story_id = ? ORDER BY rowid")
    .all(storyId) as SourceRow[];
  return rows.map(toSource);
}

// ── editions (rows only; K4.1 builds the document) ───────────────────────────

/**
 * Upsert one edition row. `builtAt` is accepted so the caller can stamp the
 * SAME instant into the stored EditionDoc and the row (K4.1: the doc's builtAt
 * is what the idempotency guard compares, so the two must not drift).
 */
export function upsertEdition(
  date: string,
  content: unknown,
  builtAtOverride?: string,
): { date: string; builtAt: string } {
  const builtAt = builtAtOverride ?? now();
  getDb()
    .prepare(
      `INSERT INTO newsletter_editions(date, built_at, content) VALUES (?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET built_at = excluded.built_at, content = excluded.content`,
    )
    .run(date, builtAt, JSON.stringify(content));
  return { date, builtAt };
}

export function getEdition(date: string): { date: string; builtAt: string; content: unknown } | null {
  const row = getDb().prepare("SELECT * FROM newsletter_editions WHERE date = ?").get(date) as
    | { date: string; built_at: string; content: string }
    | undefined;
  if (!row) return null;
  let content: unknown = null;
  try {
    content = JSON.parse(row.content);
  } catch {
    content = null;
  }
  return { date: row.date, builtAt: row.built_at, content };
}

export function listEditionDates(limit = 90): string[] {
  const rows = getDb()
    .prepare("SELECT date FROM newsletter_editions ORDER BY date DESC LIMIT ?")
    .all(Math.min(Math.max(limit, 1), 500)) as { date: string }[];
  return rows.map((r) => r.date);
}

// ── state (watermark + misc) ─────────────────────────────────────────────────

export function getState(key: string): string | null {
  const row = getDb().prepare("SELECT v FROM newsletter_state WHERE k = ?").get(key) as
    | { v: string }
    | undefined;
  return row ? row.v : null;
}

export function setState(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO newsletter_state(k, v) VALUES (?, ?)
       ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
    )
    .run(key, value);
}

export function getStateJson<T>(key: string): T | null {
  const raw = getState(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function setStateJson(key: string, value: unknown): void {
  setState(key, JSON.stringify(value));
}

/** Watermark key names, in one place so sync + status never drift. */
export const STATE_LAST_SYNC = "lastSyncTime";
export const STATE_LAST_RUN = "lastRun";
export const STATE_LAST_EDITION = "lastEditionDate";
