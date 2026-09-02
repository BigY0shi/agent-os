import { readEngine, writeEngine, planPrompt, CHANNELS, type Channel, type ContentItem } from "@/lib/contentEngine";
import { cliComplete } from "@/lib/loopEngine";
import { startModuleRun } from "@/lib/moduleRuns";

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
  // Registered as a module run (roadmap S2) so a plan keeps building after the
  // owner navigates away; the tray shows it and the calendar fills in.
  const run = startModuleRun(
    { module: "content-engine", label: `Plan calendar: ${weeks}w x ${perWeek}/wk, ${channels.join(", ")}`, href: "/content-engine" },
    async (ctx) => {
    ctx.log("asking claude for the calendar");
    const out = await cliComplete("claude", planPrompt(goals, channels, perWeek, weeks, startISO), { timeoutMs: 300_000 });
    const m = out.match(/\[[\s\S]*\]/);
    if (!m) throw new Error("planner did not return JSON");
    let rows: { date?: string; channel?: string; format?: string; topic?: string; hook?: string }[];
    try { rows = JSON.parse(m[0]); } catch { throw new Error("malformed JSON from planner"); }

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
    if (!items.length) throw new Error("planner returned no usable slots");

    const state = await readEngine();
    const kept = state.items.filter((it) => it.status !== "planned");
    state.items = [...kept, ...items].sort((a, b) => a.date.localeCompare(b.date));
    state.plan = { goals, channels, perWeek, weeks, at: Date.now() };
    await writeEngine(state);
    ctx.log(`${items.length} slots added, ${kept.length} kept`);
    return { added: items.length, kept: kept.length };
    },
    { summarize: (r) => r },
  );
  try {
    const r = await run.promise;
    return Response.json({ ok: true, ...r, runId: run.id });
  } catch (e) {
    const msg = (e as Error).message;
    const status = /did not return JSON|malformed JSON|no usable slots/.test(msg) ? 502 : 500;
    return Response.json({ ok: false, error: msg, runId: run.id }, { status });
  }
}
