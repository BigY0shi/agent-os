import { hireBatchStatus, startHireBriefBatch } from "@/lib/hireBatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Hire Engine's bulk-analysis endpoint, mirroring /api/deals/brief-batch.
// Normally the brief pass starts automatically after a scan; this exists to poll
// progress (GET) and to work the tail / re-run after failures (POST).
export function GET() {
  return Response.json({ ...hireBatchStatus(), ok: true });
}

// POST → triage everything un-judged, then full-brief the pursue pile.
export async function POST() {
  const r = await startHireBriefBatch();
  if (!r.started && r.reason === "already running") {
    return Response.json({ ...hireBatchStatus(), ok: false, error: "An analysis pass is already running." }, { status: 409 });
  }
  return Response.json({ ...hireBatchStatus(), ...r, ok: true });
}
