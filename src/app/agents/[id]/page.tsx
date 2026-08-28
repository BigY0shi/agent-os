// SPEC-E F5.2 — /agents/[id] tabbed detail (Overview · Runs · Approvals ·
// Settings). Suspense wraps AgentDetail because it reads useSearchParams
// (?tab=) — Next requires a boundary for CSR bailout.

import { Suspense } from "react";
import AgentDetail from "@/components/v2/agents/AgentDetail";

export const metadata = { title: "Agent · Agentic OS" };

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <AgentDetail id={id} />
    </Suspense>
  );
}
