import { readEngine, writeEngine, planPrompt, multiModelComplete, CHANNELS, type Channel, type ContentItem } from "@/lib/contentEngine";
import type { CouncilSeat } from "@/lib/brainstorm";
import { startModuleRun } from "@/lib/moduleRuns";
import { readSettings } from "@/lib/settings";
import { withSkills } from "@/lib/platformSkills";
import { resolveLaunchOptions, launchTimeoutMs, withInstructions, describeLaunch } from "@/lib/launchOptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const MODULE = "content-engine" as const;

// POST { goals, channels, perWeek, weeks, launch? } → the planner seat drafts
// the calendar. Existing non-posted "planned" items from a previous plan are
// replaced; drafted/posted/skipped items are kept — a replan must never eat
// real work.
//
// `launch` (roadmap S3): validated strictly, unknown fields are a 400. Seat
// "rotation" means Claude plans (the manager of the multi-model mandate);
// any other seat plans itself. STOP aborts ctx.signal and the child CLI dies.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as
    { goals?: string; channels?: string[]; perWeek?: number; weeks?: number; launch?: unknown };
  const goals = body.goals?.trim();
  const channels = (body.channels || []).filter((c): c is Channel => (CHANNELS as readonly string[]).includes(c));
  const perWeek = Math.min(21, Math.max(1, body.perWeek ?? 5));
  const weeks = Math.min(8, Math.max(1, body.weeks ?? 2));
  if (!goals) return Response.json({ ok: false, error: "goals required" }, { status: 400 });
  if (!channels.length) return Response.json({ ok: false, error: "pick at least one channel" }, { status: 400 });

  const launch = resolveLaunchOptions(MODULE, body.launch, readSettings().launch?.[MODULE]);
  if (!launch.ok) return Response.json({ ok: false, error: `launch: ${launch.error}` }, { status: 400 });
  const L = launch.value;
  const seat: CouncilSeat = L.agent === "rotation" ? "claude" : (L.agent as CouncilSeat);

  const startISO = new Date().toISOString().slice(0, 10);
  // Registered as a module run (roadmap S2) so a plan keeps building after the
  // owner navigates away; the tray shows it and the calendar fills in.
  const run = startModuleRun(
    { module: MODULE, label: `Plan calendar: ${weeks}w x ${perWeek}/wk, ${channels.join(", ")} (${describeLaunch(MODULE, L)})`, href: "/content-engine" },
    async (ctx) => {
      ctx.log(`asking ${seat} for the calendar${L.skills.length ? ` · skills ${L.skills.join(", ")}` : ""}`);
      const prompt = withSkills(withInstructions(planPrompt(goals, channels, perWeek, weeks, startISO), L), MODULE, undefined, L.skills);
      const { text: out, by } = await multiModelComplete(seat, prompt, {
        signal: ctx.signal, timeoutMs: launchTimeoutMs(L, 300_000), noFallback: L.guardrails.noFallback === true,
      });
      ctx.log(`planned by ${by}`);
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
      if (ctx.signal.aborted) throw new Error("stopped before the calendar was saved");

      const state = await readEngine();
      const kept = state.items.filter((it) => it.status !== "planned");
      state.items = [...kept, ...items].sort((a, b) => a.date.localeCompare(b.date));
      state.plan = { goals, channels, perWeek, weeks, at: Date.now() };
      await writeEngine(state);
      ctx.log(`${items.length} slots added, ${kept.length} kept`);
      return { added: items.length, kept: kept.length, by };
    },
    { summarize: (r) => r },
  );
  try {
    const r = await run.promise;
    return Response.json({ ok: true, ...r, runId: run.id, launch: L });
  } catch (e) {
    const err = e as Error;
    if (err.name === "AbortError") return Response.json({ ok: false, stopped: true, error: err.message, runId: run.id }, { status: 409 });
    const msg = err.message;
    const status = /did not return JSON|malformed JSON|no usable slots/.test(msg) ? 502 : 500;
    return Response.json({ ok: false, error: msg, runId: run.id }, { status });
  }
}
