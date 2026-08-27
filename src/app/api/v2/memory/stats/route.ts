import { NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { getDb } from "@/lib/v2/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

function count(sql: string, ...args: unknown[]): number {
  return (getDb().prepare(sql).get(...args) as { c: number }).c;
}

/**
 * GET /api/v2/memory/stats (SPEC-A §5.2) — page-header strip + golden dashboards.
 * {episodes, statements, entities, voiceAspects, labels, invalidated,
 *  queueDepth, lastIngestAt}
 */
export async function GET() {
  ensureV2();
  const db = getDb();
  const lastIngestRow = db
    .prepare(
      "SELECT MAX(processed_at) AS t FROM ingestion_queue WHERE status = 'COMPLETED'",
    )
    .get() as { t: string | null };

  return NextResponse.json(
    {
      episodes: count("SELECT COUNT(*) AS c FROM episodes"),
      statements: count("SELECT COUNT(*) AS c FROM statements"),
      entities: count("SELECT COUNT(*) AS c FROM entities"),
      voiceAspects: count("SELECT COUNT(*) AS c FROM voice_aspects"),
      labels: count("SELECT COUNT(*) AS c FROM labels"),
      // Invalidated across BOTH stores (the graph/voice split is load-bearing).
      invalidated:
        count("SELECT COUNT(*) AS c FROM statements WHERE invalid_at IS NOT NULL") +
        count("SELECT COUNT(*) AS c FROM voice_aspects WHERE invalid_at IS NOT NULL"),
      queueDepth: count(
        "SELECT COUNT(*) AS c FROM ingestion_queue WHERE status IN ('PENDING','PROCESSING')",
      ),
      lastIngestAt: lastIngestRow.t,
    },
    noStore,
  );
}
