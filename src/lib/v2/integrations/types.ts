// SPEC-D G2.1 — client-safe integration types. NO node imports in this file
// (repo convention, cf. agentsTypes.ts). Near-verbatim port of AgentOSCore
// packages/types/src/integration.ts + oauth/params.ts + oauth-utils.server.ts
// (TUI/widget-bundle variants and Message[] wire types dropped per SPEC-D §1
// decision 1 — single in-process execution path).

// ─── OAuth (upstream oauth/params.ts + ProviderTemplateOAuth2) ───────────────

export interface Param {
  name: string;
  label?: string;
  placeholder?: string;
  description?: string;
}

export interface OAuth2Params {
  authorization_url: string; // may contain ${...} templates interpolated from the definition config
  authorization_params?: Record<string, string>;
  default_scopes?: string[];
  scope_separator?: string; // default " "
  scope_identifier?: string; // default "scope"
  token_url: string; // may contain ${...} templates
  token_params?: Record<string, string>; // e.g. { grant_type: "authorization_code" }
  token_expiration_buffer?: number; // seconds
  scopes?: string[];
  token_request_auth_method?: "basic"; // Basic <clientId:clientSecret> header at token POST
  disable_pkce?: boolean; // default false = PKCE S256 used
  body_format?: "form" | "json"; // token POST body encoding, default "form"
}

export interface APIKeyParams {
  fields: Param[];
}

// ─── Connector spec + tools ──────────────────────────────────────────────────

export interface TriggerDef {
  key: string; // e.g. 'GMAIL_MESSAGE_RECEIVED'
  label: string;
}

export interface ConnectorSpec {
  name: string;
  slug: string; // registry key; '_'-prefixed slugs are internal fixtures (hidden from the default UI list)
  description: string;
  icon?: string;
  category?: string;
  auth: {
    oauth2?: OAuth2Params;
    apiKey?: APIKeyParams;
    local?: true; // no auth fields (e.g. buzz — bridge key already on disk)
  };
  schedule?: { frequency: string }; // 5-field cron, honored per-connector (SPEC-D §1 decision 5)
  triggers?: TriggerDef[];
  widgets?: string[]; // H2 widget slugs this connector powers
  /**
   * Short hint the ConnectDialog renders next to the auth fields (G3 additive
   * field). Used for the OAuth-on-LAN redirect caveat (SPEC-D §8.3) and for
   * gcal's "reuse Gmail app credentials" note (§3.3).
   */
  uiHint?: string;
}

