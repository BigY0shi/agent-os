"use client";

// F5.2 Approvals tab — this agent's pending cards (the existing ApprovalsStrip,
// filtered upstream by AgentDetail). Carries both kinds: tool approvals, and
// questions the run parked on — those render a reply box.

import { useState } from "react";
import type { ApprovalReq } from "@/lib/agentsTypes";
import { ApprovalsStrip } from "@/components/AgentsView";
import { postDecision, postAnswer, decisionNotice } from "@/lib/agentsApprovalsClient";

export default function ApprovalsTab({ approvals, onDecided }: { approvals: ApprovalReq[]; onDecided: () => void }) {
  // A decision that resolved nothing has to say so. Silently re-syncing just
  // makes the card vanish, which is exactly what success looks like.
  const [notice, setNotice] = useState<string | null>(null);

  async function settle(p: Promise<Parameters<typeof decisionNotice>[0]>) {
    setNotice(decisionNotice(await p));
    onDecided();
  }

  if (approvals.length === 0) {
    return <div className="text-[12.5px]" style={{ color: "var(--fg-dimmer)" }}>Nothing waiting on you — approvals and the agent&apos;s questions appear here when a run pauses.</div>;
  }
  return (
    <div className="space-y-3">
      {notice && (
        <div className="rounded-xl border px-3.5 py-2.5 text-[12.5px]"
          style={{ borderColor: "rgba(251,191,36,0.45)", background: "rgba(251,191,36,0.07)", color: "var(--fg-dim)" }}>
          {notice}
        </div>
      )}
      <ApprovalsStrip
        approvals={approvals}
        onDecide={(id, decision) => void settle(postDecision(id, decision))}
        onAnswer={(id, answer) => void settle(postAnswer(id, answer))}
      />
    </div>
  );
}
