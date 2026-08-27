import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { getAccount, listActivities } from "@/lib/v2/integrations/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/v2/integrations/accounts/[id]/activity?limit=50&before=<iso>
 * → { activities: ActivityRow[] } (§5.4).
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  ensureV2();
  const { id } = await ctx.params;
  if (!getAccount(id)) {
    return NextResponse.json({ error: "account not found" }, { status: 404, ...noStore });
  }
  const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10) || 50;
  const before = req.nextUrl.searchParams.get("before") ?? undefined;
  return NextResponse.json({ activities: listActivities(id, { limit, before }) }, noStore);
}
