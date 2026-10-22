import { NextResponse } from "next/server";
import { resolveModel, localChat } from "@/lib/localOllama";
import { cliComplete } from "@/lib/loopEngine";
import { startModuleRun } from "@/lib/moduleRuns";
import { readSettings } from "@/lib/settings";
import { withSkills, skillBlock } from "@/lib/platformSkills";
import { resolveLaunchOptions, parseLaunchOptions, launchTimeoutMs, withInstructions, describeLaunch } from "@/lib/launchOptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const MODULE = "agent-kanban" as const;

// The Planner agent — decomposes a goal into a few small, buildable cards.
//
// POST { goal, launch? }  (legacy: { goal, agent }). `launch` is the pre-launch
// drawer's choice (roadmap S3): seat ("local" = the warm Ollama model, else a
// CLI agent), skills for this run, guardrails (timeoutMin, maxCards),
// instructions. Validated strictly; an unknown field is a 400. The run is
// registered in the tray and STOP aborts ctx.signal (the CLI child dies, the
// Ollama fetch aborts).
function planSys(maxCards: number): string {
  const lo = Math.min(3, maxCards);
  return (
    `You are the Planner on a small build team. Break the user's goal into ${lo === maxCards ? maxCards : `${lo} to ${maxCards}`} SMALL, concrete build tasks — ` +
    "each one a single self-contained visual web thing (a page, widget, toy, animation, calculator, mini-game) that one developer can build as ONE HTML file. " +
    'Return STRICT JSON only: {"cards":[{"title":"short name","brief":"one sentence of exactly what to build"}]}. ' +
    `No prose, no markdown. Keep titles under 5 words. Never return more than ${maxCards} cards. Make the set varied and genuinely useful or fun.`
  );
}

function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1).trim();
  return text.trim();
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { goal?: unknown; agent?: unknown; launch?: unknown };
  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  if (!goal) return NextResponse.json({ error: "missing goal" }, { status: 400 });

  // Legacy callers sent { agent: "cli:codex" | "local" }; that is a seat, so it
  // becomes a launch object and goes through the same validation.
  let rawLaunch = body.launch;
  if (rawLaunch === undefined && typeof body.agent === "string") {
    const legacy = parseLaunchOptions(MODULE, { agent: body.agent.replace(/^cli:/, "") || "local" });
    if (!legacy.ok) return NextResponse.json({ error: `${body.agent} is not wired for Agent Kanban. Use Claude, Codex, Cursor, Pi, Hermes, or Local team.`, model: body.agent }, { status: 400 });
    rawLaunch = legacy.value;
  }
  const launch = resolveLaunchOptions(MODULE, rawLaunch, readSettings().launch?.[MODULE]);
  if (!launch.ok) return NextResponse.json({ error: `launch: ${launch.error}` }, { status: 400 });
  const L = launch.value;
  const useCli = L.agent !== "local";
  const maxCards = typeof L.guardrails.maxCards === "number" ? L.guardrails.maxCards : 5;

  const run = startModuleRun(
    { module: MODULE, label: `Plan board: ${goal.slice(0, 80)} (${describeLaunch(MODULE, L)})`, href: "/agent-kanban" },
    async (ctx) => {
      const model = useCli ? `cli:${L.agent}` : await resolveModel();
      ctx.log(`planner ${model}${L.skills.length ? ` · skills ${L.skills.join(", ")}` : ""}`);
      const sys = withInstructions(planSys(maxCards), L);
      const user = `Goal: ${goal}`;
      const raw = useCli
        ? await cliComplete(L.agent, withSkills(`${sys}\n\n${user}`, MODULE, undefined, L.skills), { timeoutMs: launchTimeoutMs(L, 180_000), signal: ctx.signal })
        : await localChat(model, `${skillBlock(MODULE, undefined, L.skills)}${sys}`, user, { format: "json", temperature: 0.5, signal: ctx.signal });
      let parsed: { cards?: { title?: string; brief?: string }[] };
      try { parsed = JSON.parse(extractJson(raw)); } catch { parsed = { cards: [] }; }
      const cards = (parsed.cards || [])
        .filter((c) => c && typeof c.title === "string")
        .slice(0, maxCards)
        .map((c, i) => ({ id: `c${Date.now().toString(36)}${i}`, title: String(c.title).slice(0, 60), brief: String(c.brief ?? "").slice(0, 240) }));
      if (!cards.length) throw new Error("the planner returned no cards — try rephrasing the goal");
      ctx.log(`${cards.length} cards`);
      return { cards, model };
    },
    { summarize: (r) => ({ cards: r.cards.length, model: r.model }) },
  );
  try {
    const r = await run.promise;
    return NextResponse.json({ ...r, runId: run.id, launch: L });
  } catch (e) {
    const err = e as Error;
    if (err.name === "AbortError") return NextResponse.json({ error: err.message, stopped: true, runId: run.id }, { status: 409 });
    return NextResponse.json({ error: /no cards/.test(err.message) ? err.message : `planner failed: ${String(err.message).slice(0, 160)}`, runId: run.id }, { status: 502 });
  }
}
