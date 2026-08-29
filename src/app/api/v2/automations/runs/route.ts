import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { listRuns } from "@/lib/v2/automations/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/** SPEC-D §5.7 — GET /api/v2/automations/runs?ruleId=&limit= → { runs }. */
export async function GET(req: NextRequest) {
  ensureV2();
  const ruleId = req.nextUrl.searchParams.get("ruleId") ?? undefined;
  const limitRaw = parseInt(req.nextUrl.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitRaw) ? limitRaw : undefined;
  return NextResponse.json({ runs: listRuns({ ruleId, limit }) }, noStore);
}
