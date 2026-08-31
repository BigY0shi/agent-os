import { NextResponse } from "next/server";
import { listCampaigns, readCampaign, writeCampaign, exileCampaign, slugify, BUSINESSES, CHANNELS, type Campaign, type Business, type Channel } from "@/lib/marketing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET → all campaigns (newest first). POST → create ({title, business, goal, angle?,
// channels[]}) or remove ({action:"exile", slug}) — removal exiles the file, never deletes.
export async function GET() {
  return NextResponse.json({ ok: true, campaigns: await listCampaigns() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  if (body.action === "exile") {
    const ok = await exileCampaign(String(body.slug || ""));
    return ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ ok: false, error: "Campaign not found." }, { status: 404 });
  }

  const title = String(body.title || "").trim().slice(0, 120);
  const goal = String(body.goal || "").trim().slice(0, 800);
  const angle = String(body.angle || "").trim().slice(0, 800);
  const business = String(body.business || "") as Business;
  const channels = (Array.isArray(body.channels) ? body.channels : []).filter(
    (ch: string): ch is Channel => CHANNELS.some((c) => c.id === ch)
  );
  if (!title || !goal) return NextResponse.json({ ok: false, error: "Give the campaign a title and a goal." }, { status: 400 });
  if (!BUSINESSES.some((b) => b.id === business)) return NextResponse.json({ ok: false, error: "Pick a business." }, { status: 400 });
  if (!channels.length) return NextResponse.json({ ok: false, error: "Pick at least one channel." }, { status: 400 });

  let slug = slugify(title);
  if (await readCampaign(slug)) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  const campaign: Campaign = {
    slug, title, business, goal, angle: angle || undefined, channels,
    status: "draft", items: [], created: new Date().toISOString(),
  };
  await writeCampaign(campaign);
  return NextResponse.json({ ok: true, campaign });
}
