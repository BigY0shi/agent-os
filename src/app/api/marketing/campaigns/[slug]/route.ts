import { NextResponse } from "next/server";
import { readCampaign } from "@/lib/marketing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SPEC-F J1.1 — GET one campaign by slug. The existing collection route has no
// by-slug GET, so the detail page needs this.
//
// readCampaign already rejects anything outside /^[a-z0-9-]+$/ and returns null
// rather than throwing, so a traversal attempt and a genuine miss both land on
// the same honest 404 instead of leaking whether a path exists.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const campaign = await readCampaign(slug);
  if (!campaign) {
    return NextResponse.json({ ok: false, error: "Campaign not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, campaign });
}
