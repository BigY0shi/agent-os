import { patchItem, readEngine, writeEngine, insightsPrompt, multiModelComplete, type ItemStatus, type Metrics } from "@/lib/contentEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const STATUSES: ItemStatus[] = ["planned", "drafted", "posted", "skipped"];

// POST { action, id?, value? }
//   status   — value: planned|drafted|posted|skipped
//   copy     — value: edited post copy (kept in materials.copy)
//   notes    — value: string
//   postedUrl— value: string
//   metrics  — value: { views?, likes?, comments?, shares?, clicks? }
//   remove   — drop the item from the calendar entirely
//   insights — no id: run the AI performance read over everything posted
export async function POST(req: Request) {
  const { action, id, value } = await req.json().catch(() => ({})) as
    { action?: string; id?: string; value?: unknown };

  try {
    if (action === "insights") {
      const state = await readEngine();
      // Cross-lineage check: codex grades the content so the model reading the
      // numbers is never the one that planned the calendar (claude fallback).
      const { text, by } = await multiModelComplete("codex", insightsPrompt(state));
      if (!text.trim()) return Response.json({ ok: false, error: "analyst returned nothing" }, { status: 502 });
      state.insights = { text: text.trim(), at: Date.now(), by };
      await writeEngine(state);
      return Response.json({ ok: true, insights: state.insights });
    }

    if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });

    if (action === "remove") {
      const state = await readEngine();
      const before = state.items.length;
      state.items = state.items.filter((i) => i.id !== id);
      if (state.items.length === before) return Response.json({ ok: false, error: "item not found" }, { status: 404 });
      await writeEngine(state);
      return Response.json({ ok: true });
    }

    const item = await patchItem(id, (it) => {
      if (action === "status" && STATUSES.includes(value as ItemStatus)) return { ...it, status: value as ItemStatus };
      if (action === "copy") return { ...it, materials: { ...(it.materials || {}), copy: String(value ?? "").slice(0, 20_000), at: Date.now() } };
      if (action === "notes") return { ...it, notes: String(value ?? "").slice(0, 5000) };
      if (action === "postedUrl") return { ...it, postedUrl: String(value ?? "").slice(0, 500) || null };
      if (action === "metrics") {
        const v = (value ?? {}) as Record<string, unknown>;
        const num = (x: unknown) => (x === "" || x == null || Number.isNaN(Number(x)) ? undefined : Number(x));
        const metrics: Metrics = {
          views: num(v.views), likes: num(v.likes), comments: num(v.comments),
          shares: num(v.shares), clicks: num(v.clicks), at: Date.now(),
        };
        return { ...it, metrics };
      }
      throw new Error(`unknown action "${action}"`);
    });
    if (!item) return Response.json({ ok: false, error: "item not found" }, { status: 404 });
    return Response.json({ ok: true, item });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
