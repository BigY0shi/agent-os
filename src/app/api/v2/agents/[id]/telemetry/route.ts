import { NextRequest, NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { safeId } from "@/lib/agentsStore";
import { listSessionRows } from "@/lib/v2/browser/audit";
import { listStatusEvents } from "@/lib/v2/agents/statusFeed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/**
 * GET /api/v2/agents/[id]/telemetry — the detail page's Runs-tab side data:
 * browser_sessions rows for this agent (E3∩F3 linkage) + recent
 * agent_status_events history. Both read-only, both never-throw stores.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  ensureV2();
  const id = safeId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "bad id" }, { status: 400, ...noStore });
  try {
    return NextResponse.json(
      {
        sessions: listSessionRows({ agentId: id, limit: 50 }),
        statusEvents: listStatusEvents({ agentId: id, limit: 50 }),
      },
      noStore,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ sessions: [], statusEvents: [], error: message }, { status: 500, ...noStore });
  }
}
