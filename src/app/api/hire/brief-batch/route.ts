import { hireBatchStatus, startHireBriefBatch } from "@/lib/hireBatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Hire Engine's bulk-analysis endpoint, mirroring /api/deals/brief-batch.
// Normally the brief pass starts automatically after a scan; this exists to poll
// progress (GET) and to work the tail / re-run after failures (POST).
export function GET() {
  return Response.json({ ...hireBatchStatus(), ok: true });
}

// POST { limit?: number }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { limit?: number };
  const r = await startHireBriefBatch(body.limit);
  if (!r.started && r.reason === "already running") {
    return Response.json({ ...hireBatchStatus(), ok: false, error: "A brief pass is already running." }, { status: 409 });
  }
  return Response.json({ ...hireBatchStatus(), ...r, ok: true });
}
