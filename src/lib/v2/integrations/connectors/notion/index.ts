import {
  ConnectorConfigError,
  type AccountCreate,
  type ConnectorModule,
  type SetupInput,
} from "../../types";
import { notionRequest } from "./client";
import { notionSpec } from "./spec";
import { getNotionTools, callNotionTool } from "./tools";

/**
 * SPEC-D G3.3 — the Notion connector module. setup() is a verbatim-adapt of
 * AOC integrations/notion/src/account-create.ts (integrationCreate):
 * `GET /v1/users/me` probe → accountId = workspace_id || bot_id, with the
 * upstream fallback to OAuth-response fields when the probe fails.
 *
 * Additive api-key path (chunk-3 brief): an internal-integration token is
 * probed the same way; there is no workspace_id outside OAuth, so accountId =
 * the bot user id. A bad token FAILS the probe loudly (→ the /connect route's
 * 422 with the connector text) — no fallback on this path.
 *
 * Config is Record<string,string> (sealed): the upstream `owner` object is
 * stored JSON-stringified; workspace fields are stringified as-is.
 */

async function setup(input: SetupInput): Promise<AccountCreate> {
  // ── api-key path (internal integration secret) ────────────────────────────
  if (input.fields) {
    const token = (input.fields.token ?? "").trim();
    if (!token) throw new ConnectorConfigError("token is required");
    // Probe /users/me — a rejected token surfaces Notion's message (422 path).
    const me = await notionRequest<Record<string, unknown>>(token, "GET", "/users/me");
    const botId = String(me.id ?? "");
    if (!botId) throw new Error("Notion /users/me returned no bot id");
    const workspaceName =
      String(((me.bot as Record<string, unknown>)?.workspace_name as string) ?? "") ||
      String(me.name ?? "") ||
      "Notion workspace";
    return {
      accountId: botId,
      displayName: workspaceName,
      config: { access_token: token, bot_id: botId, workspace_name: workspaceName },
      settings: { workspace_name: workspaceName, bot_id: botId },
    };
  }

  // ── OAuth path (upstream integrationCreate, verbatim-adapt) ───────────────
  if (input.oauthResponse) {
    const oauthResponse = input.oauthResponse;
    const accessToken = typeof oauthResponse.access_token === "string" ? oauthResponse.access_token : "";
    if (!accessToken) throw new Error("token response had no access_token");

    let workspaceName: string | null = null;
    let workspaceId: string | null = null;
    let botId: string | null = null;

    try {
      const userData = await notionRequest<Record<string, unknown>>(accessToken, "GET", "/users/me");
      botId = userData.id ? String(userData.id) : null;
      workspaceName = (userData.name as string) || (oauthResponse.workspace_name as string) || null;
      workspaceId = (oauthResponse.workspace_id as string) || (userData.id as string) || null;
    } catch (error) {
      console.error("Error fetching Notion user info:", error);
      // Fallback to OAuth response data (upstream parity)
      workspaceName = (oauthResponse.workspace_name as string) || null;
      workspaceId = (oauthResponse.workspace_id as string) || null;
      botId = (oauthResponse.bot_id as string) || null;
    }

    const accountId = workspaceId || botId;
    if (!accountId) throw new Error("could not resolve the Notion workspace identity");

    const config: Record<string, string> = { access_token: accessToken };
    if (typeof oauthResponse.token_type === "string") config.token_type = oauthResponse.token_type;
    if (botId) config.bot_id = botId;
    if (workspaceName) config.workspace_name = workspaceName;
    if (workspaceId) config.workspace_id = workspaceId;
    if (typeof oauthResponse.workspace_icon === "string") config.workspace_icon = oauthResponse.workspace_icon;
    if (oauthResponse.owner !== undefined) config.owner = JSON.stringify(oauthResponse.owner);

    return {
      accountId,
      displayName: workspaceName ?? accountId,
      config,
      settings: { workspace_name: workspaceName, bot_id: botId },
    };
  }

  throw new ConnectorConfigError("notion setup needs an api-key token or an OAuth token response");
}

export const notionConnector: ConnectorModule = {
  spec: notionSpec,
  setup,
  getTools: getNotionTools,
  callTool: callNotionTool,
  // No sync/webhook wave 1 (§3.3) — AOC has none to port; tools-only.
};
