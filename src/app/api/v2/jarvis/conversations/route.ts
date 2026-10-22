import { NextResponse, type NextRequest } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { listConversations, searchConversations, sessionCounts, type SessionScope } from "@/lib/v2/jarvis/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/**
 * SPEC-C C3.6 — GET /api/v2/jarvis/conversations?limit=&includeArchived=1
 * → { conversations: [{ id, title, channel, updatedAt, messageCount, ... }] }
 * newest first (updated_at DESC). Archived rows excluded by default.
 *
 * S13 Sessions (2026-09-28): `?q=` searches titles and message bodies, `?scope=`
 * live | archived | all, and the reply adds `counts` { live, archived, messages }.
 * A request with neither q nor scope keeps the original C3.6 contract exactly.
 */
export async function GET(req: NextRequest) {
  ensureV2();
  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? "");
  const includeArchived = req.nextUrl.searchParams.get("includeArchived") === "1";
  const q = req.nextUrl.searchParams.get("q");
  const scopeRaw = req.nextUrl.searchParams.get("scope");
  if (q !== null || scopeRaw !== null) {
    const scopes: SessionScope[] = ["live", "archived", "all"];
    if (scopeRaw !== null && !scopes.includes(scopeRaw as SessionScope)) {
      return NextResponse.json({ error: `scope must be one of ${scopes.join(", ")}` }, { status: 400, ...noStore });
    }
    const conversations = searchConversations(q ?? "", {
      scope: (scopeRaw as SessionScope | null) ?? "live",
      limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 100,
    });
    return NextResponse.json({ conversations, counts: sessionCounts() }, noStore);
  }
  const conversations = listConversations(
    Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50,
    { includeArchived },
  );
  return NextResponse.json({ conversations }, noStore);
}
