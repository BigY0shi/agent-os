import { NextRequest, NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { getDb } from "@/lib/v2/db";
import { getEpisodes } from "@/lib/v2/memory/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * GET /api/v2/memory/episodes (SPEC-A §5.2)
 * ?label=&sessionId=&endUserId=&agentId=&from=&to=&q=&limit=&offset=
 * → {episodes, total}. `q` is a simple text LIKE over content/original_content.
 */
export async function GET(req: NextRequest) {
  ensureV2();
  const sp = req.nextUrl.searchParams;

  const where: string[] = [];
  const args: unknown[] = [];

  const label = sp.get("label");
  if (label) {
    where.push(
      "e.uuid IN (SELECT episode_uuid FROM episode_labels WHERE label_id = ?)",
    );
    args.push(label);
  }
  const sessionId = sp.get("sessionId");
  if (sessionId) {
    where.push("e.session_id = ?");
    args.push(sessionId);
  }
  const endUserId = sp.get("endUserId");
  if (endUserId) {
    where.push("e.end_user_id = ?");
    args.push(endUserId);
  }
  const agentId = sp.get("agentId");
  if (agentId) {
    where.push("e.agent_id = ?");
    args.push(agentId);
  }
  const source = sp.get("source");
  if (source) {
    where.push("e.source = ?");
    args.push(source);
  }
  const from = sp.get("from");
  if (from) {
    where.push("e.valid_at >= ?");
    args.push(from);
  }
  const to = sp.get("to");
  if (to) {
    where.push("e.valid_at <= ?");
    args.push(to);
  }
  const q = sp.get("q");
  if (q) {
    where.push("(e.content LIKE ? OR e.original_content LIKE ?)");
    const like = `%${q}%`;
    args.push(like, like);
  }

  const limitRaw = parseInt(sp.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;
  const offsetRaw = parseInt(sp.get("offset") ?? "", 10);
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const db = getDb();
  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM episodes e ${whereSql}`).get(...args) as {
      c: number;
    }
  ).c;
  const uuids = (
    db
      .prepare(
        `SELECT e.uuid FROM episodes e ${whereSql}
         ORDER BY e.valid_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset) as { uuid: string }[]
  ).map((r) => r.uuid);

  // getEpisodes preserves labelIds; re-apply the valid_at DESC ordering.
  const byUuid = new Map(getEpisodes(uuids).map((e) => [e.uuid, e]));
  const episodes = uuids.map((u) => byUuid.get(u)).filter(Boolean);

  return NextResponse.json({ episodes, total }, noStore);
}
