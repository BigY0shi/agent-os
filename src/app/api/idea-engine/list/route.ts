import { NextResponse } from "next/server";
import { listDossiers } from "@/lib/ideaEngine";
import { anyRunning } from "@/lib/ideaValidation";
import { readDaily } from "@/lib/ideaDaily";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/idea-engine/list — dossier archive + validation state + daily-idea stamp.
export async function GET() {
  return NextResponse.json({
    ok: true,
    dossiers: await listDossiers(),
    running: anyRunning(),
    daily: await readDaily(),
  });
}
