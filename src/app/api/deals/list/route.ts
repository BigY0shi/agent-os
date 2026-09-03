import { listDeals, DESK_COLUMNS } from "@/lib/upworkDesk";
import { clampMaxAgeDays } from "@/lib/dealDeskControl";
import { readSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const deals = await listDeals();
    // S4 (f): the card shows its age against the gate, so the gate rides along.
    const maxAgeDays = clampMaxAgeDays(readSettings().deals?.maxAgeDays);
    return Response.json(
      { ok: true, deals, columns: DESK_COLUMNS, maxAgeDays },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
