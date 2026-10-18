import { readFleetStats } from "@/lib/v2/fleetStats/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v2/home/fleet-stats -> S36 fleet stats for the Mission Control cockpit:
//   buckets   you vs agents per bucket (fleetStats.bucketHours, default 12 h) over the
//             window (fleetStats.windowDays, default 14), aligned to local midnight
//   heat      weekday x hour in tasks.timezone
//   handoffs  the latest mission hand-offs between agents
//   sessions  per-source counts, last 24 h and total; an unrecorded source is tracked:false
// Settings are read on every request (lib/settings.ts), so a gear change re-buckets
// with no rebuild. Every number is counted from a stored record; see lib/v2/fleetStats.
export async function GET() {
  try {
    const stats = await readFleetStats();
    return Response.json(stats, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message ?? e) }, { status: 500 });
  }
}
