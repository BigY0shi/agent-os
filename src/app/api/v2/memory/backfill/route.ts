import { NextRequest, NextResponse } from "next/server";
import { ensureV2 } from "@/lib/v2/boot";
import { readSettings } from "@/lib/settings";
import { listModuleRuns, startModuleRun } from "@/lib/moduleRuns";
import {
  BACKFILL_LIMIT_MAX,
  backfillEpisodes,
  countUndrivedEpisodes,
  listBackfillLog,
  listUndrivedEpisodes,
} from "@/lib/v2/memory/backfill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const noStore = { headers: { "cache-control": "no-store" } };
const LABEL_PREFIX = "Backfill legacy memory";

function defaults(): { limit: number; model: string } {
  const mem = readSettings().memory ?? {};
  return { limit: mem.backfillLimit ?? 20, model: mem.backfillModel ?? "bonsai:27b" };
}

function pickLimit(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), BACKFILL_LIMIT_MAX);
}

function runningBackfill(): string | null {
  const live = listModuleRuns().find(
    (r) => r.module === "memory" && r.status === "running" && r.label.startsWith(LABEL_PREFIX),
  );
  return live ? live.id : null;
}

/**
 * GET /api/v2/memory/backfill?limit=N — what a run would touch: the total of
 * undrived legacy episodes, the first N candidates, the recent log, and the
 * id of a backfill already in flight (so the gear can point at the tray).
 * Reads only; no Ollama call.
 */
export async function GET(req: NextRequest) {
  ensureV2();
  const d = defaults();
  const limit = pickLimit(req.nextUrl.searchParams.get("limit"), d.limit);
  return NextResponse.json(
    {
      remaining: countUndrivedEpisodes(),
      candidates: listUndrivedEpisodes(limit),
      limit,
      model: d.model,
      log: listBackfillLog(20),
      runId: runningBackfill(),
    },
    noStore,
  );
}

/**
 * POST /api/v2/memory/backfill — S5 legacy backfill.
 * Body: { limit?, model?, dryRun? }. Defaults come from settings.memory
 * (backfillLimit / backfillModel, the gear).
 *   dryRun  → answers at once with the candidates; nothing written, no Ollama.
 *   real    → registers a module run (module "memory", progress per episode,
 *             STOP honoured) and returns { started, runId } immediately; the
 *             tray carries the run. 409 while a backfill is already running.
 * Ollama absent or the model not pulled fails the run with a named error and
 * never falls back (the run record and the tray say why).
 */
export async function POST(req: NextRequest) {
  ensureV2();
  let body: { limit?: unknown; model?: unknown; dryRun?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, ...noStore });
  }
  const d = defaults();
  const limit = pickLimit(body.limit, d.limit);
  const model = (typeof body.model === "string" && body.model.trim()) || d.model;
  const dryRun = body.dryRun === true;

  if (dryRun) {
    try {
      const result = await backfillEpisodes({ limit, model, dryRun: true });
      return NextResponse.json(result, noStore);
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500, ...noStore });
    }
  }

  const inFlight = runningBackfill();
  if (inFlight) {
    return NextResponse.json(
      { ok: false, error: "A legacy backfill is already running; see the runs tray.", runId: inFlight },
      { status: 409, ...noStore },
    );
  }

  const run = startModuleRun(
    { module: "memory", label: `${LABEL_PREFIX}: up to ${limit} episodes with ${model}`, href: "/memory" },
    (ctx) => backfillEpisodes({ limit, model, signal: ctx.signal, log: ctx.log, progress: ctx.progress, runId: ctx.id }),
    {
      summarize: (r) => ({
        derived: r.derived,
        nothing: r.nothing,
        failed: r.failed,
        remaining: r.remaining - r.derived - r.nothing,
        model: r.model,
      }),
    },
  );
  return NextResponse.json({ ok: true, started: true, runId: run.id, limit, model }, noStore);
}
