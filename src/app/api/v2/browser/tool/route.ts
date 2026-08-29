import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { executeBrowserTool } from "@/lib/v2/browser/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/**
 * SPEC-E §5.1 — POST /api/v2/browser/tool { tool, args, caller? }.
 * Success → { ok:true, result }; failure → HTTP 400 with
 * { ok:false, error:{code,message} } — codes TOOL_NOT_FOUND |
 * SESSION_NOT_CONFIGURED | DOMAIN_BLOCKED | TOOL_ERROR | CAPABILITY_DISABLED.
 * Upstream lesson honored: tool-level failures carry the full message, never
 * a bare status. Server-side callers import the lib directly — this route
 * exists for the E2 page and LAN clients.
 */
export async function POST(req: NextRequest) {
  ensureV2();
  const body = (await req.json().catch(() => null)) as {
    tool?: unknown;
    args?: unknown;
    caller?: unknown;
  } | null;
  const tool = typeof body?.tool === "string" ? body.tool : "";
  if (!tool) {
    return NextResponse.json(
      { ok: false, error: { code: "TOOL_NOT_FOUND", message: "tool is required" } },
      { status: 400, ...noStore },
    );
  }
  const args =
    body?.args && typeof body.args === "object" && !Array.isArray(body.args)
      ? (body.args as Record<string, unknown>)
      : {};
  const caller = typeof body?.caller === "string" && body.caller.trim() ? body.caller.trim() : "user";

  const res = await executeBrowserTool(tool, args, { caller });
  if (res.ok) return NextResponse.json(res, noStore);
  return NextResponse.json(res, { status: 400, ...noStore });
}
