import type { NewActivity, SyncCtx, SyncResult } from "../../types";
import { bridge } from "./bridge";

/**
 * SPEC-D G3.7 — Buzz sync: 15-min channel poll → activities for new INBOUND
 * messages (never the bridge's own posts). Watermark = last event timestamp
 * per channel (chunk-3 brief), state key `since:<channel_id>` holding the max
 * created_at (unix seconds) captured; passed to the CLI as --since and
 * strictly-greater filtered in code (the relay's since is inclusive). State
 * returned ONLY on progress. A channel-list failure THROWS to the driver
 * (sync_run error + 'sync.failed'); a single channel's read failure is
 * skipped per-item (gmail per-message precedent).
 */

export async function buzzSync(ctx: SyncCtx): Promise<SyncResult> {
  const b = bridge();
  if (!b.buzzAvailable()) {
    // Parity with gmail's missing-token short-circuit: unconfigured ≠ error.
    return { activities: [] };
  }

  const self = b.bridgePubkey();
  const channels = await b.listChannels(); // throws → driver soft-records
  const names = await b.displayNames().catch(() => new Map<string, string>());

  const activities: NewActivity[] = [];
  const newState: Record<string, string> = {};

  for (const channel of channels) {
    const key = `since:${channel.channel_id}`;
    const since = parseInt(ctx.state[key] ?? "0", 10) || 0;
    let messages;
    try {
      messages = await b.getMessages(channel.channel_id, {
        ...(since > 0 ? { since } : {}),
        limit: 50,
      });
    } catch (err) {
      console.error(`[buzz/sync] read failed for #${channel.name}:`, err);
      continue;
    }
    let maxTs = since;
    for (const m of messages) {
      if (!m.id || m.created_at <= since) continue; // --since is inclusive — strict filter
      if (m.created_at > maxTs) maxTs = m.created_at;
      if (self && m.pubkey === self) continue; // never our own posts
      const who = names.get(m.pubkey) || m.pubkey.slice(0, 8);
      activities.push({
        text: `Buzz message in #${channel.name} from ${who}: "${m.content}"`,
        eventType: "BUZZ_MESSAGE_RECEIVED",
        payload: {
          channelId: channel.channel_id,
          channelName: channel.name,
          pubkey: m.pubkey,
          from: who,
          messageId: m.id,
          createdAt: m.created_at,
        },
      });
    }
    if (maxTs > since) newState[key] = String(maxTs);
  }

  return {
    activities,
    ...(Object.keys(newState).length > 0 ? { state: newState } : {}),
  };
}
