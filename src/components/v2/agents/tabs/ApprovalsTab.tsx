"use client";

// F5.2 Approvals tab — this agent's pending approval cards (the existing
// ApprovalsStrip, filtered upstream by AgentDetail).

import type { ApprovalReq } from "@/lib/agentsTypes";
import { ApprovalsStrip } from "@/components/AgentsView";

export default function ApprovalsTab({ approvals, onDecided }: { approvals: ApprovalReq[]; onDecided: () => void }) {
  async function decide(id: string, decision: "allow" | "deny") {
    await fetch("/api/agents/approvals", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, decision }),
    }).catch(() => {});
    onDecided();
  }

  if (approvals.length === 0) {
    return <div className="text-[12.5px]" style={{ color: "var(--fg-dimmer)" }}>Nothing waiting on you — approvals appear here when a run pauses for one.</div>;
  }
  return <ApprovalsStrip approvals={approvals} onDecide={(id, d) => void decide(id, d)} />;
}
