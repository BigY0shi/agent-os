import { getDeal, setBrief } from "@/lib/upworkDesk";
import { generateBrief } from "@/lib/dealBrief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// POST { id } → generate the analysis block (summary / why / approach / crash course)
// for ONE deal. See ../brief-batch for the bulk path, and lib/dealBrief.ts for why
// feed leads need this at all.
export async function POST(req: Request) {
  const { id } = await req.json().catch(() => ({})) as { id?: string };
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });

  const deal = await getDeal(id);
  if (!deal) return Response.json({ ok: false, error: "deal not found" }, { status: 404 });

  try {
    const brief = await generateBrief(deal);
    if (!brief) return Response.json({ ok: false, error: "the agent returned no usable brief" }, { status: 502 });
    await setBrief(id, brief);
    return Response.json({ ok: true, brief });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
