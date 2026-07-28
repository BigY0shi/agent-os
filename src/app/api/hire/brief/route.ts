import { getHireLead, setHireBrief } from "@/lib/hireDesk";
import { generateHireBrief } from "@/lib/hireBrief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// POST { id } → generate the analysis block (summary / why / approach / crash course)
// for ONE hire lead. Generation lives in lib/hireBrief.ts, shared with the batch
// pass (lib/hireBatch.ts) that runs automatically after a scan — this route is the
// drawer's "re-do this one now" button.
export async function POST(req: Request) {
  const { id } = await req.json().catch(() => ({})) as { id?: string };
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });

  const lead = await getHireLead(id);
  if (!lead) return Response.json({ ok: false, error: "lead not found" }, { status: 404 });

  try {
    const brief = await generateHireBrief(lead);
    if ("error" in brief) return Response.json({ ok: false, error: brief.error }, { status: 502 });
    await setHireBrief(id, brief);
    return Response.json({ ok: true, brief });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
