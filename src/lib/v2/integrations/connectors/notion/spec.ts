import type { ConnectorSpec } from "../../types";

/**
 * SPEC-D G3.3 — Notion connector spec (verbatim-adapt of AOC
 * integrations/notion/src/index.ts getSpec()).
 *
 * OAuth per §3.3: `token_request_auth_method: 'basic'` (client creds in the
 * Basic header at the token POST, never the body), `authorization_params:
 * {owner:'user'}`, PKCE DISABLED (Notion's flow doesn't support it), form
 * body. Scopes: Notion OAuth has NO scope concept — the empty array is
 * deliberate (declared-but-empty, upstream-verbatim), and the schema smoke
 * accepts a declared-empty array for exactly this connector shape.
 *
 * ADDITIVE vs upstream (chunk-3 brief): an `apiKey` path so an INTERNAL
 * integration token (Settings → Connections → Develop → "ntn_…" secret) can be
 * pasted through the existing /connect route — no public OAuth app needed for
 * a single workspace.
 */
export const notionSpec: ConnectorSpec = {
  name: "Notion",
  slug: "notion",
  description:
    "Connect your workspace to Notion. Create, read, and manage pages, databases, and blocks with powerful automation",
  icon: "notion",
  category: "productivity",
  auth: {
    oauth2: {
      authorization_url: "https://api.notion.com/v1/oauth/authorize",
      token_url: "https://api.notion.com/v1/oauth/token",
      scopes: [], // Notion OAuth has no scopes (upstream-verbatim)
      scope_separator: " ",
      authorization_params: { owner: "user" },
      token_request_auth_method: "basic",
      disable_pkce: true,
    },
    apiKey: {
      fields: [
        {
          name: "token",
          label: "Internal integration secret",
          placeholder: "ntn_…",
          description:
            "From notion.so → Settings → Connections → Develop or manage integrations. Share the pages/databases with the integration or it will see nothing.",
        },
      ],
    },
  },
  // No sync wave 1 (§3.3: SYNC none) — AOC's notion integration ships no
  // schedule.ts, so there is nothing to port; tools-only connector.
  uiHint:
    "Easiest path: paste an internal integration secret (no OAuth app needed). For OAuth, register a " +
    "public Notion integration and enter its clientId/clientSecret here; the redirect URI shown must " +
    "match the integration's settings exactly. Remember to share target pages with the integration.",
};
