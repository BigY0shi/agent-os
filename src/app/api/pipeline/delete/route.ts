import path from "node:path";
import { NextResponse } from "next/server";
import { readItem, ITEMS_DIR, PIPELINE_DIR, PIPELINE_AVAILABLE } from "@/lib/pipeline";
import { exileFile } from "@/lib/exileFile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Remove from board". Exile, never delete: the item's markdown moves to
// Pipeline/.exile/<timestamp>/items/<slug>.md in the vault, recoverable by moving it back.
export async function POST(req: Request) {
  if (!PIPELINE_AVAILABLE || !PIPELINE_DIR) {
    return NextResponse.json({ ok: false, error: "No Obsidian vault is configured, so there is no Pipeline to remove from." }, { status: 503 });
  }
  const body = await req.json().catch(() => ({}));
  const slug = String(body.slug || "");
  const item = await readItem(slug); // validates the slug shape and that the file exists
  if (!item) return NextResponse.json({ ok: false, error: "Item not found." }, { status: 404 });
  try {
    const dest = await exileFile(path.join(ITEMS_DIR, `${slug}.md`), PIPELINE_DIR);
    if (!dest) return NextResponse.json({ ok: false, error: "Item not found." }, { status: 404 });
    return NextResponse.json({ ok: true, exiledTo: path.relative(PIPELINE_DIR, dest).split(path.sep).join("/") });
  } catch (e) {
    return NextResponse.json({ ok: false, error: `Couldn't exile it: ${String(e).slice(0, 200)}` }, { status: 500 });
  }
}
