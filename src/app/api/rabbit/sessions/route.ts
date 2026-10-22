// Rabbit R1 bridge — GET list of sessions (+ counts + in-flight turns),
// POST { action: "archiveIdle", days } bulk-archive. Cookie-gated (proxy).
import { NextRequest, NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { archiveIdle, countSessions, listSessions, type SessionFilter } from "@/lib/v2/rabbit/store";
import { liveTurns } from "@/lib/v2/rabbit/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

function isFilter(s: string | null): s is SessionFilter {
  return s === "active" || s === "archived" || s === "all";
}

/** GET /api/rabbit/sessions?status=active|archived|all&q=&limit= */
export async function GET(req: NextRequest) {
  ensureV2();
  try {
    const sp = req.nextUrl.searchParams;
    const status = sp.get("status");
    const limitParam = sp.get("limit");
    const sessions = listSessions({
      status: isFilter(status) ? status : "active",
      q: sp.get("q") || undefined,
      limit: limitParam ? Number(limitParam) : undefined,
    });
    return NextResponse.json({ sessions, counts: countSessions(), live: liveTurns() }, noStore);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500, ...noStore });
  }
}

/** POST /api/rabbit/sessions { action: "archiveIdle", days } */
export async function POST(req: NextRequest) {
  ensureV2();
  let body: { action?: unknown; days?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400, ...noStore }); }
  if (body.action !== "archiveIdle") {
    return NextResponse.json({ error: 'Unknown action — expected { action: "archiveIdle", days }.' }, { status: 400, ...noStore });
  }
  const days = typeof body.days === "number" && Number.isFinite(body.days) ? Math.max(0, body.days) : 30;
  try {
    return NextResponse.json({ ok: true, archived: archiveIdle(days), days }, noStore);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500, ...noStore });
  }
}
