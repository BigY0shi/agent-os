// SPEC-F K3.1 — the SECOND newsletter delivery path.
//
// Gmail was the only transport, which made the module hostage to a Google OAuth
// setup and to the restricted-scope refresh-token churn SPEC-F §8 warns about
// (a "Testing"-status client re-consents every 7 days). An AgentMail inbox
// receives mail directly, so an addy alias can forward there instead and the
// module works with no Google involvement at all.
//
// This is a TRANSPORT, not a second pipeline. Once a message is a row, the
// existing extraction → absorb → edition path runs unchanged: same
// insertEmail, same extractItems, same absorbItems, same sourceNameFor. The
// only newsletter-specific logic here is deciding which subscription a message
// belongs to and what counts as already-seen.

import { emit } from "../events";
import { absorbItems, sourceNameFor } from "./dedupe";
import { extractItems } from "./parse";
import {
  findSubscriptionByAlias,
  insertEmail,
  setEmailParseResult,
  today,
} from "./store";
import { listMessages, type AgentMailMessage } from "../agentmail/client";
import { agentmailConfigured, agentmailInbox } from "../agentmail/config";

export const AGENTMAIL_SOURCE = "agentmail";

export interface AgentMailSyncResult {
  fetched: number;
  skipped: number;
  newStories: number;
  merged: number;
  embedDegraded: boolean;
  errors: string[];
}

/**
 * Which subscription does this message belong to?
 *
 * An alias forwarding into this inbox keeps its own address on the envelope, so
 * the recipient list is checked first — that is the same rule the Gmail lane
 * uses. When nothing matches, the row is still stored with a null
 * subscription_id rather than dropped: since migration 062 the source CHIP
 * comes from the SENDER, so an unattributed message still labels itself
 * correctly on the edition. Dropping it would lose a story to a bookkeeping gap.
 */
function matchSubscription(msg: AgentMailMessage) {
  const candidates = msg.to
    .split(/[,;]/)
    .map((s) => s.trim().replace(/^.*<|>.*$/g, "").toLowerCase())
    .filter(Boolean);
  for (const addr of candidates) {
    const sub = findSubscriptionByAlias(addr);
    if (sub) return sub;
  }
  return null;
}

/** "Name <a@b.c>" → "Name"; "" when there is no display name (never an address). */
export function displayNameOf(from: string): string {
  const value = (from ?? "").trim();
  if (!value) return "";
  const angled = value.indexOf("<");
  const name = (angled >= 0 ? value.slice(0, angled) : "").trim().replace(/^["']|["']$/g, "").trim();
  if (!name || name.includes("@")) return "";
  return name.slice(0, 120);
}

/** "Name <a@b.c>" → "a@b.c" lowercased; falls back to the whole string. */
export function addressOf(from: string): string {
  const m = (from ?? "").match(/<([^>]+)>/);
  const candidate = m ? m[1] : from;
  const hit = (candidate ?? "").match(/[^\s,;<>]+@[^\s,;<>]+/);
  return hit ? hit[0].trim().toLowerCase() : "";
}

/**
 * Pull everything in the AgentMail inbox into the newsletter store.
 *
 * Idempotency is `gmail_id` (widened by migration 063 to mean "the provider's
 * message id"): insertEmail is INSERT OR IGNORE on it, so re-running is a
 * no-op rather than a duplicate. That is why there is no watermark here — the
 * inbox is small and the unique key already does the work the Gmail lane needs
 * a watermark for.
 *
 * Messages the agent itself SENT are skipped. They share the inbox, and an
 * agent's own outbound mail is not a newsletter.
 */
export async function syncAgentMail(): Promise<AgentMailSyncResult> {
  const result: AgentMailSyncResult = {
    fetched: 0,
    skipped: 0,
    newStories: 0,
    merged: 0,
    embedDegraded: false,
    errors: [],
  };

  if (!agentmailConfigured()) {
    result.errors.push("agentmail is not configured — no api_key/inbox_id on disk");
    return result;
  }

  const inbox = agentmailInbox().toLowerCase();
  let messages: AgentMailMessage[] = [];
  try {
    messages = await listMessages();
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
    return result;
  }

  for (const msg of messages) {
    try {
      if (addressOf(msg.from) === inbox) {
        result.skipped++; // our own outbound
        continue;
      }

      const subscription = matchSubscription(msg);
      const row = insertEmail({
        gmailId: msg.messageId,
        threadId: msg.threadId,
        subscriptionId: subscription?.id ?? null,
        source: AGENTMAIL_SOURCE,
        fromAddr: addressOf(msg.from) || msg.from,
        fromName: displayNameOf(msg.from) || null,
        toAddr: subscription?.aliasEmail ?? msg.to,
        subject: msg.subject,
        receivedAt: new Date(msg.timestamp).toISOString(),
        contentMd: msg.preview,
      });

      if (!row) {
        result.skipped++; // already stored — the unique key doing its job
        continue;
      }
      result.fetched++;
      emit(
        "newsletter.email.ingested",
        { emailId: row.id, gmailId: row.gmailId, subscriptionId: row.subscriptionId, subject: row.subject },
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
    } catch (err) {
      // One bad message must not abort the batch — same rule as the Gmail lane.
      result.errors.push(`${msg.messageId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}
