import { NextRequest, NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { getDb } from "@/lib/v2/db";
import { StatementAspects } from "@/lib/v2/memory/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

function count(sql: string, ...args: unknown[]): number {
  return (getDb().prepare(sql).get(...args) as { c: number }).c;
}

// ── Additive ?facet=aspects support (SPEC-A A8.3 AspectExplorer) ─────────────
// The graph/voice split is load-bearing (SPEC §8.6): the two stores are queried
// SEPARATELY, never blended. Base GET (no params) is unchanged.

interface AspectCountRow {
  aspect: string;
  current: number;
  invalidated: number;
}

function aspectCounts(table: "statements" | "voice_aspects"): AspectCountRow[] {
  return getDb()
    .prepare(
      `SELECT aspect,
              SUM(CASE WHEN invalid_at IS NULL THEN 1 ELSE 0 END) AS current,
              SUM(CASE WHEN invalid_at IS NOT NULL THEN 1 ELSE 0 END) AS invalidated
       FROM ${table} GROUP BY aspect`,
    )
    .all() as AspectCountRow[];
}

const KNOWN_ASPECTS = new Set<string>(StatementAspects);

/**
 * GET /api/v2/memory/stats (SPEC-A §5.2) — page-header strip + golden dashboards.
 * {episodes, statements, entities, voiceAspects, labels, invalidated,
 *  queueDepth, lastIngestAt}
 *
 * Additive: ?facet=aspects → {graph: AspectCountRow[], voice: AspectCountRow[]}
 * Additive: ?facet=aspects&aspect=<Aspect>&store=graph|voice&limit= →
 *   {facts: {uuid, fact, aspect, validAt, invalidAt}[]} (valid_at DESC)
 */
export async function GET(req?: NextRequest) {
  ensureV2();
  const db = getDb();

  // req is optional so existing direct-import smokes calling GET() keep working.
  const sp = req?.nextUrl?.searchParams ?? new URLSearchParams();
  if (sp.get("facet") === "aspects") {
    const aspect = sp.get("aspect");
    const store = sp.get("store");
    if (aspect && (store === "graph" || store === "voice")) {
      if (!KNOWN_ASPECTS.has(aspect)) {
        return NextResponse.json({ error: "unknown aspect" }, { status: 400, ...noStore });
      }
      const limitRaw = parseInt(sp.get("limit") ?? "", 10);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;
      const table = store === "graph" ? "statements" : "voice_aspects";
      const rows = db
        .prepare(
          `SELECT uuid, fact, aspect, valid_at, invalid_at FROM ${table}
           WHERE aspect = ? ORDER BY valid_at DESC LIMIT ?`,
        )
        .all(aspect, limit) as {
        uuid: string;
        fact: string;
        aspect: string;
        valid_at: string;
        invalid_at: string | null;
      }[];
      return NextResponse.json(
        {
          facts: rows.map((r) => ({
            uuid: r.uuid,
            fact: r.fact,
            aspect: r.aspect,
            validAt: r.valid_at,
            invalidAt: r.invalid_at,
          })),
        },
        noStore,
      );
    }
    return NextResponse.json(
      { graph: aspectCounts("statements"), voice: aspectCounts("voice_aspects") },
      noStore,
    );
  }
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
