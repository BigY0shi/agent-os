import { resolveOpenMontageConfig, OpenMontageError } from "@/lib/v2/openmontage/config";
import { startPreflightRun } from "@/lib/v2/openmontage/preflight";
import { agentInstalled } from "@/lib/v2/openmontage/agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const noStore = { headers: { "cache-control": "no-store" } };

// POST /api/openmontage/preflight -> { ok, runId, text, menu } (awaited: it takes seconds)
export async function POST() {
  const cfg = resolveOpenMontageConfig();
  const run = startPreflightRun(cfg, { agentInstalled });
  try {
    const r = await run.promise;
    return Response.json({ ok: true, runId: run.id, text: r.text, menu: r.menu }, noStore);
  } catch (e) {
    const err = e as OpenMontageError;
    const status = err instanceof OpenMontageError ? err.status : 500;
    return Response.json({ ok: false, runId: run.id, error: err.message, fix: err.fix ?? null }, { status, ...noStore });
  }
}
