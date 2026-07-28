import { readEngine, writeEngine, planPrompt, CHANNELS, type Channel, type ContentItem } from "@/lib/contentEngine";
import { cliComplete } from "@/lib/loopEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// POST { goals, channels, perWeek, weeks } → Claude drafts the calendar.
// Existing non-posted "planned" items from a previous plan are replaced;
// drafted/posted/skipped items are kept — a replan must never eat real work.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as
    { goals?: string; channels?: string[]; perWeek?: number; weeks?: number };
  const goals = body.goals?.trim();
  const channels = (body.channels || []).filter((c): c is Channel => (CHANNELS as readonly string[]).includes(c));
  const perWeek = Math.min(21, Math.max(1, body.perWeek ?? 5));
  const weeks = Math.min(8, Math.max(1, body.weeks ?? 2));
  if (!goals) return Response.json({ ok: false, error: "goals required" }, { status: 400 });
  if (!channels.length) return Response.json({ ok: false, error: "pick at least one channel" }, { status: 400 });

  const startISO = new Date().toISOString().slice(0, 10);
  try {
    const out = await cliComplete("claude", planPrompt(goals, channels, perWeek, weeks, startISO), { timeoutMs: 300_000 });
    const m = out.match(/\[[\s\S]*\]/);
    if (!m) return Response.json({ ok: false, error: "planner did not return JSON" }, { status: 502 });
    let rows: { date?: string; channel?: string; format?: string; topic?: string; hook?: string }[];
    try { rows = JSON.parse(m[0]); } catch { return Response.json({ ok: false, error: "malformed JSON from planner" }, { status: 502 }); }

    const items: ContentItem[] = rows
      .filter((r) => r.date && r.topic && (CHANNELS as readonly string[]).includes(r.channel || ""))
      .map((r, i) => ({
        id: `ce-${Date.now().toString(36)}-${i}`,
        date: r.date as string,
        channel: r.channel as Channel,
        format: r.format || "post",
        topic: r.topic as string,
        hook: r.hook || "",
        status: "planned" as const,
        materials: null, postedUrl: null, metrics: null, notes: "",
        updatedAt: Date.now(),
      }));
    if (!items.length) return Response.json({ ok: false, error: "planner returned no usable slots" }, { status: 502 });

    const state = await readEngine();
    const kept = state.items.filter((it) => it.status !== "planned");
    state.items = [...kept, ...items].sort((a, b) => a.date.localeCompare(b.date));
    state.plan = { goals, channels, perWeek, weeks, at: Date.now() };
    await writeEngine(state);
    return Response.json({ ok: true, added: items.length, kept: kept.length });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
