import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { listConversations } from "@/lib/v2/jarvis/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/**
 * SPEC-C C3.6 — GET /api/v2/jarvis/conversations?limit=&includeArchived=1
 * → { conversations: [{ id, title, channel, updatedAt, messageCount, ... }] }
 * newest first (updated_at DESC). Archived rows excluded by default.
 */
export async function GET(req: NextRequest) {
  ensureV2();
  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? "");
  const includeArchived = req.nextUrl.searchParams.get("includeArchived") === "1";
  const conversations = listConversations(
    Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50,
    { includeArchived },
  );
  return NextResponse.json({ conversations }, noStore);
}
