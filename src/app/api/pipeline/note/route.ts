import { NextResponse } from "next/server";
import { readItem, writeItem } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Save the user's own notes on a pipeline item (persisted to the vault markdown).
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const slug = String(body.slug || "");
  const notes = String(body.notes ?? "").slice(0, 4000).trim();
  const item = await readItem(slug);
  if (!item) return NextResponse.json({ ok: false, error: "Item not found." }, { status: 404 });
  item.notes = notes;
  await writeItem(item);
  return NextResponse.json({ ok: true, item });
}
