import { NextResponse } from "next/server";
import { listDossiers } from "@/lib/ideaEngine";
import { anyRunning } from "@/lib/ideaValidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/idea-engine/list — dossier archive + whether a validation is running.
export async function GET() {
  return NextResponse.json({ ok: true, dossiers: await listDossiers(), running: anyRunning() });
}
