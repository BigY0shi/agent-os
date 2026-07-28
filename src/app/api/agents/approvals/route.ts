import { NextResponse } from "next/server";
import { pendingApprovals, resolveApproval } from "@/lib/agentsRuntime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/agents/approvals — global pending queue (live runs only).
export async function GET() {
  return NextResponse.json({ approvals: await pendingApprovals() });
}

// POST /api/agents/approvals — { id, decision: "allow" | "deny" }
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { id?: string; decision?: string } | null;
  if (!body?.id || !["allow", "deny"].includes(body.decision ?? "")) {
    return NextResponse.json({ error: "id and decision required" }, { status: 400 });
  }
  const ok = await resolveApproval(body.id, body.decision === "allow");
  return NextResponse.json({ ok, stale: !ok });
}
