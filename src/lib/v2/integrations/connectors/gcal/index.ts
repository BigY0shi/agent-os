import { ConnectorConfigError, type AccountCreate, type ConnectorModule, type SetupInput } from "../../types";
import { googleAccountFromOauth } from "../googleClient";
import { gcalSpec } from "./spec";
import { getGcalTools, callGcalTool } from "./tools";
import { gcalSync } from "./sync";

/**
 * SPEC-D G3.5 — the Google Calendar connector module. Same setup flow as
 * gmail (shared googleClient helper; upstream google-calendar account-create
 * is byte-identical to gmail's).
 */

async function setup(input: SetupInput): Promise<AccountCreate> {
  if (!input.oauthResponse) {
    throw new ConnectorConfigError("gcal setup requires an OAuth token response");
  }
  return googleAccountFromOauth({
    oauthResponse: input.oauthResponse,
    oauthParams: input.oauthParams,
    displayNamePrefix: "Calendar",
  });
}

export const gcalConnector: ConnectorModule = {
  spec: gcalSpec,
  setup,
  getTools: getGcalTools,
  callTool: callGcalTool,
  sync: gcalSync,
};
