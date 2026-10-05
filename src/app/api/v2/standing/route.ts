import { ensureV2 } from "@/lib/v2/boot";
import { actOnOrder, listStandingOrders, orderCounts, OrderError, type OrderAction } from "@/lib/v2/standing/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/v2/standing -> { orders, counts }   every recurring job (S26 Standing orders)
// POST /api/v2/standing { id, action: "run" | "hold" | "resume" | "takeoff", confirm? }
//   Each action goes through the owning system's own path; "takeoff" needs confirm and
//   never deletes (a task keeps living with no schedule; an agent's trigger goes only
//   after its agent.json is kept as a version; system jobs cannot be taken off).
const noStore = { headers: { "Cache-Control": "no-store" } };
const ACTIONS: OrderAction[] = ["run", "hold", "resume", "takeoff"];

export async function GET() {
  try {
    ensureV2();
    const orders = await listStandingOrders();
    return Response.json({ orders, counts: orderCounts(orders) }, noStore);
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message ?? e) }, { status: 500, ...noStore });
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { id?: unknown; action?: unknown; confirm?: unknown } | null;
  if (!body || typeof body.id !== "string" || !ACTIONS.includes(body.action as OrderAction)) {
    return Response.json({ error: "expected { id, action: run | hold | resume | takeoff, confirm? }" }, { status: 400, ...noStore });
  }
  try {
    ensureV2();
    await actOnOrder(body.id, body.action as OrderAction, body.confirm === true);
    const orders = await listStandingOrders();
    return Response.json({ ok: true, orders, counts: orderCounts(orders) }, noStore);
  } catch (e) {
    if (e instanceof OrderError) return Response.json({ error: e.message }, { status: e.status, ...noStore });
    return Response.json({ error: String((e as Error)?.message ?? e) }, { status: 500, ...noStore });
  }
}
