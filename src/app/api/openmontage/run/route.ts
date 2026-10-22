import { spawnStream, type AgentName } from "@/lib/runner";
import { resolveOpenMontageConfig, OpenMontageError } from "@/lib/v2/openmontage/config";
import { runDoctor } from "@/lib/v2/openmontage/doctor";
import { startPipelineRun } from "@/lib/v2/openmontage/run";
import { agentInstalled } from "@/lib/v2/openmontage/agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

// POST /api/openmontage/run { pipeline, brief, projectId? } -> 202 { ok, runId, projectId, pipeline }
// The run outlives this request (module run); the page polls /api/runs/:id for
// the live log and the rendered outputs. The doctor gates the start: a missing
// repo, python or dependency is a 503 with its fix, never a run that dies quietly.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { pipeline?: string; brief?: string; projectId?: string };
  const cfg = resolveOpenMontageConfig();
  try {
    const doctor = await runDoctor(cfg, { agentInstalled });
    const bad = doctor.checks.filter((c) => !c.ok);
    // A missing primary agent is not fatal when the gear names an installed fallback (rule 20).
    const fatal = bad.filter((c) => !(c.label === "Agent" && cfg.fallbackAgent !== "none" && agentInstalled(cfg.fallbackAgent)));
    if (fatal.length) {
      return Response.json({ ok: false, error: `${fatal[0].label}: ${fatal[0].detail}`, fix: fatal[0].fix ?? null, doctor }, { status: 503, ...noStore });
    }
    const started = startPipelineRun(
      { pipelineId: String(body.pipeline ?? ""), brief: String(body.brief ?? ""), projectId: body.projectId ? String(body.projectId) : undefined },
      cfg,
      {
        agentInstalled,
        spawnAgent: (agent, args, opts) => spawnStream(agent as AgentName, args, { cwd: opts.cwd, input: opts.input }),
      },
    );
    return Response.json({ ok: true, runId: started.id, projectId: started.projectId, pipeline: started.pipeline.id, doctor }, { status: 202, ...noStore });
  } catch (e) {
    const err = e as OpenMontageError;
    const status = err instanceof OpenMontageError ? err.status : 500;
    return Response.json({ ok: false, error: err.message, fix: err.fix ?? null }, { status, ...noStore });
  }
}
