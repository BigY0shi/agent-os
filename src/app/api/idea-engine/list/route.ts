import { NextResponse } from "next/server";
import { listDossiers } from "@/lib/ideaEngine";
import { activeRun } from "@/lib/ideaValidation";
import { readDaily } from "@/lib/ideaDaily";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/idea-engine/list — dossier archive + validation state + daily-idea stamp.
// `active` carries the full in-flight run so a reloaded page (or one that never
// started the run — daily loop) can resume the live council panel.
export async function GET() {
  const active = activeRun();
  return NextResponse.json({
    ok: true,
    dossiers: await listDossiers(),
    running: !!active,
    active,
    daily: await readDaily(),
  });
}
