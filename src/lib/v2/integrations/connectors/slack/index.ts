import {
  ConnectorConfigError,
  type AccountCreate,
  type CallCtx,
  type ConnectorModule,
  type SetupInput,
  type SyncResult,
  type WebhookInput,
} from "../../types";
import { slackApi } from "./client";
import { slackSpec } from "./spec";
import { getSlackTools, callSlackTool } from "./tools";
import { slackSync } from "./sync";
import {
  verifySlackSignature,
  slackChallenge,
  slackIdentify,
  slackEventToActivities,
} from "./webhook";

/**
 * SPEC-D G3.6 — the Slack connector module. setup() probes auth.test with the
 * bot token → accountId = team_id (§3.3); the bot's own user id is stored so
 * sync/webhook mapping can skip our own messages. verifyWebhook REPLACES the
 * generic x-hook-secret gate (ConnectorModule seam): v0 signing-secret HMAC
 * over the RAW body, secret from the definition's `webhookSecret` config key.
 */

async function setup(input: SetupInput): Promise<AccountCreate> {
  const token = (input.fields?.token ?? "").trim();
  if (!token) throw new ConnectorConfigError("token is required");

  const auth = await slackApi(token, "auth.test");
  const teamId = String(auth.team_id ?? "");
  if (!teamId) throw new Error("Slack auth.test returned no team_id");
  const team = String(auth.team ?? teamId);
  const botUserId = String(auth.user_id ?? "");

  const config: Record<string, string> = { token, team_id: teamId };
  if (botUserId) config.bot_user_id = botUserId;
  const defaultChannel = (input.fields?.defaultChannel ?? "").trim();
  if (defaultChannel) config.defaultChannel = defaultChannel;

  return {
    accountId: teamId,
    displayName: `Slack (${team})`,
    config,
  };
}

async function identify(webhook: WebhookInput): Promise<string[]> {
  return slackIdentify(webhook);
}

async function process(webhook: WebhookInput, ctx: CallCtx): Promise<SyncResult> {
  return slackEventToActivities(webhook, {
    botUserId: ctx.config.bot_user_id,
    teamId: ctx.config.team_id,
  });
}

export const slackConnector: ConnectorModule = {
  spec: slackSpec,
  setup,
  getTools: getSlackTools,
  callTool: callSlackTool,
  sync: slackSync,
  identify,
  process,
  verifyWebhook: (webhook, defConfig) =>
    verifySlackSignature(webhook.rawBody, webhook.headers, defConfig.webhookSecret ?? ""),
  webhookChallenge: slackChallenge,
};
