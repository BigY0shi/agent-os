import { createHmac, timingSafeEqual } from "node:crypto";
import type { NewActivity, SyncResult, WebhookInput } from "../../types";

/**
 * SPEC-D G3.6 — Slack webhook handling (pattern-only port of the shapes in
 * AOC webhook.server.ts, hardened):
 *
 * - verifySlackSignature: v0 signing-secret HMAC over the RAW body — computed
 *   BEFORE any parse-derived data is trusted (§8.6: raw text first, verify,
 *   THEN JSON.parse; the hooks route reads req.text() first and hands rawBody
 *   through WebhookInput). 5-minute timestamp skew window (replay guard),
 *   timing-safe compare. Unconfigured secret = fail CLOSED.
 * - url_verification: answered INLINE by the route (§5.9 item 3) via
 *   slackChallenge — runs AFTER verification (Slack signs the handshake too).
 * - event→activity mapping: app_mention / message (im) / reaction_added →
 *   SLACK_MESSAGE_RECEIVED / SLACK_REACTION_ADDED activities.
 *
 * Known wave-1 gap (risk §8.9): Slack retries deliveries (x-slack-retry-num)
 * after slow/failed responses; the always-200-immediately route makes retries
 * rare, and duplicate activities are tolerated rather than tracked (no
 * connector-side state in process()). Revisit with the wave-2 webhook pass.
 */

type AnyRecord = Record<string, unknown>;

const SKEW_SECONDS = 60 * 5;

export function verifySlackSignature(
  rawBody: string,
  headers: Record<string, string>,
  signingSecret: string,
): boolean {
  if (!signingSecret) return false; // fail CLOSED (chunk-1 house rule)
  const ts = headers["x-slack-request-timestamp"] ?? "";
  const given = headers["x-slack-signature"] ?? "";
  if (!ts || !given) return false;
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;
  if (Math.abs(Date.now() / 1000 - tsNum) > SKEW_SECONDS) return false; // replay guard

  const expected = `v0=${createHmac("sha256", signingSecret).update(`v0:${ts}:${rawBody}`).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** url_verification handshake → echo the challenge inline (route short-circuit). */
export function slackChallenge(webhook: WebhookInput): Record<string, unknown> | null {
  const body = webhook.body as AnyRecord | null;
  if (body?.type === "url_verification" && typeof body.challenge === "string") {
    return { challenge: body.challenge };
  }
  return null;
}

/** IDENTIFY: the workspace (team) id — our external accountId (auth.test team_id). */
export function slackIdentify(webhook: WebhookInput): string[] {
  const body = webhook.body as AnyRecord | null;
  const teamId = body?.team_id ?? (body?.event as AnyRecord | null)?.team;
  return teamId ? [String(teamId)] : [];
}

/** PROCESS: event_callback → activities (mapping per §3.3/G3.6). */
export function slackEventToActivities(
  webhook: WebhookInput,
  opts: { botUserId?: string; teamId?: string } = {},
): SyncResult {
  const body = webhook.body as AnyRecord | null;
  if (!body || body.type !== "event_callback") return { activities: [] };
  const event = body.event as AnyRecord | null;
  if (!event) return { activities: [] };

  const teamId = String(body.team_id ?? opts.teamId ?? "");
  const activities: NewActivity[] = [];
  const channel = String(event.channel ?? (event.item as AnyRecord)?.channel ?? "");
  const sourceURL =
    teamId && channel ? `https://app.slack.com/client/${teamId}/${channel}` : undefined;

  const type = String(event.type ?? "");
  const user = String(event.user ?? "");
  // Item 7: Slack's per-delivery event_id dedupes x-slack-retry-num
  // redeliveries; message activities use channel:ts instead so the WEBHOOK
  // lane and the POLL-fallback lane collide on the same key (one activity per
  // message however it arrived). event_id remains the fallback.
  const eventId = String(body.event_id ?? "");

  // Never re-capture the bridge bot's own messages (echo loop guard).
  if (opts.botUserId && user && user === opts.botUserId) return { activities: [] };

  if (type === "app_mention") {
    const ts = String(event.ts ?? "");
    activities.push({
      text: `Slack mention in ${channel} from ${user}: "${String(event.text ?? "")}"`,
      sourceURL,
      eventType: "SLACK_MESSAGE_RECEIVED",
      payload: {
        kind: "app_mention",
        channel,
        user,
        text: String(event.text ?? ""),
        ts,
        ...(event.thread_ts ? { threadTs: String(event.thread_ts) } : {}),
      },
      dedupeKey: ts ? `slack-mention:${channel}:${ts}` : eventId ? `slack-evt:${eventId}` : undefined,
    });
  } else if (type === "message" && String(event.channel_type ?? "") === "im") {
    // Skip other bots' messages and message_changed/deleted subtypes.
    if (!event.bot_id && !event.subtype) {
      const ts = String(event.ts ?? "");
      activities.push({
        text: `Slack DM from ${user}: "${String(event.text ?? "")}"`,
        sourceURL,
        eventType: "SLACK_MESSAGE_RECEIVED",
        payload: {
          kind: "im",
          channel,
          user,
          text: String(event.text ?? ""),
          ts,
        },
        dedupeKey: ts ? `slack-im:${channel}:${ts}` : eventId ? `slack-evt:${eventId}` : undefined,
      });
    }
  } else if (type === "reaction_added") {
    const item = (event.item as AnyRecord) ?? {};
    activities.push({
      text: `Slack reaction :${String(event.reaction ?? "")}: added by ${user} in ${String(item.channel ?? "")}`,
      sourceURL,
      eventType: "SLACK_REACTION_ADDED",
      payload: {
        user,
        reaction: String(event.reaction ?? ""),
        channel: String(item.channel ?? ""),
        itemTs: String(item.ts ?? ""),
      },
      dedupeKey: eventId
        ? `slack-evt:${eventId}`
        : `slack-reaction:${String(item.channel ?? "")}:${String(item.ts ?? "")}:${String(event.reaction ?? "")}:${user}`,
    });
  }

  return { activities };
}
