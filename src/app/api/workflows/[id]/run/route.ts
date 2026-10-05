import { WorkflowError } from "@/lib/workflows";
import { isModuleId } from "@/lib/moduleRegistry";
import { runWorkflow } from "@/lib/workflowRun";
import { runErrorResponse } from "@/lib/runRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/workflows/:id/run { module?, input? } -> { ok, output, agent, runId }
// Runs the workflow's prompt on its agent as a module run (runs tray, STOP works).
// With `module`, that module's skills apply, like any agent call made from there.
type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = ((await req.json().catch(() => ({}))) ?? {}) as { module?: unknown; input?: unknown };
  if (body.module !== undefined && !isModuleId(body.module)) {
    return Response.json({ ok: false, error: `unknown module "${String(body.module)}"` }, { status: 400 });
  }
  if (body.input !== undefined && (typeof body.input !== "string" || body.input.length > 40_000)) {
    return Response.json({ ok: false, error: "input must be text up to 40000 characters" }, { status: 400 });
  }
  let run: ReturnType<typeof runWorkflow>;
  try {
    run = runWorkflow(id, { module: body.module as string | undefined, input: body.input as string | undefined });
  } catch (e) {
    if (e instanceof WorkflowError) return Response.json({ ok: false, error: e.message }, { status: e.status });
    throw e;
  }
  try {
    const output = await run.promise;
    return Response.json({ ok: true, output, agent: run.agent, runId: run.runId });
  } catch (e) {
    return runErrorResponse(e, run.runId);
  }
}
