import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { getPackage } from "@/lib/v2/webmcp/store";
import { executeDraftTool } from "@/lib/v2/webmcp/execute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/**
 * POST /api/v2/webmcp/packages/[id]/test { toolName, args? } — the Test-tab
 * lane: executes the DRAFT working set (works on unpublished packages; the
 * published snapshot is never consulted). Logged with source 'test'.
 * → { ok, output, error?, durationMs, logs? }
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  ensureV2();
  const pkg = getPackage((await ctx.params).id);
  if (!pkg) return NextResponse.json({ error: "package not found" }, { status: 404, ...noStore });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.toolName !== "string") {
    return NextResponse.json({ error: "body needs { toolName, args? }" }, { status: 400, ...noStore });
  }
  const args =
    body.args && typeof body.args === "object" && !Array.isArray(body.args)
      ? (body.args as Record<string, unknown>)
      : {};
  const result = await executeDraftTool(pkg.id, body.toolName, args, "test");
  return NextResponse.json(result, noStore);
}
