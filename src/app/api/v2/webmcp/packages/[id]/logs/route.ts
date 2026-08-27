import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { getPackage, listCallLogs } from "@/lib/v2/webmcp/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/**
 * GET /api/v2/webmcp/packages/[id]/logs?tool=&source=&before=&limit=
 * → { logs, nextCursor } — cursor-paged call logs for ONE package (SPEC §5;
 * the package GET's recentLogs covers the first page, this route pages back).
 * `before` is the previous page's nextCursor (created_at, strictly older).
 * nextCursor is null once a short page signals the end.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  ensureV2();
  const pkg = getPackage((await ctx.params).id);
  if (!pkg) return NextResponse.json({ error: "package not found" }, { status: 404, ...noStore });

  const sp = req.nextUrl.searchParams;
  const limitRaw = Number(sp.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
  const logs = listCallLogs({
    packageSlug: pkg.slug,
    toolName: sp.get("tool") || undefined,
    source: sp.get("source") || undefined,
    before: sp.get("before") || undefined,
    limit,
  });
  const nextCursor = logs.length === limit ? logs[logs.length - 1].createdAt : null;
  return NextResponse.json({ logs, nextCursor }, noStore);
}
