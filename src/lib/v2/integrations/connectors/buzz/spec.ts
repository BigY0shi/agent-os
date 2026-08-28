import type { ConnectorSpec } from "../../types";

/**
 * SPEC-D G3.7 — Buzz connector spec. LOCAL auth (§3.3: "no auth fields; bridge
 * key already at ~/.agentic-os/buzz.env") — connect is a single button that
 * verifies buzz.exe + the bridge env exist. Sync polls channels every 15 min;
 * watermark = last event timestamp per channel.
 */
export const buzzSpec: ConnectorSpec = {
  name: "Buzz",
  slug: "buzz",
  description:
    "Connect your workspace to Buzz (Nostr agent chat). Post to channels, read conversations, and capture inbound messages",
  icon: "buzz",
  category: "communication",
  auth: { local: true },
  schedule: { frequency: "*/15 * * * *" }, // §3.3: channel poll (15 min)
  triggers: [{ key: "BUZZ_MESSAGE_RECEIVED", label: "Buzz message received" }],
  uiHint:
    "Uses the existing Agent OS bridge identity (~/.agentic-os/buzz.env + the bundled buzz.exe) — " +
    "nothing to enter. Connect fails loudly if the bridge isn't set up.",
};
