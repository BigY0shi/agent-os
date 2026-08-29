import { NextRequest, NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { getDb } from "@/lib/v2/db";
import { getEntities } from "@/lib/v2/memory/graph";
import { getEmbedding } from "@/lib/v2/memory/embed";
import { search as vectorSearch } from "@/lib/v2/memory/vector";
import { ENTITY_HINT_THRESHOLD } from "@/lib/v2/memory/constants";
import type { EntityNode } from "@/lib/v2/memory/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * GET /api/v2/memory/entities (SPEC-A §5.2)
 * ?q=&type=&limit= → {entities[]}. `q` combines entity-ns vector search
 * (threshold 0.65) with a name LIKE; the vector leg degrades gracefully when
 * the embedder is unreachable (LIKE-only, warn).
 */
export async function GET(req: NextRequest) {
  ensureV2();
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q")?.trim() || "";
  const type = sp.get("type")?.trim() || "";
  const limitRaw = parseInt(sp.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const db = getDb();
  let entities: EntityNode[];

  if (q) {
    // Name LIKE leg
    const likeUuids = (
      db
        .prepare(
          "SELECT uuid FROM entities WHERE name LIKE ? COLLATE NOCASE ORDER BY name LIMIT ?",
        )
        .all(`%${q}%`, limit) as { uuid: string }[]
    ).map((r) => r.uuid);

    // Vector leg (0.65) — best-effort
    let vectorUuids: string[] = [];
    try {
      const emb = await getEmbedding(q);
      vectorUuids = vectorSearch("entity", emb, {
        limit,
        threshold: ENTITY_HINT_THRESHOLD,
      }).map((h) => h.uuid);
    } catch (err) {
      console.warn(
        "[v2/memory/entities] vector search unavailable (LIKE-only):",
        err instanceof Error ? err.message : err,
      );
    }

    const ordered = [...likeUuids, ...vectorUuids.filter((u) => !likeUuids.includes(u))];
    const byUuid = new Map(getEntities(ordered).map((e) => [e.uuid, e]));
    entities = ordered
      .map((u) => byUuid.get(u))
      .filter((e): e is EntityNode => !!e)
      .slice(0, limit);
  } else {
    const uuids = (
      db
        .prepare("SELECT uuid FROM entities ORDER BY name COLLATE NOCASE LIMIT ?")
        .all(limit) as { uuid: string }[]
    ).map((r) => r.uuid);
    entities = getEntities(uuids);
  }

  if (type) entities = entities.filter((e) => e.type === type);

  return NextResponse.json({ entities }, noStore);
}
