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
  type BackfillProvider,
} from "@/lib/v2/memory/backfill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const noStore = { headers: { "cache-control": "no-store" } };
const LABEL_PREFIX = "Backfill legacy memory";

const PROVIDERS: BackfillProvider[] = ["ollama-local", "openai-compat"];

function defaults(): { limit: number; model: string; provider: BackfillProvider } {
  const mem = readSettings().memory ?? {};
  return {
    limit: mem.backfillLimit ?? 20,
    model: mem.backfillModel ?? "bonsai:27b",
    provider: mem.backfillProvider ?? "ollama-local",
  };
}

/** An unknown provider string is rejected outright rather than quietly defaulted. */
function pickProvider(raw: unknown, fallback: BackfillProvider): BackfillProvider | { error: string } {
  if (raw === undefined || raw === null || raw === "") return fallback;
  if (typeof raw !== "string" || !PROVIDERS.includes(raw as BackfillProvider)) {
    return { error: `provider must be one of ${PROVIDERS.join(" | ")}` };
  }
  return raw as BackfillProvider;
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
      provider: d.provider,
      log: listBackfillLog(20),
      runId: runningBackfill(),
    },
    noStore,
  );
}

/**
 * POST /api/v2/memory/backfill — S5 legacy backfill.
 * Body: { limit?, model?, provider?, dryRun? }. Defaults come from
 * settings.memory (backfillLimit / backfillModel / backfillProvider, the gear).
 * provider is 'ollama-local' or 'openai-compat' (LM Studio and friends, at
 * settings.memory.openaiCompatUrl); anything else is a 400, never a default.
 *   dryRun  → answers at once with the candidates; nothing written, no model call.
 *   real    → registers a module run (module "memory", progress per episode,
 *             STOP honoured) and returns { started, runId } immediately; the
 *             tray carries the run. 409 while a backfill is already running.
 * Ollama absent or the model not pulled fails the run with a named error and
 * never falls back (the run record and the tray say why).
 */
export async function POST(req: NextRequest) {
  ensureV2();
  let body: { limit?: unknown; model?: unknown; provider?: unknown; dryRun?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, ...noStore });
  }
  const d = defaults();
  const limit = pickLimit(body.limit, d.limit);
  const model = (typeof body.model === "string" && body.model.trim()) || d.model;
  const picked = pickProvider(body.provider, d.provider);
  if (typeof picked !== "string") {
    return NextResponse.json({ error: picked.error }, { status: 400, ...noStore });
  }
  const provider = picked;
  const dryRun = body.dryRun === true;

  if (dryRun) {
    try {
      const result = await backfillEpisodes({ limit, model, provider, dryRun: true });
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
    { module: "memory", label: `${LABEL_PREFIX}: up to ${limit} episodes with ${model} (${provider})`, href: "/memory" },
    (ctx) => backfillEpisodes({ limit, model, provider, signal: ctx.signal, log: ctx.log, progress: ctx.progress, runId: ctx.id }),
    {
      summarize: (r) => ({
        derived: r.derived,
        nothing: r.nothing,
        failed: r.failed,
        remaining: r.remaining - r.derived - r.nothing,
        model: r.model,
        provider: r.provider,
        base: r.base,
      }),
    },
  );
  return NextResponse.json({ ok: true, started: true, runId: run.id, limit, model, provider }, noStore);
}
