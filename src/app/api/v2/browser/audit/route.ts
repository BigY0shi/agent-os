import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { listAuditRows } from "@/lib/v2/browser/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/** SPEC-E §5.1 — GET /api/v2/browser/audit?limit=100&session=<name>.
 *  args_preview rows are pre-redacted (fill/type values withheld at write
 *  time — audit.ts); nothing sensitive can round-trip through this route. */
export async function GET(req: NextRequest) {
  ensureV2();
  const limitRaw = parseInt(req.nextUrl.searchParams.get("limit") ?? "100", 10);
  const session = req.nextUrl.searchParams.get("session") ?? undefined;
  const rows = listAuditRows({
    limit: Number.isFinite(limitRaw) ? limitRaw : 100,
    session,
  });
  return NextResponse.json({ rows }, noStore);
}
