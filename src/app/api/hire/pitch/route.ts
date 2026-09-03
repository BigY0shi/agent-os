import { getHireLead, setHirePitch } from "@/lib/hireDesk";
import { recordDeskPitch, hireSubject } from "@/lib/deskMemory";
import { generateHirePitch } from "@/lib/hireBrief";
import { startModuleRun } from "@/lib/moduleRuns";
import { HttpError, runErrorResponse } from "@/lib/runRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// POST { id } → write the "augment the hire" outreach for one job posting.
// Generation (prompt, deDash enforcement, JSON parsing) lives in lib/hireBrief.ts,
// shared with the batch pass that runs after "Enrich approved" — this route is the
// drawer's per-card "Write/Rewrite pitch" button.
export async function POST(req: Request) {
  const { id } = await req.json().catch(() => ({})) as { id?: string };
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });

  const lead = await getHireLead(id);
  if (!lead) return Response.json({ ok: false, error: "lead not found" }, { status: 404 });

  // Registered as a module run (roadmap S2 backlog). generateHirePitch takes no
  // signal yet (lib/hireBrief.ts): STOP marks the run stopped and answers 409,
  // but the claude child finishes on its own and its result is discarded.
  const run = startModuleRun(
    { module: "hire", label: `Hire pitch: ${lead.title}${lead.company ? ` @ ${lead.company}` : ""}`, href: "/hire" },
    async (ctx) => {
      ctx.log("writing the augment-the-hire outreach");
      const res = await generateHirePitch(lead);
      if ("error" in res) throw new HttpError(502, res.error);
      if (ctx.signal.aborted) throw new Error("stopped before the pitch was saved");
      await setHirePitch(id, res.pitch, res.read);
      // Hooked here rather than in setHirePitch, which the "pitch" action also calls
      // on every hand edit - one episode per generation, not per manual save.
      void recordDeskPitch("hire-engine", hireSubject(lead), res.pitch);
      ctx.log(`pitch saved (${res.pitch.split(/\s+/).length} words)`);
      return res;
    },
    { summarize: (r) => ({ id, words: r.pitch.split(/\s+/).length }) },
  );
  try {
    const res = await run.promise;
    return Response.json({ ok: true, pitch: res.pitch, read: res.read ?? null, runId: run.id });
  } catch (e) {
    return runErrorResponse(e, run.id);
  }
}
