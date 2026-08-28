// SPEC-F K3.1 — the newsletter Gmail sync consumer.
//
// CONVENTIONS §7: there is ONE Gmail stack. This is a newsletter-specific sync
// consumer OVER SPEC-D's gmail connector — same `integration_accounts` row,
// same tokens, same `getGmail()` (so the same __setGoogleMockForTests seam
// keeps it offline-testable). SPEC-F's parallel OAuth pair, its own token store
// and its second gmail.ts are VOID and are NOT built here.
//
// WATERMARK — the one deliberate departure from SPEC-F §4/K3.1, and the reason:
//   The spec says `watermark = latest internalDate + 20s`. That exact skew was
//   a CONFIRMED data-loss bug in this repo's integrations sync
//   (HARDENING-2026-08-27 item 7, fixed in connectors/gmail/sync.ts): any mail
//   whose internalDate landed inside the 20-second window after the newest
//   processed message was silently treated as already-seen by the next run's
//   `after:` + skip filter, and was never ingested. There is nothing
//   newsletter-specific that makes the skew safe here, and newsletters arrive
//   in bursts — several from the same blast can share a second.
//   So: watermark = EXACT newest internalDate, the skip filter is strict `<`
//   (the boundary second is deliberately RE-listed), and `gmail_id UNIQUE` +
//   INSERT OR IGNORE make the re-listed boundary messages no-ops rather than
//   duplicates. Same shape as connectors/gmail/sync.ts, on purpose.
//
// Error split (SPEC-F §4): per-message failures are SOFT — the row is stored
// with parse_status='failed' + parse_error and the batch continues. Auth and
// configuration failures are LOUD — they throw, and the route answers 500.

import type { gmail_v1 } from "googleapis";
import { readSettings } from "../../settings";
import { emit } from "../events";
import { getAccount } from "../integrations/store";
import { buildCallCtx } from "../integrations/runtime";
import { getGmail } from "../integrations/connectors/googleClient";
import { extractEmailContent, type GmailMessagePart } from "../integrations/connectors/gmail/mime";
import { addyDomain, newsletterGmailAccountId } from "./config";
import { absorbItems, sourceNameFor } from "./dedupe";
import { extractItems, htmlToMarkdown } from "./parse";
import {
  STATE_LAST_RUN,
  STATE_LAST_SYNC,
  findSubscriptionByAlias,
  getEmailByGmailId,
  getState,
  insertEmail,
  listSubscriptions,
  setEmailParseResult,
  setState,
  setStateJson,
  today,
} from "./store";
import type { SyncRunResult } from "./types";

/** Gmail caps a single `q` sensibly; 25 aliases per OR-chunk stays well inside. */
const ALIAS_CHUNK = 25;
/** Per-list cap (SPEC-F K3.1). */
const MAX_MESSAGES = 100;

export class NewsletterConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NewsletterConfigError";
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __agentosNewsletterSyncing: boolean | undefined;
}

export function isSyncRunning(): boolean {
  return globalThis.__agentosNewsletterSyncing === true;
}

function lookbackDays(): number {
  const v = readSettings().newsletter?.lookbackDays;
  return typeof v === "number" && v > 0 && v <= 90 ? Math.floor(v) : 1;
}

function gmailLabel(): string {
  const v = readSettings().newsletter?.gmailLabel;
  return typeof v === "string" ? v.trim() : "";
}

