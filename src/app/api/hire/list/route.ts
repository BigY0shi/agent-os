import { listHireLeads, machineCounts } from "@/lib/hireDesk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/hire/list → every candidate + per-machine counts for the portfolio strip.
export async function GET() {
  const [leads, counts] = await Promise.all([listHireLeads(), machineCounts()]);
  return Response.json({ ok: true, leads, counts });
}
