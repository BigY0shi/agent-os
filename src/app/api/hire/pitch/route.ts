import { getHireLead, setHirePitch } from "@/lib/hireDesk";
import { recordDeskPitch, hireSubject } from "@/lib/deskMemory";
import { generateHirePitch } from "@/lib/hireBrief";

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

  try {
    const res = await generateHirePitch(lead);
    if ("error" in res) return Response.json({ ok: false, error: res.error }, { status: 502 });
    await setHirePitch(id, res.pitch, res.read);
    // Hooked here rather than in setHirePitch, which the "pitch" action also calls
    // on every hand edit - one episode per generation, not per manual save.
    void recordDeskPitch("hire-engine", hireSubject(lead), res.pitch);
    return Response.json({ ok: true, pitch: res.pitch, read: res.read ?? null });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
