import { NextResponse } from "next/server";
import { answerQuestion, pendingApprovals, resolveApproval } from "@/lib/agentsRuntime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/agents/approvals — global pending queue (live runs only). Carries
// both kinds: tool approvals and questions a run parked on.
export async function GET() {
  return NextResponse.json({ approvals: await pendingApprovals() });
}

// POST /api/agents/approvals
//   tool approval → { id, decision: "allow" | "deny" }
//   question      → { id, answer: "<the reply>" }   (the reply is pushed into
//                    the run's still-open input queue and it resumes)
//   a question can also be dismissed with decision:"deny" — the run then ends
//   unanswered rather than hanging until the park times out.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { id?: string; decision?: string; answer?: string } | null;
  if (!body?.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  if (typeof body.answer === "string") {
    if (!body.answer.trim()) return NextResponse.json({ error: "answer cannot be empty" }, { status: 400 });
    const ok = await answerQuestion(body.id, body.answer);
    return NextResponse.json({ ok, stale: !ok });
  }

  if (!["allow", "deny"].includes(body.decision ?? "")) {
    return NextResponse.json({ error: "decision must be allow or deny (or send answer for a question)" }, { status: 400 });
  }
  const ok = await resolveApproval(body.id, body.decision === "allow");
  return NextResponse.json({ ok, stale: !ok });
}
