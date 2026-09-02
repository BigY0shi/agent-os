import { readEngine, patchItem, materialsPrompt, seatForItem, multiModelComplete } from "@/lib/contentEngine";
import { startModuleRun } from "@/lib/moduleRuns";

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

  // The generation is registered as a module run (roadmap S2): if the owner
  // leaves this page, the work continues, the tray shows it, and the drafted
  // materials are there when they come back. This handler still awaits the
  // same promise so the drawer gets its answer as before.
  const run = startModuleRun(
    { module: "content-engine", label: `Generate materials: ${item.topic}`, href: "/content-engine" },
    async (ctx) => {
      ctx.log(`seat ${seatForItem(id)}`);
      const { text: out, by } = await multiModelComplete(seatForItem(id), materialsPrompt(item, state.plan?.goals ?? ""));
      ctx.log(`written by ${by}`);
      const m = out.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("generator did not return JSON");
      let parsed: Record<string, unknown>;
      try { parsed = JSON.parse(m[0]); } catch { throw new Error("malformed JSON from generator"); }
      const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
      const materials = {
        copy: str(parsed.copy), hashtags: str(parsed.hashtags),
        imagePrompt: str(parsed.imagePrompt), videoScript: str(parsed.videoScript),
        by, at: Date.now(),
      };
      if (!materials.copy) throw new Error("generator returned no copy");
      const updated = await patchItem(id, (it) => ({
        ...it, materials, status: it.status === "planned" ? "drafted" : it.status,
      }));
      if (!updated) throw new Error("item vanished while its materials were being written");
      ctx.log("materials saved; item drafted");
      return updated;
    },
    { summarize: (it) => ({ id: it.id, status: it.status, by: it.materials?.by ?? null }) },
  );
  try {
    const updated = await run.promise;
    return Response.json({ ok: true, item: updated, runId: run.id });
  } catch (e) {
    const msg = (e as Error).message;
    const status = /did not return JSON|malformed JSON|returned no copy/.test(msg) ? 502 : 500;
    return Response.json({ ok: false, error: msg, runId: run.id }, { status });
  }
}
