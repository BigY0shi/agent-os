import { readEngine, patchItem, materialsPrompt, seatForItem, multiModelComplete } from "@/lib/contentEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// POST { id } → generate the materials (copy / hashtags / image prompt / video
// script) for one calendar slot and mark it drafted.
//
// Multi-model mandate: the seat rotates per item across lineages (codex / kimi /
// claude) so Claude is never the only model producing content; the artifact
// records which model actually wrote it.
export async function POST(req: Request) {
  const { id } = await req.json().catch(() => ({})) as { id?: string };
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });

  const state = await readEngine();
  const item = state.items.find((i) => i.id === id);
  if (!item) return Response.json({ ok: false, error: "item not found" }, { status: 404 });

  try {
    const { text: out, by } = await multiModelComplete(seatForItem(id), materialsPrompt(item, state.plan?.goals ?? ""));
    const m = out.match(/\{[\s\S]*\}/);
    if (!m) return Response.json({ ok: false, error: "generator did not return JSON" }, { status: 502 });
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(m[0]); } catch { return Response.json({ ok: false, error: "malformed JSON from generator" }, { status: 502 }); }
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
    const materials = {
      copy: str(parsed.copy), hashtags: str(parsed.hashtags),
      imagePrompt: str(parsed.imagePrompt), videoScript: str(parsed.videoScript),
      by, at: Date.now(),
    };
    if (!materials.copy) return Response.json({ ok: false, error: "generator returned no copy" }, { status: 502 });

    const updated = await patchItem(id, (it) => ({
      ...it, materials, status: it.status === "planned" ? "drafted" : it.status,
    }));
    return Response.json({ ok: true, item: updated });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
