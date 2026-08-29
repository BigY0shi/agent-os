import { NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { publishPackage, WebmcpError } from "@/lib/v2/webmcp/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/**
 * POST /api/v2/webmcp/packages/[id]/publish — the promotion gate: validates
 * (≥1 tool, object schemas, handler configs), freezes a snapshot, bumps
 * current_version, registers each tool on the F4 registry as `<slug>/<tool>`.
 * → { package, version } | 400 validation | 409 archived.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  ensureV2();
  try {
    const { package: pkg, version } = publishPackage((await ctx.params).id);
    return NextResponse.json({ package: pkg, version, registered: true }, noStore);
  } catch (err) {
    const status = err instanceof WebmcpError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status, ...noStore });
  }
}
