import {
  ConnectorConfigError,
  type AccountCreate,
  type ConnectorModule,
  type SetupInput,
} from "../../types";
import { githubRequest } from "./client";
import { githubSpec } from "./spec";
import { getGithubTools, callGithubTool } from "./tools";
import { githubSync } from "./sync";

/**
 * SPEC-D G3.4 — the GitHub connector module. setup() probes GET /user with the
 * PAT → accountId = login (§3.3); a rejected token surfaces GitHub's message
 * through the /connect route's 422 path. displayName derives from the login
 * (an external id), NEVER from the credential (chunk-1 delta 7 rule).
 */

async function setup(input: SetupInput): Promise<AccountCreate> {
  const token = (input.fields?.token ?? "").trim();
  if (!token) throw new ConnectorConfigError("token is required");

  const res = await githubRequest(token, "GET", "/user");
  const user = res.data as Record<string, unknown>;
  const login = String(user.login ?? "");
  if (!login) throw new Error("GitHub /user returned no login");

  return {
    accountId: login,
    displayName: `GitHub (${login})`,
    config: { token, login },
  };
}

export const githubConnector: ConnectorModule = {
  spec: githubSpec,
  setup,
  getTools: getGithubTools,
  callTool: callGithubTool,
  sync: githubSync,
};
