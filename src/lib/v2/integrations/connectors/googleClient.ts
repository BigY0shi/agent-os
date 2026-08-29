import { google, type gmail_v1, type calendar_v3 } from "googleapis";
import { OAuth2Client, type Credentials } from "google-auth-library";
import { setAccountConfig, getAccountConfig } from "../store";
import type { CallCtx } from "../types";

/**
 * SPEC-D G3.1/G3.5 — the shared Google client helper for the gmail + gcal
 * connectors (port-map: "reuse our Google OAuth client from gmail port").
 *
 * Contract (chunk-1 handoff):
 * - The OAuth2Client is REBUILT PER CALL from the account's stored (encrypted)
 *   tokens — no long-lived client caching, so a reconnect/refresh elsewhere is
 *   always picked up.
 * - google-auth-library auto-refreshes expired access tokens (refresh_token +
 *   clientId/clientSecret present) and emits a 'tokens' event; we PERSIST the
 *   refreshed tokens back through store.setAccountConfig via ctx.accountId
 *   (the G3 CallCtx extension). Persistence is best-effort: a store failure is
 *   warned, never breaks the in-flight API call, and the next refresh retries.
 * - Config keys follow the upstream AOC token-response shape (snake_case:
 *   access_token, refresh_token, expiry_date, token_type, scope, id_token) —
 *   what gmail/gcal setup() stores verbatim from the token endpoint.
 *
 * TEST SEAM (documented for smoke-gmail-gcal.mjs): __setGoogleMockForTests
 * swaps the gmail/calendar/userinfo factories for fakes so every tool + sync
 * path runs offline against fixture objects — no gaxios interception needed.
 * buildOAuth2Client stays REAL under the mock, so the token-refresh
 * persistence leg is exercised by emitting 'tokens' on a real client.
 */

export interface GoogleMock {
  gmail?: (ctx: CallCtx) => gmail_v1.Gmail;
  calendar?: (ctx: CallCtx) => calendar_v3.Calendar;
  userinfo?: (accessToken: string) => Promise<{ email?: string; id?: string }>;
}

let mock: GoogleMock | null = null;

/** Test-only: inject fake gmail/calendar/userinfo factories (null to clear). */
export function __setGoogleMockForTests(m: GoogleMock | null): void {
  mock = m;
}

/** Build a real OAuth2Client from the decrypted account + definition config. */
export function buildOAuth2Client(ctx: CallCtx): OAuth2Client {
  const { config, defConfig } = ctx;
  const client = new OAuth2Client(
    defConfig.clientId,
    defConfig.clientSecret,
    config.redirect_uri || undefined,
  );

  const credentials: Credentials = {
    access_token: config.access_token,
    refresh_token: config.refresh_token,
    token_type: config.token_type,
    id_token: config.id_token,
    scope: config.scope,
    ...(config.expiry_date ? { expiry_date: parseInt(config.expiry_date, 10) } : {}),
  };
  client.setCredentials(credentials);

  // Token-refresh persistence: google-auth-library emits 'tokens' whenever it
  // refreshes. Re-read the stored config (never trust the ctx snapshot to be
  // freshest), merge ONLY the fields the refresh returned, seal it back.
  const accountId = ctx.accountId;
  if (accountId) {
    client.on("tokens", (tokens) => {
      try {
        const current = getAccountConfig(accountId);
        const merged: Record<string, string> = { ...current };
        if (tokens.access_token) merged.access_token = tokens.access_token;
        if (tokens.refresh_token) merged.refresh_token = tokens.refresh_token;
        if (tokens.expiry_date) merged.expiry_date = String(tokens.expiry_date);
        if (tokens.token_type) merged.token_type = tokens.token_type;
        if (tokens.id_token) merged.id_token = tokens.id_token;
        if (tokens.scope) merged.scope = tokens.scope;
        setAccountConfig(accountId, merged); // sealed (AES-GCM) by the store
      } catch (err) {
        // Never break the in-flight API call over a persistence hiccup.
        console.warn(
          `[integrations/googleClient] could not persist refreshed tokens for account ${accountId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    });
  }

  return client;
}

/** Gmail v1 client for an account context (mockable). */
export function getGmail(ctx: CallCtx): gmail_v1.Gmail {
  if (mock?.gmail) return mock.gmail(ctx);
  return google.gmail({ version: "v1", auth: buildOAuth2Client(ctx) });
}

/** Calendar v3 client for an account context (mockable). */
export function getCalendar(ctx: CallCtx): calendar_v3.Calendar {
  if (mock?.calendar) return mock.calendar(ctx);
  return google.calendar({ version: "v3", auth: buildOAuth2Client(ctx) });
}

/**
 * Fetch the Google account identity for setup() (upstream account-create.ts,
 * axios→fetch). Throws on failure — setup turns that into the 422 path.
 */
export async function getUserInfo(
  accessToken: string,
): Promise<{ email?: string; id?: string }> {
  if (mock?.userinfo) return mock.userinfo(accessToken);
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`Google userinfo failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { email?: string; id?: string };
  return { email: data.email, id: data.id };
}

/**
 * Shared setup() body for the Google OAuth connectors: token response →
 * account config (upstream integrationCreate shape, minus clientId/secret —
 * those live in the DEFINITION config, never duplicated per account).
 */
export async function googleAccountFromOauth(input: {
  oauthResponse: Record<string, unknown>;
  oauthParams?: Record<string, string>;
  displayNamePrefix?: string;
}): Promise<{
  accountId: string;
  displayName: string;
  config: Record<string, string>;
}> {
  const r = input.oauthResponse;
  const accessToken = typeof r.access_token === "string" ? r.access_token : "";
  if (!accessToken) throw new Error("token response had no access_token");

  const user = await getUserInfo(accessToken);
  const accountId = user.email || user.id;
  if (!accountId) throw new Error("could not resolve the Google account identity");

  const config: Record<string, string> = { access_token: accessToken };
  if (typeof r.refresh_token === "string") config.refresh_token = r.refresh_token;
  if (typeof r.token_type === "string") config.token_type = r.token_type;
  if (typeof r.id_token === "string") config.id_token = r.id_token;
  if (typeof r.scope === "string") config.scope = r.scope;
  // Google returns expires_in (seconds) — store the absolute expiry_date (ms)
  // google-auth-library expects for its refresh decision.
  const expiresIn = Number(r.expires_in);
  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    config.expiry_date = String(Date.now() + expiresIn * 1000);
  }
  if (user.email) config.userEmail = user.email;
  if (user.id) config.userId = user.id;
  if (input.oauthParams?.redirect_uri) config.redirect_uri = input.oauthParams.redirect_uri;

  return {
    accountId,
    displayName: input.displayNamePrefix
      ? `${input.displayNamePrefix} (${accountId})`
      : accountId,
    config,
  };
}
