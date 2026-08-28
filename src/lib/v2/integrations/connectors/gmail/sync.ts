import TurndownService from "turndown";
import type { gmail_v1 } from "googleapis";
import type { NewActivity, SyncCtx, SyncResult } from "../../types";
import { getGmail } from "../googleClient";
import { extractEmailContent, type GmailMessagePart } from "./mime";

/**
 * SPEC-D G3.2 — verbatim-adapt of AOC integrations/gmail/src/schedule.ts:
 * - queries `in:inbox is:important after:<ts>` + `in:sent after:<ts>`, 50-msg
 *   caps each (§8.5 sync cap);
 * - 24h default window when no watermark;
 * - watermark = latest internalDate + 20s, state saved ONLY on progress;
 * - Turndown HTML→Markdown cleanup, <10-char bodies skipped;
 * - EXACT activity text format + sourceURL
 *   https://mail.google.com/mail/u/0/#inbox/<id> (sent: #sent/<id>);
 * - per-message errors are silently skipped (console.error, upstream parity).
 *
 * Deliberate deltas vs upstream:
 * - received emails carry eventType 'GMAIL_MESSAGE_RECEIVED' with payload
 *   {from, subject, messageId, threadId} (G3.2 trigger contract; sent mail
 *   emits no trigger);
 * - upstream swallowed TOP-LEVEL errors into `return []` with only a console
 *   line — here they THROW so the sync driver records the error on the
 *   integration_sync_runs row and emits 'sync.failed' ("all errors → [] +
 *   sync_run error": the driver returns 0 activities AND an error row). An
 *   account with no access_token still short-circuits to [] like upstream.
 */

interface GmailSyncState {
  lastSyncTime?: string;
  lastUserEventTime?: string;
  emailAddress?: string;
}

/** 24 hours ago (upstream default window). */
function getDefaultSyncTime(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
});
turndownService.remove(["style", "script", "noscript", "iframe", "object", "embed"]);

/** Clean and convert email content to markdown (verbatim). */
function cleanEmailContent(htmlContent: string, textContent: string): string {
  if (htmlContent) {
    const markdown = turndownService.turndown(htmlContent);
    return markdown
      .replace(/\n\n+/g, "\n\n")
      .replace(/\s+/g, " ")
      .trim();
  }
  return textContent.replace(/\r/g, "").replace(/\n\n+/g, "\n\n").replace(/\s+/g, " ").trim();
}

/** ISO date → Gmail query `after:` Unix seconds (verbatim). */
function toGmailTimestamp(isoDate: string): number {
  return Math.floor(new Date(isoDate).getTime() / 1000);
}

/** Short single-line preview for the activity feed (verbatim). */
function makeSnippet(content: string, max = 200): string {
  const flat = content.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max)}…`;
}

/** "Name <email>" → "Name" (verbatim upstream formatEmailSender). */
function formatEmailSender(from: string): string {
  const match = from.match(/^(.+?)\s*<(.+?)>$/);
  if (match) return match[1].trim();
  return from;
}

/** Upstream utils.ts parseEmailContent shape via the shared recursive extractor. */
function parseEmailContent(payload: GmailMessagePart | undefined): {
  textContent: string;
  htmlContent: string;
} {
  const { text, html } = extractEmailContent(payload || {});
  let textContent = text;
  const htmlContent = html;
  if (!textContent && htmlContent) {
    textContent = htmlContent.replace(/<[^>]*>/g, "").trim();
  }
  return { textContent, htmlContent };
}

interface ProcessedEmails {
  activities: NewActivity[];
  lastEmailTime: number;
}

/** Fetch and process received emails (verbatim-adapt). */
async function processReceivedEmails(
  gmail: gmail_v1.Gmail,
  lastSyncTime: string,
): Promise<ProcessedEmails> {
  const activities: NewActivity[] = [];
  const afterTimestamp = toGmailTimestamp(lastSyncTime);
  let lastEmailTime = 0;

  // Query for important received emails after lastSyncTime — top-level
  // failures propagate to the sync driver (deliberate delta, see header).
  const response = await gmail.users.messages.list({
    userId: "me",
    q: `in:inbox is:important after:${afterTimestamp}`,
    maxResults: 50,
  });

  const messages = response.data.messages || [];

  for (const message of messages) {
    try {
      const fullMessage = await gmail.users.messages.get({
        userId: "me",
        id: message.id!,
        format: "full",
      });

      const headers = fullMessage.data.payload?.headers || [];
      const from = headers.find((h) => h.name === "From")?.value || "Unknown";
      const subject = headers.find((h) => h.name === "Subject")?.value || "(No subject)";
      const date = headers.find((h) => h.name === "Date")?.value || "";

      const internalDate = parseInt(fullMessage.data.internalDate || "0");

      // Skip emails at or before lastSyncTime (Gmail after: is not precise
      // at second level).
      const lastSyncMs = new Date(lastSyncTime).getTime();
      if (internalDate <= lastSyncMs) continue;
      if (internalDate > lastEmailTime) lastEmailTime = internalDate;

      const sender = formatEmailSender(from);
      const threadId = fullMessage.data.threadId || "";
      const { textContent, htmlContent } = parseEmailContent(
        fullMessage.data.payload as GmailMessagePart,
      );
      const cleanedContent = cleanEmailContent(htmlContent, textContent);
      if (!cleanedContent || cleanedContent.length < 10) continue;

      const sourceURL = `https://mail.google.com/mail/u/0/#inbox/${message.id}`;
      const snippet = makeSnippet(cleanedContent);

      const text = `Received email from ${sender} (from: ${from}, subject: "${subject}", message_id: ${message.id}, thread_id: ${threadId}) at ${date}. Snippet: "${snippet}"`;

      activities.push({
        text,
        sourceURL,
        eventType: "GMAIL_MESSAGE_RECEIVED",
        payload: { from, subject, messageId: message.id!, threadId },
      });
    } catch (error) {
      // Silently ignore errors for individual messages (upstream parity)
      console.error("Error processing received email:", error);
    }
  }

  return { activities, lastEmailTime };
}

