import { loadMission, missionAction, readEvents, recoverAfterRestart } from "@/lib/v2/missions/runtime";
import { MissionError, readStepOutput } from "@/lib/v2/missions/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/v2/missions/:id              -> { mission, events }  (events = WHAT HAPPENED, IN ORDER)
// GET  /api/v2/missions/:id?step=s1&kind=md|log -> { text }      a seat's answer or raw output
// POST /api/v2/missions/:id  { action: "approve" | "send-back" | "replan" | "accept" | "stop", note? }
const noStore = { headers: { "Cache-Control": "no-store" } };
const fail = (e: unknown) =>
  e instanceof MissionError
    ? Response.json({ error: e.message }, { status: e.status, ...noStore })
    : Response.json({ error: String((e as Error)?.message ?? e) }, { status: 500, ...noStore });

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const q = new URL(req.url).searchParams;
  try {
    recoverAfterRestart();
    const mission = loadMission(id);
    if (!mission) return Response.json({ error: `no mission ${id}` }, { status: 404, ...noStore });
    const step = q.get("step");
    if (step) {
      const kind = q.get("kind") === "log" ? "log" : "md";
      return Response.json({ text: readStepOutput(id, step, kind) }, noStore);
    }
    return Response.json({ mission, events: readEvents(id) }, noStore);
  } catch (e) { return fail(e); }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { action?: unknown; note?: unknown } | null;
  if (!body || typeof body.action !== "string") return Response.json({ error: "expected { action, note? }" }, { status: 400, ...noStore });
  try {
    const mission = await missionAction(id, body.action, typeof body.note === "string" ? body.note : undefined);
    return Response.json({ mission, events: readEvents(id) }, noStore);
  } catch (e) { return fail(e); }
}
