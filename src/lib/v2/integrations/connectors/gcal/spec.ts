import type { ConnectorSpec } from "../../types";

/**
 * SPEC-D G3.5 — Google Calendar connector spec (verbatim-adapt of AOC
 * integrations/google-calendar/src/index.ts getSpec()). Same Google OAuth app
 * as gmail — the uiHint tells Yoshi to reuse the Gmail clientId/clientSecret
 * in this definition's config (§3.3: "definition config shared via settings
 * hint"); the OAuth-on-LAN redirect caveat from the gmail spec applies
 * identically.
 */
export const gcalSpec: ConnectorSpec = {
  name: "Google Calendar",
  slug: "gcal",
  description:
    "Connect your workspace to Google Calendar. Create, read, update, and manage calendar events with powerful automation",
  icon: "google-calendar",
  category: "productivity",
  auth: {
    oauth2: {
      authorization_url: "https://accounts.google.com/o/oauth2/v2/auth",
      token_url: "https://oauth2.googleapis.com/token",
      scopes: [
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
      ],
      scope_identifier: "scope",
      scope_separator: " ",
      authorization_params: {
        access_type: "offline",
        prompt: "consent",
      },
      disable_pkce: true, // Google web-app flow (same as gmail)
    },
  },
  schedule: { frequency: "*/30 * * * *" }, // §3.3: today+7d events poll (30 min)
  triggers: [
    { key: "GCAL_EVENT_CREATED", label: "Event created or changed" },
    { key: "GCAL_EVENT_SOON", label: "Event starting soon (≤15 min)" },
  ],
  widgets: ["calendar"], // H3.3 calendar widget is powered by this connector
  uiHint:
    "Reuse the Gmail app credentials: enter the SAME Google clientId/clientSecret here (one Google " +
    "Cloud app can serve both connectors — just enable the Calendar API and add the calendar scopes " +
    "to its consent screen). The redirect URI caveat from Gmail applies: authorize from the machine " +
    "running Agent OS, or register the LAN callbackOrigin with Google.",
};
