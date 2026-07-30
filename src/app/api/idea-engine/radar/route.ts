import { NextResponse } from "next/server";
import { patchCandidate, readCandidates, scanStatus, startScan } from "@/lib/ideaRadar";
import { CANDIDATE_COLUMNS, type CandidateStatus } from "@/lib/ideaEngineTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// GET — the candidate board + current scan job.
export async function GET() {
  return NextResponse.json({ ok: true, candidates: await readCandidates(), scan: scanStatus() });
}

// POST — start a radar scan (all adapters, degraded per-source on failure).
export async function POST() {
  const r = await startScan();
  if (!r.started) return NextResponse.json({ ok: false, error: r.reason, scan: scanStatus() }, { status: 409 });
  return NextResponse.json({ ok: true, scan: scanStatus() });
}

// PATCH { id, status } — move a candidate between board columns.
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({})) as { id?: string; status?: string };
  const valid = CANDIDATE_COLUMNS.some((c) => c.key === body.status);
  if (!body.id || !valid) return NextResponse.json({ ok: false, error: "id + valid status required" }, { status: 400 });
  const c = await patchCandidate(body.id, { status: body.status as CandidateStatus });
  if (!c) return NextResponse.json({ ok: false, error: "candidate not found" }, { status: 404 });
  return NextResponse.json({ ok: true, candidate: c });
}
