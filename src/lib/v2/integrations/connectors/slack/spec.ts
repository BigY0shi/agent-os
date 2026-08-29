import type { ConnectorSpec } from "../../types";

/**
 * SPEC-D G3.6 — Slack connector spec. Bot-token api-key auth wave 1 (§3.3;
 * the OAuth install flow is the sanctioned wave-2 extension — SPEC-D open
 * question 3). Webhook: /api/hooks/slack with signing-secret v0-HMAC over the
 * RAW body (§5.9/§8.6) — the signing secret lives in this definition's
 * `webhookSecret` config key (PATCH /api/v2/integrations/slack). Poll-fallback
 * DM sync every 15 min when the Events API isn't configured.
 */
export const slackSpec: ConnectorSpec = {
  name: "Slack",
  slug: "slack",
  description:
    "Connect your workspace to Slack. Post messages, read channels, react, and capture mentions and DMs",
  icon: "slack",
  category: "communication",
  auth: {
    apiKey: {
      fields: [
        {
          name: "token",
          label: "Bot token",
          placeholder: "xoxb-…",
          description:
            "From api.slack.com → your app → OAuth & Permissions. Needs chat:write, channels:read, channels:history, im:read, im:history, reactions:write (and search:read for search).",
        },
        {
          name: "defaultChannel",
          label: "Default channel (optional)",
          placeholder: "C0123456789 or #general",
          description: "Used when a tool call omits the channel.",
        },
      ],
    },
  },
  schedule: { frequency: "*/15 * * * *" }, // §3.3: mentions/DM poll fallback (15 min)
  triggers: [
    { key: "SLACK_MESSAGE_RECEIVED", label: "Message or mention received" },
    { key: "SLACK_REACTION_ADDED", label: "Reaction added" },
  ],
  uiHint:
    "For live events, point your Slack app's Event Subscriptions URL at <origin>/api/hooks/slack and " +
    "paste the app's Signing Secret into this connector's webhookSecret (gear). Subscribe to " +
    "app_mention, message.im and reaction_added. Without events, the 15-min DM poll still runs.",
};
