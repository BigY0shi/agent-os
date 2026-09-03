import { getDeal } from "@/lib/upworkDesk";
import { readUpworkCookie } from "@/lib/upworkAuth";
import { runResearch, RESEARCH_STEPS, type ResearchStep } from "@/lib/dealResearch";
import { startModuleRun } from "@/lib/moduleRuns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { id, steps?: ("enrich"|"brief"|"questions")[] } -> the research pass
// "More info needed" fires (S4 e): enrich + brief + the open questions, as ONE
// module run. Returns at once with runId; the card carries the state
// (deal.research) and the client polls the board until it settles. A pass takes
// a minute or more (two claude calls and possibly a browser), which is why this
// is not awaited the way /brief is.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { id?: string; steps?: unknown };
  if (!body.id) return Response.json({ ok: false, error: "id required" }, { status: 400 });
  const deal = await getDeal(body.id);
  if (!deal) return Response.json({ ok: false, error: "deal not found" }, { status: 404 });
  if (deal.research?.status === "running") {
    return Response.json({ ok: false, error: "A research pass is already running on this card.", runId: deal.research.runId }, { status: 409 });
  }
  const wanted = Array.isArray(body.steps) ? body.steps.filter((s): s is ResearchStep => typeof s === "string" && (RESEARCH_STEPS as string[]).includes(s)) : [];
  const steps = wanted.length ? wanted : RESEARCH_STEPS;
  const cookie = readUpworkCookie();

  const run = startModuleRun(
    { module: "deals", label: `Research: ${deal.title}`, href: "/deals" },
    (ctx) => runResearch(deal, { steps, cookie: cookie || undefined, signal: ctx.signal, runId: ctx.id, log: ctx.log, progress: ctx.progress }),
    { summarize: (o) => ({ id: deal.id, enrich: o.enrich, brief: o.brief, questions: o.questions }) },
  );
  return Response.json({ ok: true, started: true, id: deal.id, steps, runId: run.id });
}
