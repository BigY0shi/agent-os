import { NextRequest, NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { getDb } from "@/lib/v2/db";
import { createLabel, listLabels, updateLabel } from "@/lib/v2/memory/labels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

/** GET /api/v2/memory/labels — all labels + per-label episode counts. */
export async function GET() {
  ensureV2();
  const counts = new Map(
    (
      getDb()
        .prepare(
          "SELECT label_id, COUNT(*) AS c FROM episode_labels GROUP BY label_id",
        )
        .all() as { label_id: string; c: number }[]
    ).map((r) => [r.label_id, r.c]),
  );
  const labels = listLabels().map((l) => ({ ...l, episodeCount: counts.get(l.id) ?? 0 }));
  return NextResponse.json({ labels }, noStore);
}

/** POST /api/v2/memory/labels — {name, description?, color?} → label row. */
export async function POST(req: NextRequest) {
  ensureV2();
  try {
    const body = (await req.json()) as {
      name?: string;
      description?: string | null;
      color?: string;
    };
    if (!body?.name || !body.name.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400, ...noStore });
    }
    const label = await createLabel({
      name: body.name,
      description: body.description ?? null,
      color: body.color,
    });
    return NextResponse.json({ label }, { status: 201, ...noStore });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400, ...noStore },
    );
  }
}

/** PATCH /api/v2/memory/labels — {id, name?, description?, color?} → label row. */
export async function PATCH(req: NextRequest) {
  ensureV2();
  try {
    const body = (await req.json()) as {
      id?: string;
      name?: string;
      description?: string | null;
      color?: string;
    };
    if (!body?.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400, ...noStore });
    }
    const label = await updateLabel(body.id, {
      name: body.name,
      description: body.description,
      color: body.color,
    });
    return NextResponse.json({ label }, noStore);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message },
      { status: message.includes("not found") ? 404 : 400, ...noStore },
    );
  }
}
