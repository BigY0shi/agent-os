import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { getWidget } from "@/lib/v2/widgets/registry";
import { getWidgetData } from "@/lib/v2/widgets/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

type Ctx = { params: Promise<{ slug: string }> };

/**
 * SPEC-D §5.8 — GET /api/v2/widgets/[slug]/data?config=<urlencoded json>.
 * Dispatches to the widget's server data fn. Unknown slug → 404; malformed
 * config → 400; an unreadable/unconfigured source → 200 with the honest
 * { available: false, reason } (never fabricated data).
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  ensureV2();
  const { slug } = await ctx.params;
  if (!getWidget(slug)) {
    return NextResponse.json({ error: `unknown widget '${slug}'` }, { status: 404, ...noStore });
  }

  let config: Record<string, unknown> = {};
  const raw = req.nextUrl.searchParams.get("config");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      config = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: "config must be a urlencoded JSON object" },
        { status: 400, ...noStore },
      );
    }
  }

  return NextResponse.json(await getWidgetData(slug, config), noStore);
}
