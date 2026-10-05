import { activeTodayIds, agentReachability, isWorking, roomAgents, roomOverrides } from "@/lib/agentRoom";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/room/status -> { specialists, counts }   (S25 Mastermind rail)
// Each specialist gets ONE status word from a real signal, in this order:
//   working now   a reply from it is in flight in this server process
//   unreachable   what it needs is missing (the CLI or key named in `why`)
//   active today  it spoke in a room or one-on-one conversation saved today
//   ready         none of the above
export async function GET() {
  let today = new Set<string>();
  let todayError: string | null = null;
  try { today = await activeTodayIds(); } catch (e) { todayError = String((e as Error)?.message ?? e); }
  const specialists = roomAgents().map((a) => {
    const reach = agentReachability(a);
    const status = isWorking(a.id) ? "working now" : !reach.ok ? "unreachable" : today.has(a.id) ? "active today" : "ready";
    return { id: a.id, name: a.name, color: a.color, provider: a.provider, model: a.model, status, why: reach.why };
  });
  // S30: where the per-agent overrides come from ("settings" = the Room gear; "config.json" =
  // the legacy ~/.agentic-os/config.json roomAgents map, read only while settings has none).
  const overrideSource = roomOverrides().source;
  return Response.json({
    specialists,
    overrideSource,
    counts: { specialists: specialists.length, workingNow: specialists.filter((s) => s.status === "working now").length, unreachable: specialists.filter((s) => s.status === "unreachable").length },
    todayError,
  }, { headers: { "Cache-Control": "no-store" } });
}
