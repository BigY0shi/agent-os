import { startBriefBatch, briefBatchStatus } from "@/lib/briefBatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Manual bulk brief. Normally this runs automatically — a feed pull briefs the new
// leads, and "Clear passed & refill" tops the queue back up. This route exists to work
// the tail, or to re-run after a failed pass. POST starts, GET polls; a pass is ~a
// minute, so it cannot be a synchronous request.
//
// NOTE: the job spread goes FIRST in every response. BriefJob carries its own `error`
// field, so spreading it last would silently overwrite the error message being reported.
export function GET() {
  return Response.json({ ...briefBatchStatus(), ok: true });
}

// POST { source?: "remoteok" | "wwr" | "upwork", limit?: number, target?: number }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { source?: string; limit?: number; target?: number };
  const r = await startBriefBatch(body);
  if (!r.started && r.reason === "already running") {
    return Response.json(
      { ...briefBatchStatus(), ok: false, error: "A brief pass is already running." },
      { status: 409 },
    );
  }
  return Response.json({ ...briefBatchStatus(), ...r, ok: true });
}
