import { resolveOpenMontageConfig, OpenMontageError } from "@/lib/v2/openmontage/config";
import { agentInstalled } from "@/lib/v2/openmontage/agents";
import { runDoctor } from "@/lib/v2/openmontage/doctor";
import { listPipelines } from "@/lib/v2/openmontage/pipelines";
import { listProjects } from "@/lib/v2/openmontage/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { headers: { "cache-control": "no-store" } };

// GET /api/openmontage -> { ok, config, doctor, pipelines, broken, projects }
// A missing checkout is a 503 with the fix; the page shows it in place of the
// pipeline list. Python / dependency failures come back inside `doctor` with
// the list intact, because the manifests are readable without Python.
export async function GET() {
  const config = resolveOpenMontageConfig();
  try {
    const { pipelines, broken } = listPipelines(config.repoPath);
    const doctor = await runDoctor(config, { agentInstalled });
    const projects = listProjects(config.outputDir);
    return Response.json({ ok: true, config, doctor, pipelines, broken, projects }, noStore);
  } catch (e) {
    const err = e as OpenMontageError;
    const status = err instanceof OpenMontageError ? err.status : 500;
    return Response.json({ ok: false, error: err.message, fix: err.fix ?? null, config }, { status, ...noStore });
  }
}
