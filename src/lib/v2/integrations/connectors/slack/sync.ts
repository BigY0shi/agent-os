import type { NewActivity, SyncCtx, SyncResult } from "../../types";
import { slackApi } from "./client";

/**
 * SPEC-D G3.6 — Slack poll-fallback sync (§3.3: "mentions/DM poll (15 min) if
 * Events API not configured"). Polls the bot's DM conversations
 * (conversations.list types=im → conversations.history per DM) — mentions in
 * channels arrive via the webhook when Events are configured; polling every
 * channel the bot is in would burn rate limit for little signal.
 *
 * Watermarks: one `ts:<channelId>` state key per DM = the newest message ts
 * captured (Slack ts strings sort lexically within a channel; passed back as
 * `oldest`, strictly-greater filtered in code). State returned ONLY on
 * progress (house watermark rule). Top-level API failures THROW to the driver.
 */

type AnyRecord = Record<string, unknown>;

export async function slackSync(ctx: SyncCtx): Promise<SyncResult> {
  const token = ctx.config.token;
  if (!token) return { activities: [] };
  const botUserId = ctx.config.bot_user_id || "";
  const teamId = ctx.config.team_id || "";

  const listRes = await slackApi(token, "conversations.list", {
    types: "im",
    limit: 50,
    exclude_archived: true,
  });
  const ims = (listRes.channels as AnyRecord[]) || [];

  const activities: NewActivity[] = [];
  const newState: Record<string, string> = {};

  for (const im of ims) {
    const channel = String(im.id ?? "");
    if (!channel) continue;
    const sinceTs = ctx.state[`ts:${channel}`] ?? "";
    let history: AnyRecord;
    try {
      history = await slackApi(token, "conversations.history", {
        channel,
        limit: 50,
        ...(sinceTs ? { oldest: sinceTs } : {}),
      });
    } catch (err) {
      // One unreadable DM must not sink the whole poll (per-item skip,
      // gmail per-message precedent).
      console.error(`[slack/sync] history failed for ${channel}:`, err);
      continue;
    }
    const messages = (history.messages as AnyRecord[]) || [];
    let maxTs = sinceTs;
    for (const m of messages) {
      const ts = String(m.ts ?? "");
      if (!ts || (sinceTs && ts <= sinceTs)) continue; // `oldest` is inclusive — strict filter
      if (ts > maxTs) maxTs = ts;
      const user = String(m.user ?? "");
      if (m.bot_id || m.subtype) continue; // bots + system subtypes skipped
      if (botUserId && user === botUserId) continue; // never our own messages
      activities.push({
        text: `Slack DM from ${user}: "${String(m.text ?? "")}"`,
        sourceURL:
          teamId && channel ? `https://app.slack.com/client/${teamId}/${channel}` : undefined,
        eventType: "SLACK_MESSAGE_RECEIVED",
        payload: { kind: "im", channel, user, text: String(m.text ?? ""), ts },
        // Item 7: ts is unique within a channel — also collides with the
        // webhook lane's key for the same message (poll + Events API double
        // capture dedupes to one activity).
        dedupeKey: `slack-im:${channel}:${ts}`,
      });
    }
    if (maxTs && maxTs !== sinceTs) newState[`ts:${channel}`] = maxTs;
  }

  return {
    activities,
    ...(Object.keys(newState).length > 0 ? { state: newState } : {}),
  };
}
