import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { getOrCreateDailyPage, listPages, localDateStr } from "@/lib/v2/pages/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/**
 * GET /api/v2/pages (SPEC-B B5)
 *   ?date=YYYY-MM-DD → find-or-create that daily page (default: today in
 *                      settings.tasks.timezone) → { page }
 *   ?list=1          → { pages } (summaries, no doc bodies)
 */
export async function GET(req: NextRequest) {
  ensureV2();
  const p = req.nextUrl.searchParams;

  if (p.get("list")) {
    const limitRaw = parseInt(p.get("limit") ?? "", 10);
    const pages = listPages(Number.isFinite(limitRaw) ? limitRaw : undefined).map((pg) => ({
      id: pg.id,
      date: pg.date,
      title: pg.title,
      rev: pg.rev,
      createdAt: pg.createdAt,
      updatedAt: pg.updatedAt,
    }));
    return NextResponse.json({ pages }, noStore);
  }

  const dateRaw = p.get("date");
  if (dateRaw && !/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400, ...noStore });
  }
  try {
    const page = getOrCreateDailyPage(dateRaw ?? localDateStr());
    return NextResponse.json({ page }, noStore);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500, ...noStore },
    );
  }
}
