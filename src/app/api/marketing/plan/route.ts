import { NextResponse } from "next/server";
import { planCampaign } from "@/lib/marketing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST { slug } — run the planning council (lead → critic → revision, per settings)
// and write the plan + dated content calendar onto the campaign.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const slug = String(body.slug || "");
  if (!slug) return NextResponse.json({ ok: false, error: "missing slug" }, { status: 400 });
  try {
    const campaign = await planCampaign(slug, req.signal);
    return NextResponse.json({ ok: true, campaign });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message || e).slice(0, 240) }, { status: 502 });
  }
}
