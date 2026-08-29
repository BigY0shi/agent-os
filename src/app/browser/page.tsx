import BrowserView from "@/components/v2/browser/BrowserView";

// /browser (SPEC-E E2) — the agent browser: session rail, CDP live view over
// the ticket-authed WS bridge, headed "Let me log in" handoff, audit drawer.
// Fully isolated from Yoshi's Opera (E4.1 — profiles live only under
// ~/.agentic-os/browser-profiles).
export default function BrowserRoute() {
  return (
    <div className="min-h-[calc(100vh-220px)]">
      <BrowserView />
    </div>
  );
}
