import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { listApprovals, toPublicApproval, type ApprovalStatus } from "@/lib/v2/webmcp/approvals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };
const STATUSES: ApprovalStatus[] = ["pending", "approved", "denied", "expired"];

/**
 * GET /api/v2/webmcp/approvals?status=&limit= → { approvals }
 * Human-Gate list. Responses carry redacted args ONLY (raw args never leave
 * the server). Session-cookie auth — proxy handles it like every v2 route.
 */
export async function GET(req: NextRequest) {
  ensureV2();
  const statusParam = req.nextUrl.searchParams.get("status") ?? "";
  if (statusParam && !STATUSES.includes(statusParam as ApprovalStatus)) {
    return NextResponse.json(
      { error: `status must be one of ${STATUSES.join("|")}` },
      { status: 400, ...noStore },
    );
  }
  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? "");
  const approvals = listApprovals({
    status: (statusParam || undefined) as ApprovalStatus | undefined,
    limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined,
  }).map(toPublicApproval);
  return NextResponse.json({ approvals }, noStore);
}
