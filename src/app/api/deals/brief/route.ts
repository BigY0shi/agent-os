import { getDeal, setBrief } from "@/lib/upworkDesk";
import { generateBrief } from "@/lib/dealBrief";
import { startModuleRun } from "@/lib/moduleRuns";
import { HttpError, runErrorResponse } from "@/lib/runRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// POST { id } → generate the analysis block (summary / why / approach / crash course)
// for ONE deal. See ../brief-batch for the bulk path, and lib/dealBrief.ts for why
// feed leads need this at all.
export async function POST(req: Request) {
  const { id } = await req.json().catch(() => ({})) as { id?: string };
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });

  const deal = await getDeal(id);
  if (!deal) return Response.json({ ok: false, error: "deal not found" }, { status: 404 });

  // Registered as a module run (roadmap S2 backlog): the brief keeps writing if
  // the owner leaves the desk, the tray shows it, and STOP reaches the claude
  // child through ctx.signal. This handler still awaits the same promise, so
  // the drawer gets its answer (and its status codes) exactly as before.
  const run = startModuleRun(
    { module: "deals", label: `Brief: ${deal.title}`, href: "/deals" },
    async (ctx) => {
      ctx.log("asking claude for summary / why / approach / crash course");
      const brief = await generateBrief(deal, ctx.signal);
      if (!brief) throw new HttpError(502, "the agent returned no usable brief");
      if (ctx.signal.aborted) throw new Error("stopped before the brief was saved");
      await setBrief(id, brief);
      ctx.log("brief saved");
      return brief;
    },
    { summarize: () => ({ id }) },
  );
  try {
    const brief = await run.promise;
    return Response.json({ ok: true, brief, runId: run.id });
  } catch (e) {
    return runErrorResponse(e, run.id);
  }
}
