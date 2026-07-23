import { listDeals, DESK_COLUMNS } from "@/lib/upworkDesk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const deals = await listDeals();
    return Response.json(
      { ok: true, deals, columns: DESK_COLUMNS },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
