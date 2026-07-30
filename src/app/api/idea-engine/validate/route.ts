import { NextResponse } from "next/server";
import { loadRun, safeId } from "@/lib/ideaEngine";
import { cancelValidation, liveRun, startValidation } from "@/lib/ideaValidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// POST { idea, candidateId? } → start a council validation run (one at a time).
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { idea?: string; candidateId?: string };
  if (!body.idea?.trim()) return NextResponse.json({ ok: false, error: "idea required" }, { status: 400 });
  const res = await startValidation(body.idea, body.candidateId);
  if ("error" in res) return NextResponse.json({ ok: false, ...res }, { status: 409 });
  return NextResponse.json({ ok: true, ...res });
}

// DELETE ?id=<runId> → cancel a running council and free the one-run lock.
export async function DELETE(req: Request) {
  const id = safeId(new URL(req.url).searchParams.get("id") || "");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const cancelled = await cancelValidation(id);
  if (!cancelled) return NextResponse.json({ ok: false, error: "no running validation with that id" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// GET ?id=<runId> → run status (live registry first, disk after restart).
export async function GET(req: Request) {
  const id = safeId(new URL(req.url).searchParams.get("id") || "");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const run = liveRun(id) ?? await loadRun(id);
  if (!run) return NextResponse.json({ ok: false, error: "run not found" }, { status: 404 });
  return NextResponse.json({ ok: true, run });
}
