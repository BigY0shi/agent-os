import { NextResponse } from "next/server";
import { resolveModel, localChat } from "@/lib/localOllama";
import { cliComplete, LOOP_CLI_AGENTS } from "@/lib/loopEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Planner agent — decomposes a goal into 3–5 small, buildable cards. Offline.
const SYS =
  "You are the Planner on a small build team. Break the user's goal into 3 to 5 SMALL, concrete build tasks — " +
  "each one a single self-contained visual web thing (a page, widget, toy, animation, calculator, mini-game) that one developer can build as ONE HTML file. " +
  'Return STRICT JSON only: {"cards":[{"title":"short name","brief":"one sentence of exactly what to build"}]}. ' +
  "No prose, no markdown. Keep titles under 5 words. Make the set varied and genuinely useful or fun.";

function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1).trim();
  return text.trim();
}

export async function POST(req: Request) {
  const { goal, agent } = await req.json();
  if (typeof goal !== "string" || !goal.trim()) return NextResponse.json({ error: "missing goal" }, { status: 400 });

  const cliId = typeof agent === "string" ? agent.replace(/^cli:/, "") : "";
  const useCli = !!cliId && cliId !== "local" && (LOOP_CLI_AGENTS as readonly string[]).includes(cliId);
  if (cliId && cliId !== "local" && !useCli) {
    return NextResponse.json({ error: `${cliId} is not wired for Agent Kanban yet. Use Claude, Codex, Cursor, Pi, Hermes, or Local team.`, model: `cli:${cliId}` }, { status: 400 });
  }
  const model = useCli ? `cli:${cliId}` : await resolveModel();
  try {
    const raw = useCli
      ? await cliComplete(cliId, `${SYS}\n\nGoal: ${goal.trim()}`, { timeoutMs: 180_000 })
      : await localChat(model, SYS, `Goal: ${goal.trim()}`, { format: "json", temperature: 0.5 });
    let parsed: { cards?: { title?: string; brief?: string }[] };
    try { parsed = JSON.parse(extractJson(raw)); } catch { parsed = { cards: [] }; }
    const cards = (parsed.cards || [])
      .filter((c) => c && typeof c.title === "string")
      .slice(0, 6)
      .map((c, i) => ({ id: `c${Date.now().toString(36)}${i}`, title: String(c.title).slice(0, 60), brief: String(c.brief ?? "").slice(0, 240) }));
    if (!cards.length) return NextResponse.json({ error: "the planner returned no cards — try rephrasing the goal", model }, { status: 502 });
    return NextResponse.json({ cards, model });
  } catch (e) {
    return NextResponse.json({ error: `planner failed: ${String(e).slice(0, 160)}`, model }, { status: 502 });
  }
}
