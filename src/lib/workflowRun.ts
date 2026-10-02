// S14: run a workflow. One implementation for POST /api/workflows/:id/run and for
// Jarvis's module_kit tool, so both show in the runs tray, both honour STOP, and both
// apply the calling module's skills the same way.

import { getWorkflow, fillPrompt, WorkflowError } from "@/lib/workflows";
import { getModule } from "@/lib/moduleRegistry";
import { cliComplete } from "@/lib/loopEngine";
import { startModuleRun } from "@/lib/moduleRuns";
import { HttpError } from "@/lib/runRoute";

export function runWorkflow(id: string, opts: { module?: string; input?: string } = {}): { runId: string; agent: string; promise: Promise<string> } {
  const wf = getWorkflow(id);
  if (!wf) throw new WorkflowError("workflow not found", 404);
  if (opts.module !== undefined && !getModule(opts.module)) throw new WorkflowError(`unknown module "${opts.module}"`);
  const prompt = fillPrompt(wf, opts.input);
  const mod = opts.module ? getModule(opts.module) : null;
  const run = startModuleRun(
    { module: opts.module ?? "workflows", label: `Workflow: ${wf.name}${mod ? ` (${mod.label})` : ""}`, href: mod?.route },
    async (rc) => {
      rc.log(`running on ${wf.agent}${opts.module ? ` with ${opts.module} skills` : ""}`);
      const out = (await cliComplete(wf.agent, prompt, { timeoutMs: 240_000, signal: rc.signal, module: opts.module })).trim();
      if (!out) throw new HttpError(502, `${wf.agent} returned nothing for "${wf.name}"`);
      rc.log(`done, ${out.length} characters`);
      return out;
    },
    { summarize: (out) => ({ chars: out.length }) },
  );
  return { runId: run.id, agent: wf.agent, promise: run.promise };
}
