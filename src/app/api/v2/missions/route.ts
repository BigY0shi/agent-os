import { createMission, crewAvailability, listMissions, missionStats, recoverAfterRestart } from "@/lib/v2/missions/runtime";
import { MissionError } from "@/lib/v2/missions/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/v2/missions -> { missions, stats, crew }   (S17 Missions board)
// POST /api/v2/missions  { name, objective, successLooksLike, priority, targetDate?, teamMode,
//                          seats?, timeLimitMin, maxSteps, reportLength, endAction } -> 201 { mission }
//      Creating a mission starts Jarvis planning it; nothing runs until the owner approves.
const noStore = { headers: { "Cache-Control": "no-store" } };
const fail = (e: unknown) =>
  e instanceof MissionError
    ? Response.json({ error: e.message }, { status: e.status, ...noStore })
    : Response.json({ error: String((e as Error)?.message ?? e) }, { status: 500, ...noStore });

export async function GET() {
  try {
    recoverAfterRestart();
    const missions = listMissions();
    return Response.json({ missions, stats: missionStats(missions), crew: await crewAvailability() }, noStore);
  } catch (e) { return fail(e); }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ error: "expected a JSON mission brief" }, { status: 400, ...noStore });
  try {
    return Response.json({ mission: await createMission(body) }, { status: 201, ...noStore });
  } catch (e) { return fail(e); }
}
