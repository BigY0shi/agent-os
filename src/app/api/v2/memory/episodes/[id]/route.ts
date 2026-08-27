import { NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { getDb } from "@/lib/v2/db";
import { getEpisode, getStatementsForEpisode } from "@/lib/v2/memory/graph";
import { exileEpisodeCascade } from "@/lib/v2/memory/exile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/** uuid-ish guard (repo safeId pattern for [id] routes). */
function safeUuid(raw: string | undefined): string | null {
  if (!raw) return null;
  return /^[0-9a-fA-F-]{8,64}$/.test(raw) ? raw : null;
}

/**
 * GET /api/v2/memory/episodes/[id] (SPEC-A §5.2)
 * → {episode, statements[], voiceAspects[], labels[], compact?}
 * Statements include invalidated ones (EpisodeDetail renders
 * "currently X — previously Y").
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  ensureV2();
  const id = safeUuid((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "bad id" }, { status: 400, ...noStore });

  const episode = getEpisode(id);
  if (!episode) return NextResponse.json({ error: "not found" }, { status: 404, ...noStore });

  const db = getDb();
  const statements = getStatementsForEpisode(id, { includeInvalidated: true }).map((s) => ({
    uuid: s.uuid,
    fact: s.fact,
    aspect: s.aspect,
    validAt: s.validAt,
    invalidAt: s.invalidAt,
    invalidatedBy: s.invalidatedBy,
  }));

  const voiceAspects = (
    db
      .prepare("SELECT * FROM voice_aspects WHERE episode_uuids LIKE ?")
      .all(`%${id}%`) as {
      uuid: string;
      fact: string;
      aspect: string;
      episode_uuids: string;
      valid_at: string;
      invalid_at: string | null;
      invalidated_by: string | null;
    }[]
  )
    .filter((r) => {
      try {
        return (JSON.parse(r.episode_uuids) as string[]).includes(id);
      } catch {
        return false;
      }
    })
    .map((r) => ({
      uuid: r.uuid,
      fact: r.fact,
      aspect: r.aspect,
      validAt: r.valid_at,
      invalidAt: r.invalid_at,
      invalidatedBy: r.invalidated_by,
    }));

  const labels =
    episode.labelIds.length > 0
      ? (db
          .prepare(
            `SELECT id, name, description, color FROM labels
             WHERE id IN (${episode.labelIds.map(() => "?").join(",")})`,
          )
          .all(...episode.labelIds) as {
          id: string;
          name: string;
          description: string | null;
          color: string;
        }[])
      : [];

  const compactRow = db
    .prepare(
      "SELECT id, title, content, updated_at FROM documents WHERE type = 'conversation' AND session_id = ?",
    )
    .get(episode.sessionId) as
    | { id: string; title: string; content: string; updated_at: string }
    | undefined;
  const compact = compactRow
    ? {
        id: compactRow.id,
        title: compactRow.title,
        content: compactRow.content,
        updatedAt: compactRow.updated_at,
      }
    : undefined;

  return NextResponse.json({ episode, statements, voiceAspects, labels, compact }, noStore);
}

/**
 * DELETE /api/v2/memory/episodes/[id] — cascade-EXILE per SPEC-A A8.5: the
 * full bundle is exported to ~/.agentic-os/.exile/memory/<stamp>-<uuid>.json
 * and verified on disk BEFORE any row is removed (see lib/v2/memory/exile.ts).
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  ensureV2();
  const id = safeUuid((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "bad id" }, { status: 400, ...noStore });

  try {
    const result = exileEpisodeCascade(id);
    return NextResponse.json(result, noStore);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status, ...noStore });
  }
}
