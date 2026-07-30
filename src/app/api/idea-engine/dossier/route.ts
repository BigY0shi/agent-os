import { NextResponse } from "next/server";
import { loadDossier, renderDossier, safeId } from "@/lib/ideaEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?id=<dossierId> → full dossier JSON + rendered markdown.
export async function GET(req: Request) {
  const id = safeId(new URL(req.url).searchParams.get("id") || "");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const dossier = await loadDossier(id);
  if (!dossier) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, dossier, markdown: renderDossier(dossier) });
}
