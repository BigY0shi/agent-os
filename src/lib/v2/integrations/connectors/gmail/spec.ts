import type { ConnectorSpec } from "../../types";

/**
 * SPEC-D G3.1 — Gmail connector spec (verbatim-adapt of AOC
 * integrations/gmail/src/index.ts getSpec()).
 *
 * Google web-app OAuth flow: PKCE disabled (§3.3), offline access + forced
 * consent so a refresh_token is always issued. clientId/clientSecret are
 * entered in-app via the definition-config PATCH — never seeded in code; the
 * real Google endpoints are hardcoded (no ${...} templates needed).
 *
 * OAuth-on-LAN caveat (SPEC-D §8.3), surfaced via uiHint: the registered
 * redirect URI must EXACTLY match settings.integrations.callbackOrigin +
 * /api/v2/integrations/oauth/callback. When connecting from a LAN device the
 * provider redirects to the SERVER's origin — authorize from the machine
 * running Agent OS, or set callbackOrigin to the LAN URL and register that
 * with Google.
 *
 * Scope delta vs upstream: + gmail.settings.basic — upstream shipped filter
 * tools (users.settings.filters.*) without the scope they require; kept the
 * rest verbatim.
 */
export const gmailSpec: ConnectorSpec = {
  name: "Gmail",
  slug: "gmail",
  description:
    "Connect your workspace to Gmail. Monitor emails, send messages, and manage your email workflow",
  icon: "gmail",
  category: "communication",
  auth: {
    oauth2: {
      authorization_url: "https://accounts.google.com/o/oauth2/v2/auth",
      token_url: "https://oauth2.googleapis.com/token",
      scopes: [
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/gmail.labels",
        "https://www.googleapis.com/auth/gmail.settings.basic",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
      ],
      scope_identifier: "scope",
      scope_separator: " ",
      authorization_params: {
        access_type: "offline",
        prompt: "consent",
      },
      disable_pkce: true, // Google web-app flow (SPEC-D §3.3)
    },
  },
  schedule: { frequency: "*/15 * * * *" },
  triggers: [{ key: "GMAIL_MESSAGE_RECEIVED", label: "Email received" }],
  uiHint:
    "Authorize from the machine running Agent OS (the OAuth callback goes to the server's origin). " +
    "Register the shown redirect URI verbatim in the Google Cloud console; if you connect from a LAN " +
    "device, set callbackOrigin to the LAN URL and register that instead.",
};
