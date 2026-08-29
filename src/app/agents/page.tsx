// SPEC-E F5.1 — /agents recomposition: hero + approvals strip + cards grid +
// registry footer (AgentsPageV2). The old AgentsView drawer moved to
// /agents/[id]; its pickers/transcript are reused via named exports.

import AgentsPageV2 from "@/components/v2/agents/AgentsPageV2";

export const metadata = { title: "Agents · Agentic OS" };

export default function AgentsPage() {
  return <AgentsPageV2 />;
}
