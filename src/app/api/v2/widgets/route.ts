import { NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { WIDGETS } from "@/lib/v2/widgets/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/** SPEC-D §5.8 — GET /api/v2/widgets → { widgets } (registry metadata for the picker). */
export async function GET() {
  ensureV2();
  return NextResponse.json({ widgets: WIDGETS }, noStore);
}
