import {
  ConnectorConfigError,
  type ConnectorModule,
  type ConnectorSpec,
  type ConnectorTool,
  type SetupInput,
  type AccountCreate,
  type CallCtx,
  type SyncCtx,
  type SyncResult,
  type WebhookInput,
  type ToolResult,
} from "../../types";

/**
 * SPEC-D G2.2 — the `_test` fixture connector. NOT a real integration: it
 * exists so the runtime/oauth/sync/webhook smokes (and the Tools tab, later)
 * can exercise every seam deterministically with zero network. '_'-prefixed
 * slugs are hidden from the default §5.1 connector list.
 *
 * Behaviors wired for the smokes:
 * - api-key setup: token 'bad-token' → throws (422 path); anything else connects.
 * - oauth2 setup: accountId comes from the mock token server's response.
 * - `_test_echo` echoes args + the injected timezone (verbatim-name proof).
 * - `_test_fail` throws a plain Error (soft {isError:true} path).
 * - sync emits 3 fixture activities gated by a numeric `cursor` watermark
 *   (second run → 0 new); config.token 'sync-fail' → sync throws.
 * - identify/process: webhook body {account, msg} → one activity.
 */

const spec: ConnectorSpec = {
  name: "Test Fixture",
  slug: "_test",
  description: "Internal fixture connector for smoke tests. Not a real integration.",
  icon: "flask",
  category: "internal",
  auth: {
    apiKey: { fields: [{ name: "token", label: "Token", placeholder: "any value" }] },
    oauth2: {
      // ${...} templates resolve from the DEFINITION config (interpolateString)
      // so the oauth smoke can point them at an ephemeral mock server.
      authorization_url: "${authBase}/authorize",
      token_url: "${tokenBase}/token",
      scopes: ["read"],
      default_scopes: ["fixture"],
      scope_identifier: "scope",
      scope_separator: " ",
      body_format: "form",
    },
  },
  schedule: { frequency: "*/15 * * * *" },
  triggers: [{ key: "TEST_EVENT", label: "Test event" }],
};

const FIXTURE_ITEMS = [
  { n: 1, text: "fixture activity one", url: "https://example.com/items/1" },
  { n: 2, text: "fixture activity two", url: "https://example.com/items/2" },
  { n: 3, text: "fixture junk mail item", url: "https://example.com/items/3" },
];

async function setup(input: SetupInput): Promise<AccountCreate> {
  if (input.fields) {
    const token = (input.fields.token ?? "").trim();
    if (!token) throw new ConnectorConfigError("token is required");
    if (token === "bad-token") throw new Error("invalid token: fixture API rejected it");
    return {
      accountId: `fixture-${token}`,
      // NEVER derive a display name from the raw credential (the api smoke
      // greps responses for it) — last-4 suffix only, like real connectors.
      displayName: `Fixture (…${token.slice(-4)})`,
      config: { token },
    };
  }
  if (input.oauthResponse) {
    const accessToken = String(input.oauthResponse.access_token ?? "");
    if (!accessToken) throw new Error("token response had no access_token");
    const account = String(input.oauthResponse.account ?? "oauth-user");
    return {
      accountId: `fixture-oauth-${account}`,
      displayName: `Fixture OAuth (${account})`,
      config: {
        accessToken,
        ...(input.oauthResponse.refresh_token
          ? { refreshToken: String(input.oauthResponse.refresh_token) }
          : {}),
      },
    };
  }
  throw new ConnectorConfigError("setup needs api-key fields or an oauth response");
}

function getTools(): ConnectorTool[] {
  return [
    {
      name: "_test_echo",
      description: "Echo the input back, plus the runtime-injected timezone.",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string", description: "text to echo" } },
        required: ["text"],
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "_test_fail",
      description: "Always throws — exercises the soft isError path.",
      inputSchema: { type: "object", properties: {} },
    },
  ];
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  ctx: CallCtx,
): Promise<ToolResult> {
  switch (name) {
    case "_test_echo":
      return {
        text: JSON.stringify({
          tool: name, // proves the advertised name arrived verbatim
          echoed: args.text ?? null,
          timezone: ctx.timezone,
          hasToken: !!(ctx.config.token || ctx.config.accessToken),
        }),
      };
    case "_test_fail":
      throw new Error("fixture API exploded (deliberate)");
    default:
      // Unknown tool = caller contract violation → LOUD (decision 6).
      throw new ConnectorConfigError(`unknown tool '${name}'`);
  }
}

async function sync(ctx: SyncCtx): Promise<SyncResult> {
  if (ctx.config.token === "sync-fail") {
    throw new Error("fixture sync exploded (deliberate)");
  }
  const cursor = parseInt(ctx.state.cursor ?? "0", 10) || 0;
  const fresh = FIXTURE_ITEMS.filter((item) => item.n > cursor);
  return {
    activities: fresh.map((item) => ({
      text: item.text,
      sourceURL: item.url,
      eventType: "TEST_EVENT",
      payload: { n: item.n },
    })),
    // State returned ONLY when there was progress (upstream watermark rule).
    ...(fresh.length > 0
      ? { state: { cursor: String(FIXTURE_ITEMS[FIXTURE_ITEMS.length - 1].n) } }
      : {}),
  };
}

async function identify(webhook: WebhookInput): Promise<string[]> {
  const body = webhook.body as Record<string, unknown> | null;
  const account = body?.account;
  return account ? [String(account)] : [];
}

async function process(webhook: WebhookInput, _ctx: CallCtx): Promise<SyncResult> {
  const body = webhook.body as Record<string, unknown> | null;
  return {
    activities: [
      {
        text: `webhook: ${String(body?.msg ?? "(no msg)")}`,
        eventType: "TEST_EVENT",
        payload: { via: "webhook" },
      },
    ],
  };
}

export const testConnector: ConnectorModule = {
  spec,
  setup,
  getTools,
  callTool,
  sync,
  identify,
  process,
};
