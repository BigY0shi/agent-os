import { listWorkflows, listRetiredWorkflows, createWorkflow, workflowActivation, WorkflowError } from "@/lib/workflows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/workflows            -> { workflows, active, retired }
// POST /api/workflows { name, prompt, description?, inputLabel?, agent? } -> { workflow }
const noStore = { headers: { "Cache-Control": "no-store" } };

export async function GET() {
  try {
    return Response.json({ workflows: listWorkflows(), active: workflowActivation(), retired: listRetiredWorkflows() }, noStore);
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message ?? e) }, { status: 500, ...noStore });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ error: "expected JSON { name, prompt, ... }" }, { status: 400, ...noStore });
  try {
    return Response.json({ workflow: createWorkflow(body as Record<string, unknown>) }, { status: 201, ...noStore });
  } catch (e) {
    if (e instanceof WorkflowError) return Response.json({ error: e.message }, { status: e.status, ...noStore });
    return Response.json({ error: String((e as Error)?.message ?? e) }, { status: 500, ...noStore });
  }
}