/** Fetch and process sent emails (verbatim-adapt; no trigger event). */
async function processSentEmails(
  gmail: gmail_v1.Gmail,
  lastSyncTime: string,
  emailAddress: string,
): Promise<ProcessedEmails> {
  const activities: NewActivity[] = [];
  const afterTimestamp = toGmailTimestamp(lastSyncTime);
  let lastEmailTime = 0;

  const response = await gmail.users.messages.list({
    userId: "me",
    q: `in:sent after:${afterTimestamp}`,
    maxResults: 50,
  });

  const messages = response.data.messages || [];

  for (const message of messages) {
    try {
      const fullMessage = await gmail.users.messages.get({
        userId: "me",
        id: message.id!,
        format: "full",
      });

      const headers = fullMessage.data.payload?.headers || [];
      const to = headers.find((h) => h.name === "To")?.value || "Unknown";
      const subject = headers.find((h) => h.name === "Subject")?.value || "(No subject)";
      const date = headers.find((h) => h.name === "Date")?.value || "";

      const internalDate = parseInt(fullMessage.data.internalDate || "0");
      const lastSyncMs = new Date(lastSyncTime).getTime();
      if (internalDate <= lastSyncMs) continue;
      if (internalDate > lastEmailTime) lastEmailTime = internalDate;

      const threadId = fullMessage.data.threadId || message.id!;
      const { textContent, htmlContent } = parseEmailContent(
        fullMessage.data.payload as GmailMessagePart,
      );
      const cleanedContent = cleanEmailContent(htmlContent, textContent);
      if (!cleanedContent || cleanedContent.length < 10) continue;

      const sourceURL = `https://mail.google.com/mail/u/0/#sent/${message.id}`;
      const snippet = makeSnippet(cleanedContent);

      const text = `Sent email to ${to} (from: ${emailAddress}, subject: "${subject}", message_id: ${message.id}, thread_id: ${threadId}) at ${date}. Snippet: "${snippet}"`;

      activities.push({ text, sourceURL });
    } catch (error) {
      console.error("Error processing sent email:", error);
    }
  }

  return { activities, lastEmailTime };
}

/** The connector sync entry (upstream handleSchedule, driver-shaped). */
export async function gmailSync(ctx: SyncCtx): Promise<SyncResult> {
  // No valid access token → nothing to do (upstream parity: return []).
  if (!ctx.config.access_token) {
    return { activities: [] };
  }

  const state = ctx.state as GmailSyncState;
  // Default to 24 hours ago if no last sync time
  const lastSyncTime = state.lastSyncTime || getDefaultSyncTime();

  const gmail = getGmail(ctx);

  // Get user profile to get email address (once; persisted in state)
  let emailAddress = state.emailAddress;
  if (!emailAddress) {
    try {
      const profile = await gmail.users.getProfile({ userId: "me" });
      emailAddress = (profile.data.emailAddress as string) || undefined;
    } catch (error) {
      console.error("Error fetching user profile:", error);
    }
  }

  const { activities: receivedActivities, lastEmailTime: receivedLastTime } =
    await processReceivedEmails(gmail, lastSyncTime);
  const { activities: sentActivities, lastEmailTime: sentLastTime } = await processSentEmails(
    gmail,
    lastSyncTime,
    emailAddress || "user",
  );

  const activities = [...receivedActivities, ...sentActivities];

  // Only save state if emails were processed (state-on-progress-only) —
  // +20s watermark past the newest internalDate (upstream rule).
  const latestEmailTime = Math.max(receivedLastTime, sentLastTime);
  if (latestEmailTime > 0) {
    const newSyncTime = new Date(latestEmailTime + 20000).toISOString();
    return {
      activities,
      state: {
        lastSyncTime: newSyncTime,
        lastUserEventTime: newSyncTime,
        ...(emailAddress ? { emailAddress } : {}),
      },
    };
  }

  // Persist a freshly-learned email address even without message progress
  // (it is identity, not a watermark).
  if (emailAddress && !state.emailAddress) {
    return { activities, state: { emailAddress } };
  }
  return { activities };
}
