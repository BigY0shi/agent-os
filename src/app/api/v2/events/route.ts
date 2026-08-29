import { NextRequest, NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { recent } from "@/lib/v2/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  ensureV2();
  const sp = req.nextUrl.searchParams;
  const typesCsv = sp.get("types");
  const events = recent({
    type: sp.get("type") ?? undefined,
    types: typesCsv ? typesCsv.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    since: sp.get("since") ?? undefined,
    limit: sp.get("limit") ? parseInt(sp.get("limit")!, 10) : undefined,
  });
  return NextResponse.json(
    { events },
    { headers: { "cache-control": "no-store" } },
  );
}
