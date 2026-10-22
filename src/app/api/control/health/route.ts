import { healthReport } from "@/lib/hostHealth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/control/health -> { host, services, checks, clear, total, status }
// Measured at request time (a 400 ms CPU sample, loopback-only service probes).
export async function GET() {
  try {
    return Response.json(await healthReport(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message ?? e) }, { status: 500 });
  }
}
