import { NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { IntegrationError } from "@/lib/v2/integrations/store";
import { isSyncRunning, runAccountSync } from "@/lib/v2/integrations/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v2/integrations/accounts/[id]/sync (§5.4) — run a manual sync NOW.
 * 202 { running: true } when one is already in flight (overlap guard). Manual
 * syncs run regardless of the settings.integrations.syncEnabled kill switch
 * (that gates scheduled fires only).
 */
export async function POST(_req: Request, ctx: Ctx) {
  ensureV2();
  const { id } = await ctx.params;
  if (isSyncRunning(id)) {
    return NextResponse.json({ running: true }, { status: 202, ...noStore });
  }
  try {
    const outcome = await runAccountSync(id, "manual");
    if (outcome.running) {
      return NextResponse.json({ running: true }, { status: 202, ...noStore });
    }
    return NextResponse.json(
      {
        ok: outcome.ok,
        activitiesCount: outcome.activitiesCount,
        rejectedCount: outcome.rejectedCount,
        state: outcome.state ?? {},
        ...(outcome.error ? { error: outcome.error } : {}),
      },
      noStore,
    );
  } catch (err) {
    const status = err instanceof IntegrationError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status, ...noStore });
  }
}
