import { NextResponse } from "next/server";
import { readItem, writeItem, revisePlan } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Human Gate: the user calls an agent in to tweak the proposed plan, then can iterate
// again or approve. Stays in the review stage so it never auto-advances.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const slug = String(body.slug || "");
  const feedback = String(body.feedback || "").trim();
  const agent = body.agent ? String(body.agent) : undefined;
  if (!feedback) return NextResponse.json({ ok: false, error: "Say what you'd like changed." }, { status: 400 });

  const item = await readItem(slug);
  if (!item) return NextResponse.json({ ok: false, error: "Item not found." }, { status: 404 });

  try {
    item.plan = await revisePlan(item, feedback, agent, req.signal);
    item.stage = "review";
    await writeItem(item);
    return NextResponse.json({ ok: true, item });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e).slice(0, 200) }, { status: 502 });
  }
}
