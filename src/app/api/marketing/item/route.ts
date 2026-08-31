import { NextResponse } from "next/server";
import { draftItem, setItemStatus } from "@/lib/marketing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST { slug, itemId, action, ... } — everything you can do to one content item.
//   "draft"      (+agent?, feedback?)  → produce/revise with the persona injected;
//                any new draft strips approval (standing rule).
//   "approve" | "unapprove"
//   "schedule"   (+scheduledFor)
//   "published"  (+publishedUrl?)      → manual mark (P1 has no auto-publish)
//   "edit"       (+draft)              → manual edit; also strips approval.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const slug = String(body.slug || "");
  const itemId = String(body.itemId || "");
  const action = String(body.action || "");
  if (!slug || !itemId || !action) return NextResponse.json({ ok: false, error: "missing slug/itemId/action" }, { status: 400 });

  try {
    if (action === "draft") {
      const campaign = await draftItem(slug, itemId, body.agent ? String(body.agent) : undefined, body.feedback ? String(body.feedback) : undefined, req.signal);
      return NextResponse.json({ ok: true, campaign });
    }
    if (action === "approve" || action === "unapprove" || action === "schedule" || action === "published" || action === "edit") {
      const campaign = await setItemStatus(slug, itemId, action, {
        draft: typeof body.draft === "string" ? body.draft : undefined,
        publishedUrl: body.publishedUrl ? String(body.publishedUrl) : undefined,
        scheduledFor: body.scheduledFor ? String(body.scheduledFor) : undefined,
      });
      return NextResponse.json({ ok: true, campaign });
    }
    return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message || e).slice(0, 240) }, { status: 502 });
  }
}
