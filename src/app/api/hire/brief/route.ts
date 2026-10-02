import { getHireLead, setHireBrief } from "@/lib/hireDesk";
import { generateHireBrief } from "@/lib/hireBrief";
import { startModuleRun } from "@/lib/moduleRuns";
import { HttpError, runErrorResponse } from "@/lib/runRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// POST { id } → generate the analysis block (summary / why / approach / crash course)
// for ONE hire lead. Generation lives in lib/hireBrief.ts, shared with the batch
// pass (lib/hireBatch.ts) that runs automatically after a scan — this route is the
// drawer's "re-do this one now" button.
export async function POST(req: Request) {
  const { id } = await req.json().catch(() => ({})) as { id?: string };
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });

  const lead = await getHireLead(id);
  if (!lead) return Response.json({ ok: false, error: "lead not found" }, { status: 404 });

  // Registered as a module run (roadmap S2 backlog). generateHireBrief takes no
  // signal yet (lib/hireBrief.ts): STOP marks the run stopped and answers 409,
  // but the claude child finishes on its own and its result is discarded.
  const run = startModuleRun(
    { module: "hire", label: `Hire brief: ${lead.title}${lead.company ? ` @ ${lead.company}` : ""}`, href: "/hire" },
    async (ctx) => {
      ctx.log("asking claude for summary / why / approach / crash course");
      const brief = await generateHireBrief(lead);
      if ("error" in brief) throw new HttpError(502, brief.error);
      if (ctx.signal.aborted) throw new Error("stopped before the brief was saved");
      await setHireBrief(id, brief);
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
