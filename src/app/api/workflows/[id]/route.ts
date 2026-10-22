import { getWorkflow, updateWorkflow, retireWorkflow, restoreWorkflow, WorkflowError } from "@/lib/workflows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET    /api/workflows/:id              -> { workflow }
// PATCH  /api/workflows/:id { fields }   -> { workflow }     edit
// PATCH  /api/workflows/:id { restore: true } -> { workflow } bring a retired one back
// DELETE /api/workflows/:id              -> { ok, retired }  retire (never deleted)
type Ctx = { params: Promise<{ id: string }> };
const noStore = { headers: { "Cache-Control": "no-store" } };
const fail = (e: unknown) =>
  e instanceof WorkflowError
    ? Response.json({ error: e.message }, { status: e.status, ...noStore })
    : Response.json({ error: String((e as Error)?.message ?? e) }, { status: 500, ...noStore });

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const workflow = getWorkflow(id);
  return workflow ? Response.json({ workflow }, noStore) : Response.json({ error: "workflow not found" }, { status: 404, ...noStore });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return Response.json({ error: "expected JSON" }, { status: 400, ...noStore });
  try {
    if (body.restore === true) return Response.json({ workflow: restoreWorkflow(id) }, noStore);
    return Response.json({ workflow: updateWorkflow(id, body) }, noStore);
  } catch (e) { return fail(e); }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  try { retireWorkflow(id); return Response.json({ ok: true, retired: id }, noStore); } catch (e) { return fail(e); }
}
