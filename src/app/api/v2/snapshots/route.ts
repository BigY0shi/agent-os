// S37 Snapshots.
//   GET   /api/v2/snapshots                 status: settings, folder, job (last / next), snapshots, what is left out
//   POST  /api/v2/snapshots {action:"now"}  take a snapshot now (409 while one is running; 500 with the reason on failure)
//   PATCH /api/v2/snapshots {cadence?, dir?, keep?, includeSecrets?}
//                                           save the gear and re-sync the scheduled job, then return the status
import { writeSettings } from "@/lib/settings";
import { CADENCES, MAX_KEEP, snapshotRootDir, snapshotSettings, type SnapshotCadence } from "@/lib/v2/snapshots/config";
import { pruneSnapshots, snapshotStatus, syncSnapshotJob, takeSnapshotNow, SnapshotBusyError } from "@/lib/v2/snapshots/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "cache-control": "no-store" } };

export async function GET() {
  return Response.json({ ok: true, ...snapshotStatus() }, NO_STORE);
}

export async function POST(req: Request) {
  let body: { action?: unknown } = {};
  try { body = await req.json(); } catch { /* empty body = now */ }
  if (body.action !== undefined && body.action !== "now") {
    return Response.json({ ok: false, error: `unknown action '${String(body.action)}' (only "now")` }, { status: 400 });
  }
  try {
    const r = await takeSnapshotNow("manual");
    return Response.json({ ok: true, snapshot: r.snapshot, moved: r.exiled, manifest: { secretsLeftOut: r.manifest.secretsLeftOut, redacted: r.manifest.redacted }, ...snapshotStatus() }, NO_STORE);
  } catch (err) {
    const status = err instanceof SnapshotBusyError ? 409 : 500;
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status });
  }
}

export async function PATCH(req: Request) {
  let patch: Record<string, unknown>;
  try { patch = await req.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  if (!patch || typeof patch !== "object") return Response.json({ ok: false, error: "patch must be an object" }, { status: 400 });

  const next: Record<string, unknown> = {};
  if (patch.cadence !== undefined) {
    if (!CADENCES.includes(patch.cadence as SnapshotCadence)) return Response.json({ ok: false, error: `cadence must be one of ${CADENCES.join(", ")}` }, { status: 400 });
    next.cadence = patch.cadence;
  }
  if (patch.dir !== undefined) {
    if (typeof patch.dir !== "string") return Response.json({ ok: false, error: "dir must be a string (empty = the default folder)" }, { status: 400 });
    next.dir = patch.dir.trim();
    // Refuse a folder inside the state folder BEFORE saving it (it would snapshot itself).
    try { snapshotRootDir({ ...snapshotSettings(), dir: next.dir as string }); }
    catch (err) { return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 400 }); }
  }
  if (patch.keep !== undefined) {
    const n = Number(patch.keep);
    if (!Number.isInteger(n) || n < 1 || n > MAX_KEEP) return Response.json({ ok: false, error: `keep must be a whole number from 1 to ${MAX_KEEP}` }, { status: 400 });
    next.keep = n;
  }
  if (patch.includeSecrets !== undefined) {
    if (typeof patch.includeSecrets !== "boolean") return Response.json({ ok: false, error: "includeSecrets must be true or false" }, { status: 400 });
    next.includeSecrets = patch.includeSecrets;
  }
  if (!Object.keys(next).length) return Response.json({ ok: false, error: "nothing to change (cadence, dir, keep, includeSecrets)" }, { status: 400 });

  writeSettings({ snapshots: next });
  let pruned: string[] = [];
  let error: string | null = null;
  try {
    syncSnapshotJob();
    if (next.keep !== undefined) pruned = await pruneSnapshots();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  return Response.json({ ok: error === null, error, pruned, ...snapshotStatus() }, { ...NO_STORE, status: error ? 400 : 200 });
}
