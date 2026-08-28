"use client";

// F5.2 Approvals tab — this agent's pending cards (the existing ApprovalsStrip,
// filtered upstream by AgentDetail). Carries both kinds: tool approvals, and
// questions the run parked on — those render a reply box.

import type { ApprovalReq } from "@/lib/agentsTypes";
import { ApprovalsStrip } from "@/components/AgentsView";

export default function ApprovalsTab({ approvals, onDecided }: { approvals: ApprovalReq[]; onDecided: () => void }) {
  async function post(body: Record<string, unknown>) {
    await fetch("/api/agents/approvals", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).catch(() => {});
    onDecided();
  }

  if (approvals.length === 0) {
    return <div className="text-[12.5px]" style={{ color: "var(--fg-dimmer)" }}>Nothing waiting on you — approvals and the agent&apos;s questions appear here when a run pauses.</div>;
  }
  return (
    <ApprovalsStrip
      approvals={approvals}
      onDecide={(id, decision) => void post({ id, decision })}
      onAnswer={(id, answer) => void post({ id, answer })}
    />
  );
}
