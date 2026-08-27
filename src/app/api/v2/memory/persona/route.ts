import { NextRequest, NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { generatePersonaFull, getPersonaDocument } from "@/lib/v2/memory/persona";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/** GET /api/v2/memory/persona — {document: {content, updatedAt, ...} | null}. */
export async function GET() {
  ensureV2();
  return NextResponse.json({ document: getPersonaDocument() }, noStore);
}

/**
 * POST /api/v2/memory/persona — {mode: "full"} triggers full generation.
 * Invariant (SPEC-A A6.2): full regen over an existing doc is FORBIDDEN —
 * PersonaExistsError (status 409) maps to HTTP 409.
 */
export async function POST(req: NextRequest) {
  ensureV2();
  const body = (await req.json().catch(() => null)) as { mode?: string } | null;
  if (body?.mode !== "full") {
    return NextResponse.json(
      { error: "mode 'full' is the only supported mode" },
      { status: 400, ...noStore },
    );
  }
  try {
    const document = await generatePersonaFull();
    return NextResponse.json({ document }, { status: 201, ...noStore });
  } catch (err) {
    const status =
      err && typeof err === "object" && "status" in err && (err as { status: number }).status === 409
        ? 409
        : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status, ...noStore },
    );
  }
}
