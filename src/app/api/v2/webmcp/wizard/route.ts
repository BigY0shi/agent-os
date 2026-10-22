import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { WebmcpError } from "@/lib/v2/webmcp/store";
import { listDrafts, createDraft, type WizardMode } from "@/lib/v2/webmcp/wizard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

function errResponse(err: unknown) {
  const status = err instanceof WebmcpError ? err.status : 500;
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status, ...noStore });
}

/** GET /api/v2/webmcp/wizard → { drafts } (active drafts, newest first). */
export async function GET() {
  ensureV2();
  return NextResponse.json({ drafts: listDrafts() }, noStore);
}

/**
 * POST /api/v2/webmcp/wizard { mode?: "wizard" | "own", description?: string }
 * → 201 { draft }. S7 step 1: the description is stored; no model runs here.
 */
export async function POST(req: NextRequest) {
  ensureV2();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const mode = body?.mode === "own" ? "own" : "wizard";
  try {
    const draft = createDraft({
      mode: mode as WizardMode,
      description: typeof body?.description === "string" ? body.description : "",
    });
    return NextResponse.json({ draft }, { status: 201, ...noStore });
  } catch (err) {
    return errResponse(err);
  }
}