function header(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  const h = (headers ?? []).find((x) => (x.name ?? "").toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

/** "Name <a@b.c>" → "a@b.c" (lowercased). Multi-address headers → first hit. */
export function extractAddress(raw: string): string {
  const angled = raw.match(/<([^>]+)>/);
  const candidate = angled ? angled[1] : raw;
  const m = candidate.match(/[^\s,;<>]+@[^\s,;<>]+/);
  return m ? m[0].trim().toLowerCase() : "";
}

/** ALL addresses on a header (Delivered-To / To can carry several). */
export function extractAddresses(raw: string): string[] {
  const out = new Set<string>();
  for (const m of raw.matchAll(/[^\s,;<>]+@[^\s,;<>]+/g)) out.add(m[0].trim().toLowerCase());
  return [...out];
}

function toGmailTimestamp(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

/**
 * The addressing filter, per CONVENTIONS §7: NO `*` wildcards (Gmail does not
 * support them). Explicit OR of the known alias addresses, chunked — plus an
 * optional `label:` query for the "unknown alias" case (a Gmail filter that
 * labels everything arriving at the addy domain). With NEITHER configured the
 * sync refuses to run rather than pulling the whole mailbox.
 */
export function buildQueries(aliases: string[], afterTs: number, label: string): string[] {
  const queries: string[] = [];
  for (let i = 0; i < aliases.length; i += ALIAS_CHUNK) {
    const chunk = aliases.slice(i, i + ALIAS_CHUNK);
    queries.push(`after:${afterTs} {${chunk.map((a) => `to:${a}`).join(" ")}}`);
  }
  if (label) queries.push(`after:${afterTs} label:${label}`);
  return queries;
}

interface ParsedMessage {
  gmailId: string;
  threadId: string | null;
  internalDate: number;
  fromAddr: string;
  toAddr: string;
  toAll: string[];
  subject: string;
  contentMd: string;
}

function parseMessage(msg: gmail_v1.Schema$Message): ParsedMessage {
  const headers = msg.payload?.headers ?? [];
  const { text, html } = extractEmailContent((msg.payload ?? {}) as GmailMessagePart);
  const deliveredTo = header(headers, "Delivered-To");
  const to = header(headers, "To");
  const toAll = [...extractAddresses(deliveredTo), ...extractAddresses(to)];
  return {
    gmailId: msg.id ?? "",
    threadId: msg.threadId ?? null,
    internalDate: parseInt(msg.internalDate ?? "0", 10),
    fromAddr: extractAddress(header(headers, "From")) || header(headers, "From"),
    toAddr: toAll[0] ?? "",
    toAll,
    subject: header(headers, "Subject") || "(no subject)",
    contentMd: htmlToMarkdown(html, text),
  };
}

/**
 * Run one incremental sync. Overlap-guarded: a second call while one is in
 * flight returns immediately with the reason (the watermark means nothing is
 * lost by skipping).
 */
export async function syncOnce(
  trigger: "manual" | "schedule" = "manual",
): Promise<SyncRunResult> {
  const ranAt = new Date().toISOString();
  const empty = (reason: string): SyncRunResult => ({
    fetched: 0,
    parsed: 0,
    failed: 0,
    skipped: 0,
    newStories: 0,
    merged: 0,
    embedDegraded: false,
    watermark: getState(STATE_LAST_SYNC),
    reason,
    ranAt,
  });

  if (isSyncRunning()) return empty("a sync is already running");

  // ── configuration: LOUD failures ──────────────────────────────────────────
  const accountId = newsletterGmailAccountId();
  if (!accountId) {
    throw new NewsletterConfigError(
      "no active Gmail account — connect the agent Gmail account on /integrations " +
        "(CONVENTIONS §7: the newsletter rides SPEC-D's gmail connector), then pin it " +
        "with settings.newsletter.gmailAccountId if you have more than one.",
    );
  }
  const account = getAccount(accountId);
  if (!account) throw new NewsletterConfigError(`gmail account ${accountId} not found`);
  if (!account.isActive) throw new NewsletterConfigError(`gmail account ${accountId} is disconnected`);

  const aliases = listSubscriptions({ status: "active" })
    .map((s) => s.aliasEmail)
    .filter((a): a is string => typeof a === "string" && a.includes("@"));
  const label = gmailLabel();
  if (aliases.length === 0 && !label) {
    // Deliberately NOT a wildcard fallback: `to:*@domain` is unsupported by
    // Gmail and a bare `after:` would drag the entire mailbox into the
    // newsletter store.
    return empty(
      `no addressing filter: no active subscription has an alias, and settings.newsletter.gmailLabel is empty. ` +
        `Add a subscription (its addy alias becomes the filter) or set a Gmail label for ` +
        `${addyDomain() || "your addy domain"} mail.`,
    );
  }

  globalThis.__agentosNewsletterSyncing = true;
  const result: SyncRunResult = {
    fetched: 0,
    parsed: 0,
    failed: 0,
    skipped: 0,
    newStories: 0,
    merged: 0,
    embedDegraded: false,
    watermark: getState(STATE_LAST_SYNC),
    ranAt,
  };

  try {
    const ctx = buildCallCtx(account);
    const gmail = getGmail({ ...ctx, accountId: account.id });

    const watermark =
      getState(STATE_LAST_SYNC) ??
      new Date(Date.now() - lookbackDays() * 24 * 60 * 60 * 1000).toISOString();
    const watermarkMs = new Date(watermark).getTime();

    // 1. List — one call per alias chunk (+ the optional label query), ids merged.
    const ids = new Set<string>();
    for (const q of buildQueries(aliases, toGmailTimestamp(watermark), label)) {
      const res = await gmail.users.messages.list({ userId: "me", q, maxResults: MAX_MESSAGES });
      for (const m of res.data.messages ?? []) if (m.id) ids.add(m.id);
    }

    let newestMs = 0;
    // A message that failed BEFORE it was stored has no row to retry from, and
    // its internalDate is unknown — advancing the watermark past it would drop
    // it silently (the same class of bug as the +20s skew). So any unstored
    // failure HOLDS the watermark for the whole run: the next run re-lists the
    // window and the already-stored messages are INSERT OR IGNORE no-ops.
    let unstoredFailure = false;

    // 2. Fetch + store + parse, one message at a time.
    for (const gmailId of ids) {
      let emailId: string | null = null;
      try {
        const full = await gmail.users.messages.get({ userId: "me", id: gmailId, format: "full" });
        const msg = parseMessage(full.data);

        // Strict `<`: the boundary second is re-listed on purpose and deduped
        // by gmail_id below. `<=` would drop same-second siblings.
        if (msg.internalDate < watermarkMs) {
          result.skipped++;
          continue;
        }
        if (msg.internalDate > newestMs) newestMs = msg.internalDate;

        // Match the subscription on ANY recipient address (Delivered-To carries
        // the alias even when To was rewritten by the forwarder).
        let subscription = null;
        for (const addr of msg.toAll) {
          subscription = findSubscriptionByAlias(addr);
          if (subscription) break;
        }

        const row = insertEmail({
          gmailId: msg.gmailId,
          threadId: msg.threadId,
          subscriptionId: subscription?.id ?? null,
          fromAddr: msg.fromAddr,
          toAddr: subscription?.aliasEmail ?? msg.toAddr,
          subject: msg.subject,
          receivedAt: new Date(msg.internalDate).toISOString(),
          contentMd: msg.contentMd,
        });
        if (!row) {
          // Already stored — the boundary re-list doing its job.
          result.skipped++;
          continue;
        }
        emailId = row.id;
        result.fetched++;
        emit(
          "newsletter.email.ingested",
          {
            emailId: row.id,
            gmailId: row.gmailId,
            subscriptionId: row.subscriptionId,
            subject: row.subject,
          },
          "newsletter",
        );

        if (!row.contentMd.trim()) {
          setEmailParseResult(row.id, { status: "skipped" });
          continue;
        }

        const items = await extractItems(row);
        const absorbed = await absorbItems(row, items, {
          sourceName: sourceNameFor(row, subscription?.name),
          date: today(),
        });
        result.newStories += absorbed.newStories;
        result.merged += absorbed.merged;
        result.embedDegraded = result.embedDegraded || absorbed.embedDegraded;
        setEmailParseResult(row.id, { status: "parsed" });
        result.parsed++;
      } catch (err) {
        // SOFT: one bad message never aborts the batch.
        const message = err instanceof Error ? err.message : String(err);
        result.failed++;
        const existing = emailId ? { id: emailId } : getEmailByGmailId(gmailId);
        if (existing) {
          setEmailParseResult(existing.id, { status: "failed", error: message.slice(0, 2000) });
        } else {
          unstoredFailure = true;
        }
        console.error(`[newsletter/sync] message ${gmailId} failed:`, message);
      }
    }

    // 3. Watermark — EXACT newest internalDate, advanced ONLY on progress AND
    //    only when every listed message reached a durable row.
    if (unstoredFailure) {
      result.watermark = getState(STATE_LAST_SYNC);
      result.reason =
        `watermark HELD: ${result.failed} message(s) failed before they could be stored — ` +
        `the next run re-lists the same window (stored messages dedupe on gmail_id).`;
      console.error(`[newsletter/sync] ${result.reason}`);
    } else if (newestMs > 0) {
      const newWatermark = new Date(newestMs).toISOString();
      setState(STATE_LAST_SYNC, newWatermark);
      result.watermark = newWatermark;
    } else {
      result.watermark = getState(STATE_LAST_SYNC);
    }

    setStateJson(STATE_LAST_RUN, { ...result, trigger });
    return result;
  } finally {
    globalThis.__agentosNewsletterSyncing = false;
  }
}