export interface ConnectorTool {
  name: string; // ALREADY slug-prefixed (e.g. 'gmail_send_email') — passed VERBATIM (decision 2)
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

export interface ToolResult {
  text: string;
  isError?: boolean;
}

// ─── Runtime call shapes ─────────────────────────────────────────────────────

export interface SetupInput {
  /** OAuth path: token endpoint response body (access_token, refresh_token, ...). */
  oauthResponse?: Record<string, unknown>;
  /** OAuth path: callback query params + redirect_uri. */
  oauthParams?: Record<string, string>;
  /** API-key path: values for spec.auth.apiKey.fields. */
  fields?: Record<string, string>;
  /** Decrypted definition-level config (clientId, clientSecret, ...). */
  defConfig: Record<string, string>;
}

export interface AccountCreate {
  accountId: string; // external identity — UNIQUE(definition_slug, account_id) upsert key
  displayName?: string;
  config: Record<string, string>; // sealed into config_enc — NEVER stored/serialized plaintext
  settings?: Record<string, unknown>; // merged into settings_json
}

export interface CallCtx {
  config: Record<string, string>; // decrypted account config
  defConfig: Record<string, string>; // decrypted definition config
  timezone: string; // injected from settings.tasks.timezone (SPEC-D §1 decision 10)
  /**
   * Account row id (G3 runtime extension, per the chunk-1 handoff): lets a
   * connector persist refreshed OAuth tokens back through the store
   * (googleClient.ts token-refresh persistence). Optional so hand-built test
   * contexts stay valid; the runtime/sync/webhook drivers always set it.
   */
  accountId?: string;
}

export interface SyncCtx extends CallCtx {
  state: Record<string, string>; // watermarks; merged back ONLY by keys the connector returns
}

export interface NewActivity {
  text: string;
  sourceURL?: string;
  eventType?: string; // TriggerDef key
  payload?: Record<string, unknown>;
  /** Stable per-item id (gmail message id, github notification id@updated,
   *  slack ts, gcal event id@updated) — UNIQUE(account_id, dedupe_key) with
   *  INSERT OR IGNORE makes replays/overlap windows idempotent (hardening
   *  item 7). Omit when the source has no stable id. */
  dedupeKey?: string;
}

export interface SyncResult {
  activities: NewActivity[];
  state?: Record<string, string>;
}

export interface WebhookInput {
  headers: Record<string, string>;
  body: unknown; // parsed JSON (null when unparseable)
  rawBody: string; // RAW request text — read FIRST for HMAC verification (SPEC-D §8.6)
}

/** Implemented by every connectors/<slug>/index.ts (SPEC-D §3.1). */
export interface ConnectorModule {
  spec: ConnectorSpec;
  setup(input: SetupInput): Promise<AccountCreate>;
  getTools(): ConnectorTool[];
  callTool(name: string, args: Record<string, unknown>, ctx: CallCtx): Promise<ToolResult>;
  sync?(ctx: SyncCtx): Promise<SyncResult>;
  identify?(webhook: WebhookInput): Promise<string[]>; // -> external accountIds
  process?(webhook: WebhookInput, ctx: CallCtx): Promise<SyncResult>;
  /**
   * G3.6 (Slack) — per-connector webhook verification REPLACING the generic
   * x-hook-secret gate (chunk-1 handoff seam). Runs over webhook.rawBody
   * BEFORE any parse-derived data is trusted (SPEC-D §8.6); the definition
   * config is passed so the secret (stored under `webhookSecret`) never has to
   * live inside the connector. Return false → the route 401s.
   */
  verifyWebhook?(webhook: WebhookInput, defConfig: Record<string, string>): boolean;
  /**
   * G3.6 — provider handshake responses answered INLINE by the route (§5.9
   * item 3, Slack `url_verification`). Runs AFTER verification. Return a JSON
   * body to short-circuit the request (no dispatch), or null to proceed.
   */
  webhookChallenge?(webhook: WebhookInput): Record<string, unknown> | null;
}

/**
 * Config/contract failures are LOUD (SPEC-D §1 decision 6): the runtime
 * rethrows these instead of soft-converting to {isError:true}. Connectors throw
 * it for missing clientId/secret, malformed args, unknown tool names; API-layer
 * failures stay plain Errors (soft path).
 */
export class ConnectorConfigError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ConnectorConfigError";
    this.status = status;
  }
}

// ─── API projection shapes (never contain secrets) ───────────────────────────

export interface LastSyncSummary {
  at: string;
  ok: boolean;
  activitiesCount: number;
  error?: string;
}

export interface AccountSummary {
  id: string;
  accountId: string;
  displayName: string | null;
  isActive: boolean;
  autoActivityRead: boolean;
  triggersEnabled: boolean;
  lastSync?: LastSyncSummary;
}

export interface ActivityRow {
  id: string;
  accountId: string;
  text: string;
  sourceUrl: string | null;
  eventType: string | null;
  payload: Record<string, unknown> | null;
  rejectionReason: string | null;
  ingestStatus: "pending" | "ingested" | "rejected" | "failed";
  /** Stable per-item dedupe key (hardening item 7); NULL on legacy rows. */
  dedupeKey: string | null;
  /** Memory-ingest attempts so far (hardening item 8; retry cap 5). */
  ingestAttempts: number;
  createdAt: string;
}

export interface CallLogRow {
  id: string;
  accountId: string;
  toolName: string;
  source: string | null;
  args: Record<string, unknown>; // REDACTED (redactArgs) before storage
  ok: boolean;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
}

export interface SyncRunRow {
  id: string;
  accountId: string;
  trigger: "schedule" | "manual" | "webhook";
  startedAt: string;
  finishedAt: string | null;
  ok: boolean | null;
  activitiesCount: number;
  error: string | null;
}

/** User-rule projection for the §5.5 routes (rows live in SPEC-A's ingestion_rules). */
export interface IntegrationRuleRow {
  id: string;
  name: string | null;
  text: string;
  preFilter: { include?: string[]; exclude?: string[] } | null;
  isActive: boolean;
  createdAt: string;
}
