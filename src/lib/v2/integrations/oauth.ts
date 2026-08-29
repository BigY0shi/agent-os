import { randomBytes, createHash } from "node:crypto";
import { readSettings } from "../../settings";
import { getConnector } from "./registry";
import {
  IntegrationError,
  getDefinitionConfig,
  popOauthSession,
  putOauthSession,
} from "./store";
import { setupAccount } from "./runtime";
import { ensureAccountSyncJob } from "./schedule";
import type { OAuth2Params } from "./types";
import type { AccountRow } from "./store";

/**
 * SPEC-D G2.3 — the OAuth2 engine (pattern-only port of AOC oauth.server.ts +
 * oauth-utils.server.ts, upstream gotchas fixed):
 * - state = crypto.randomBytes(24) base64url, PERSISTED in oauth_sessions
 *   (restart-resilient; upstream's in-memory Date.now().toString(36) was not),
 *   one-shot pop + 15-min TTL purge.
 * - PKCE S256 unless spec.auth.oauth2.disable_pkce.
 * - scope_identifier / scope_separator / default_scopes / authorization_params
 *   merge kept; ${...} URL templates interpolated from the DEFINITION config.
 * - token POST hand-rolled (~40 lines, no simple-oauth2): form or JSON body per
 *   body_format, optional Basic auth per token_request_auth_method.
 * Secrets never logged; token responses go straight into the sealed account
 * config via the connector's setup().
 */

/** upstream oauth-utils interpolateString (verbatim-adapt). */
export function interpolateString(str: string, replacers: Record<string, unknown>): string {
  return str.replace(/\$\{([^{}]*)\}/g, (match, key: string) => {
    const r = replacers[key];
    return typeof r === "string" || typeof r === "number" ? String(r) : match;
  });
}

export function callbackOrigin(): string {
  return (readSettings().integrations?.callbackOrigin || "http://localhost:3000").replace(
    /\/+$/,
    "",
  );
}

/** Shown verbatim in the UI for pasting into the provider console (§3.3). */
export function redirectUri(): string {
  return `${callbackOrigin()}/api/v2/integrations/oauth/callback`;
}

function requireOauthSpec(slug: string): OAuth2Params {
  const connector = getConnector(slug);
  if (!connector) throw new IntegrationError(`unknown connector '${slug}'`, 404);
  const oauth2 = connector.spec.auth.oauth2;
  if (!oauth2) throw new IntegrationError(`connector '${slug}' does not support OAuth2`, 400);
  return oauth2;
}

/** Build the provider authorize URL + persist the state session. */
export function startOAuth(slug: string, returnTo?: string): { url: string; state: string } {
  const oauth2 = requireOauthSpec(slug);
  const defConfig = getDefinitionConfig(slug);
  if (!defConfig.clientId || !defConfig.clientSecret) {
    throw new IntegrationError(
      `connector '${slug}' is not configured — set clientId/clientSecret in the definition config first`,
      400,
    );
  }

  const state = randomBytes(24).toString("base64url");
  const usePkce = !oauth2.disable_pkce;
  const codeVerifier = usePkce ? randomBytes(32).toString("base64url") : undefined;

  putOauthSession({
    state,
    definitionSlug: slug,
    codeVerifier,
    redirectUrl: returnTo && returnTo.startsWith("/") ? returnTo : "/integrations",
  });

  const authorizeUrl = new URL(interpolateString(oauth2.authorization_url, defConfig));
  const scopes = [...(oauth2.scopes ?? []), ...(oauth2.default_scopes ?? [])];
  const params: Record<string, string> = {
    response_type: "code",
    client_id: defConfig.clientId,
    redirect_uri: redirectUri(),
    state,
    ...(scopes.length > 0
      ? { [oauth2.scope_identifier ?? "scope"]: scopes.join(oauth2.scope_separator ?? " ") }
      : {}),
    ...(oauth2.authorization_params ?? {}),
    ...(codeVerifier
      ? {
          code_challenge: createHash("sha256").update(codeVerifier).digest("base64url"),
          code_challenge_method: "S256",
        }
      : {}),
  };
  for (const [k, v] of Object.entries(params)) authorizeUrl.searchParams.set(k, v);
  return { url: authorizeUrl.toString(), state };
}

export interface CallbackOutcome {
  redirect: string; // app path to bounce the browser to (?connected= | ?error=)
  account?: AccountRow;
}

/** Exchange the code, run the connector's setup, upsert the account. */
export async function handleCallback(
  params: Record<string, string>,
): Promise<CallbackOutcome> {
  const fail = (redirectUrl: string, message: string): CallbackOutcome => ({
    redirect: `${redirectUrl}?error=${encodeURIComponent(message)}`,
  });

  const state = params.state ?? "";
  const session = state ? popOauthSession(state) : null; // ONE-SHOT + TTL purge
  if (!session) return fail("/integrations", "OAuth state is unknown, already used, or expired");

  if (params.error) {
    return fail(session.redirectUrl, params.error_description || params.error);
  }
  if (!params.code) return fail(session.redirectUrl, "provider returned no code");

  const slug = session.definitionSlug;
  let tokens: Record<string, unknown>;
  try {
    const oauth2 = requireOauthSpec(slug);
    const defConfig = getDefinitionConfig(slug);
    tokens = await exchangeCode({
      oauth2,
      defConfig,
      code: params.code,
      codeVerifier: session.codeVerifier ?? undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(session.redirectUrl, message);
  }

  try {
    const account = await setupAccount(slug, {
      oauthResponse: tokens,
      oauthParams: { ...params, redirect_uri: redirectUri() },
    });
    ensureAccountSyncJob(account);
    return {
      redirect: `${session.redirectUrl}?connected=${encodeURIComponent(slug)}`,
      account,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(session.redirectUrl, message);
  }
}

// ─── token POST (hand-rolled; no simple-oauth2 dep) ──────────────────────────

async function exchangeCode(input: {
  oauth2: OAuth2Params;
  defConfig: Record<string, string>;
  code: string;
  codeVerifier?: string;
}): Promise<Record<string, unknown>> {
  const { oauth2, defConfig } = input;
  const tokenUrl = interpolateString(oauth2.token_url, defConfig);
  const useBasic = oauth2.token_request_auth_method === "basic";

  const bodyParams: Record<string, string> = {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: redirectUri(),
    // Basic auth carries the client creds in the header ONLY (upstream parity).
    ...(useBasic
      ? {}
      : { client_id: defConfig.clientId, client_secret: defConfig.clientSecret }),
    ...(input.codeVerifier ? { code_verifier: input.codeVerifier } : {}),
    ...(oauth2.token_params ?? {}),
  };

  const headers: Record<string, string> = { accept: "application/json" };
  if (useBasic) {
    headers.authorization = `Basic ${Buffer.from(
      `${defConfig.clientId}:${defConfig.clientSecret}`,
    ).toString("base64")}`;
  }

  let body: string;
  if ((oauth2.body_format ?? "form") === "json") {
    headers["content-type"] = "application/json";
    body = JSON.stringify(bodyParams);
  } else {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(bodyParams).toString();
  }

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) {
    // Provider error bodies can echo creds — surface status + a short slice only.
    throw new Error(`token exchange failed: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("token endpoint returned non-JSON");
  }
}
