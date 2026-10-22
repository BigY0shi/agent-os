// Rabbit R1 Creation — GET /api/rabbit/v1/agentos/sessions?status=
// The handheld's mini dashboard reads the same sessions the /rabbit page shows.
// Proxy-exempt (under /api/rabbit/v1/), so the key is REQUIRED here regardless
// of settings.rabbit.requireKey: this hands out transcripts.
import { NextRequest, NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { rabbitAuthFailure } from "@/lib/v2/rabbit/secret";
import { countSessions, listSessions, type SessionFilter } from "@/lib/v2/rabbit/store";
import { liveTurns } from "@/lib/v2/rabbit/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

export async function GET(req: NextRequest) {
  ensureV2();
  const denied = rabbitAuthFailure(req, true);
  if (denied) return denied;
  const s = req.nextUrl.searchParams.get("status");
  const status: SessionFilter = s === "archived" || s === "all" ? s : "active";
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 30) || 30, 100);
  const sessions = listSessions({ status, limit }).map((x) => ({
    id: x.id, title: x.title, model: x.model, turns: Math.floor(x.messageCount / 2), updatedAt: x.updatedAt, archived: !!x.archivedAt,
  }));
  return NextResponse.json({ sessions, counts: countSessions(), live: liveTurns().map((t) => ({ sessionId: t.sessionId, model: t.model, preview: t.preview, startedAt: t.startedAt })) }, noStore);
}
