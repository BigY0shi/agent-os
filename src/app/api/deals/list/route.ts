import { listDeals, DESK_COLUMNS } from "@/lib/upworkDesk";
import { clampMaxAgeDays, hiddenByAgeGate } from "@/lib/dealDeskControl";
import { readSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?stale=1 → include the leads the age gate would hide.
//
// The gate is enforced here, on the read, and not only when a pull lands. Landing-time
// pruning cannot cover a file written by another path, and it cannot cover the passage
// of time: a lead that was fresh when it landed is stale a week later and nothing was
// looking at it again. Filtering, never deleting - the rows stay in feeds.json, and the
// count of what was withheld rides along so the board can say so out loud.
export async function GET(req: Request) {
  try {
    const includeStale = new URL(req.url).searchParams.get("stale") === "1";
    const all = await listDeals();
    // S4 (f): the card shows its age against the gate, so the gate rides along.
    const maxAgeDays = clampMaxAgeDays(readSettings().deals?.maxAgeDays);
    const now = Date.now();
    const fresh = all.filter((d) => !hiddenByAgeGate(d.status, d.postedAt, maxAgeDays, now));
    const hidden = all.length - fresh.length;
    return Response.json(
      {
        ok: true,
        deals: includeStale ? all : fresh,
        columns: DESK_COLUMNS,
        maxAgeDays,
        // Reported, not swallowed: an empty column because 92 leads aged out is a
        // different fact from an empty column because the feed returned nothing.
        ageGate: { maxAgeDays, hidden, showing: includeStale ? "all" : "fresh" },
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
