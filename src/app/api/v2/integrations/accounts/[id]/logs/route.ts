import { NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { getAccount, listCallLogs, listSyncRuns } from "@/lib/v2/integrations/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/v2/integrations/accounts/[id]/logs → { calls, syncs } — latest 100
 * each (§5.4). Call-log args are stored REDACTED, so nothing here can leak.
 */
export async function GET(_req: Request, ctx: Ctx) {
  ensureV2();
  const { id } = await ctx.params;
  if (!getAccount(id)) {
    return NextResponse.json({ error: "account not found" }, { status: 404, ...noStore });
  }
  return NextResponse.json(
    { calls: listCallLogs(id, 100), syncs: listSyncRuns(id, 100) },
    noStore,
  );
}
