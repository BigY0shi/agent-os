import { NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import {
  getEntity,
  getEpisodes,
  getEpisodeUuidsForStatement,
  getStatementsForEntity,
} from "@/lib/v2/memory/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

function safeUuid(raw: string | undefined): string | null {
  if (!raw) return null;
  return /^[0-9a-fA-F-]{8,64}$/.test(raw) ? raw : null;
}

/**
 * GET /api/v2/memory/entities/[id] (SPEC-A §5.2)
 * → {entity, statements[], episodes[]}. Statements include invalidated ones
 * (EntityBrowser strikes them through); episodes are the provenance episodes
 * of those statements, newest-first.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  ensureV2();
  const id = safeUuid((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "bad id" }, { status: 400, ...noStore });

  const entity = getEntity(id);
  if (!entity) return NextResponse.json({ error: "not found" }, { status: 404, ...noStore });

  const statements = getStatementsForEntity(id, { includeInvalidated: true });

  const episodeUuids = new Set<string>();
  for (const st of statements) {
    for (const epUuid of getEpisodeUuidsForStatement(st.uuid)) episodeUuids.add(epUuid);
  }
  const episodes = getEpisodes([...episodeUuids]).sort((a, b) =>
    a.validAt < b.validAt ? 1 : -1,
  );

  return NextResponse.json({ entity, statements, episodes }, noStore);
}
