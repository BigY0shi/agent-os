import { ConnectorConfigError, type AccountCreate, type ConnectorModule, type SetupInput } from "../../types";
import { googleAccountFromOauth } from "../googleClient";
import { gmailSpec } from "./spec";
import { getGmailTools, callGmailTool } from "./tools";
import { gmailSync } from "./sync";

/**
 * SPEC-D G3.1/G3.2 — the Gmail connector module. setup() is the upstream
 * account-create.ts flow (userinfo → accountId = email || id) via the shared
 * googleClient helper; tokens land in the account config SEALED by the store,
 * clientId/clientSecret stay in the DEFINITION config only.
 */

async function setup(input: SetupInput): Promise<AccountCreate> {
  if (!input.oauthResponse) {
    throw new ConnectorConfigError("gmail setup requires an OAuth token response");
  }
  const account = await googleAccountFromOauth({
    oauthResponse: input.oauthResponse,
    oauthParams: input.oauthParams,
    displayNamePrefix: "Gmail",
  });
  return account;
}

export const gmailConnector: ConnectorModule = {
  spec: gmailSpec,
  setup,
  getTools: getGmailTools,
  callTool: callGmailTool,
  sync: gmailSync,
};
