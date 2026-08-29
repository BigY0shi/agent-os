import { NextRequest, NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import {
  MIGRATION_SOURCES,
  runMigration,
  type MigrationSource,
} from "@/lib/v2/memory/migrate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/**
 * POST /api/v2/memory/migrate — A9.2 legacy import (SPEC-A §5.2).
 * Body: {source: 'memsearch'|'jarvis'|'agents'|'remember', dryRun?, full?}
 * → {found, queued, imported, skipped, sample[]}. Raw mode (default) writes
 * verbatim episodes + embeddings + legacy labels with NO LLM calls; the
 * legacy stores themselves are never written.
 */
export async function POST(req: NextRequest) {
  ensureV2();
  let body: { source?: string; dryRun?: boolean; full?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, ...noStore });
  }
  if (!body.source || !MIGRATION_SOURCES.includes(body.source as MigrationSource)) {
    return NextResponse.json(
      { error: `source must be one of: ${MIGRATION_SOURCES.join(", ")}` },
      { status: 400, ...noStore },
    );
  }
  try {
    const result = await runMigration({
      source: body.source as MigrationSource,
      dryRun: body.dryRun === true,
      full: body.full === true,
    });
    return NextResponse.json(result, noStore);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500, ...noStore },
    );
  }
}
