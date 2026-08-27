import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { WebmcpError } from "@/lib/v2/webmcp/store";
import { exportPackage, EXPORT_MODES, type ExportMode } from "@/lib/v2/webmcp/exporter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/**
 * POST /api/v2/webmcp/packages/[id]/export { mode: "internal" | "client" }
 * → { path, mode, version, files, stubbedTools, configNames }
 * (SPEC-C D5.1). Generates <~/.agentic-os/webmcp/exports>/<slug>/{index.mjs,
 * package.json, README.md} from the CURRENT PUBLISHED SNAPSHOT.
 * 400 unknown/missing mode · 409 never published (or archived) · 404 unknown package.
 * Secret VALUES are never embedded in the export (either mode).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  ensureV2();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.mode !== "string" || !(EXPORT_MODES as readonly string[]).includes(body.mode)) {
    return NextResponse.json(
      { error: "body needs { mode: 'internal' | 'client' }" },
      { status: 400, ...noStore },
    );
  }
  try {
    const result = exportPackage((await ctx.params).id, { mode: body.mode as ExportMode });
    return NextResponse.json(result, noStore);
  } catch (err) {
    const status = err instanceof WebmcpError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status, ...noStore });
  }
}
