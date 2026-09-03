// The quick pass/not check.
//
// Why this exists: the brief pass is a full analysis (summary, why, approach,
// crashCourse) at roughly 15s a lead, so briefBatch deliberately caps itself at the
// top 20 by composite. Everything below that cap reached the board with no evaluation
// at all, and deriveVerdict used to band those leads off the fit the feed shipped
// them with. That fit is a keyword heuristic: feeds.json scores 53 of 131
// WeWorkRemotely rows at exactly 8, "Cribl: Customer Support Manager" among them, so
// unevaluated leads rendered as a confident green Pursue.
//
// The screen is one short call per lead returning a band and a sentence, cheap enough
// to run over the whole board. A lead the screen never reached, or one where the call
// failed, stays unscreened and reads NA in purple. Nothing here invents a band.
import { run } from "@/lib/runner";
import { CLAUDE_MODEL } from "@/lib/config";
import { claudeBuilderArgs } from "@/lib/agentPowers";
import { readSettings } from "@/lib/settings";
import { LEADS_DIR, listDeals, setScreen, type Deal } from "@/lib/upworkDesk";
import { pool } from "@/lib/dealBrief";
import type { VerdictBand } from "@/lib/dealDeskControl";

// The call returns one sentence, so it is far cheaper than a brief and 6 can run at
// once without the machine feeling it.
const CONCURRENCY = 6;
// Not a shortlist cap like DEFAULT_LIMIT - the whole point is covering everything.
// This is a runaway guard for a board that has grown past anything reviewable.
export const MAX_SCREEN = 500;

/** Gear-configurable so the screen can run on a cheaper model than the brief (rule 16). */
export function screenModel(): string {
  const m = readSettings().deals?.screenModel;
  return typeof m === "string" && m.trim() ? m.trim() : CLAUDE_MODEL;
}

export function screenPrompt(deal: Deal): string {
  return (
    "You are triaging inbound job leads for a RevOps / automation consultancy that " +
    "builds systems and automations. You are NOT hiring for staff roles and do not " +
    "take support, sales, or admin positions.\n\n" +
    "Return ONLY minified JSON, no prose and no code fences, with EXACTLY these keys:\n" +
    '{"band":"pursue|maybe|pass","line":"one blunt sentence"}\n\n' +
    "band - pursue if this is systems/automation work we could credibly win; pass if " +
    "it is a staff role, out of scope, or too thin to bid; maybe if it genuinely could " +
    "go either way.\n" +
    "line - ONE sentence saying why, concrete about this listing. No hedging.\n\n" +
    "Most listings are a pass. A false pursue costs more than a skipped lead.\n\n" +
    `SOURCE: ${deal.source || "upwork"}\n` +
    `LISTING: ${deal.title}\n` +
    `Budget: ${deal.budget ?? "?"} ${deal.jobType ?? ""}\n` +
    `Tags: ${(deal.tags || []).join(", ")}\n` +
    // Deliberately shorter than the brief's 4000: the screen is a triage read, and
    // the first 1200 characters carry the role and the scope.
    `Description: ${(deal.description || "").slice(0, 1200)}`
  );
}

const BANDS = new Set<VerdictBand>(["pursue", "maybe", "pass"]);

/**
 * Parse a screen response. Returns null unless the model produced a band we
 * recognise - an unparseable answer leaves the lead unscreened rather than
 * guessing at what it meant.
 */
export function parseScreen(out: string): { band: VerdictBand; line: string } | null {
  const text = String(out || "").trim();
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(m[0]); } catch { return null; }
  const band = String(parsed.band ?? "").trim().toLowerCase() as VerdictBand;
  if (!BANDS.has(band)) return null;
  const line = typeof parsed.line === "string" ? parsed.line.trim() : "";
  if (!line) return null;
  return { band, line };
}

/** Returns null on any failure; the caller persists nothing in that case. */
export async function screenDeal(deal: Deal, signal?: AbortSignal): Promise<{ band: VerdictBand; line: string } | null> {
  const model = screenModel();
  const r = await run(
    "claude",
    ["-p", "--model", model, "--output-format", "text", ...claudeBuilderArgs()],
    { timeoutMs: 90_000, input: screenPrompt(deal), cwd: LEADS_DIR, signal },
  );
  if (!r.ok) return null;
  return parseScreen(r.stdout || "");
}

// -- batch --------------------------------------------------------------------

export interface ScreenJob {
  running: boolean;
  total: number;
  done: number;
  // Not named `ok`: routes spread this beside their own ok flag.
  succeeded: number;
  failed: number;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  runId?: string;
}

const g = globalThis as unknown as { __agentosScreen?: ScreenJob };
const job: ScreenJob = (g.__agentosScreen ??= {
  running: false, total: 0, done: 0, succeeded: 0, failed: 0,
  startedAt: 0, finishedAt: null, error: null,
});

export function screenBatchStatus(): ScreenJob {
  return { ...job };
}

export interface ScreenBatchOpts { source?: string; limit?: number }
export type ScreenBatchPlan =
  | { ok: true; targets: Deal[] }
  | { ok: false; total: number; reason: string };

/**
 * A lead needs screening exactly when nothing has judged it yet, which is what
 * an "unknown" verdict already means. Leads carrying a pitch, a brief or an
 * earlier screen are left alone, so re-running only picks up the gaps.
 */
export async function planScreenBatch(opts?: ScreenBatchOpts): Promise<ScreenBatchPlan> {
  if (job.running) return { ok: false, total: job.total, reason: "already running" };
  const all = await listDeals();
  const pool0 = all.filter((d) => (opts?.source ? (d.source || "upwork") === opts.source : true));
  const limit = Math.max(1, Math.min(MAX_SCREEN, opts?.limit ?? MAX_SCREEN));
  const targets = pool0
    .filter((d) => d.verdict.band === "unknown")
    // Freshest first: an old listing screened is worth less than a new one.
    .sort((a, b) => (b.postedAt ?? 0) - (a.postedAt ?? 0))
    .slice(0, limit);
  if (!targets.length) return { ok: false, total: 0, reason: "nothing to screen" };
  return { ok: true, targets };
}

export async function runScreenBatch(targets: Deal[], opts: {
  runId?: string;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  log?: (text: string) => void;
} = {}): Promise<void> {
  if (job.running) throw new Error("A screen pass is already running.");
  Object.assign(job, {
    running: true, total: targets.length, done: 0, succeeded: 0, failed: 0,
    startedAt: Date.now(), finishedAt: null, error: null, runId: opts.runId,
  });
  opts.log?.(`screening ${targets.length} leads on ${screenModel()}, ${CONCURRENCY} at a time`);
  try {
    await pool(targets, CONCURRENCY, async (deal) => {
      if (opts.signal?.aborted) return;
      try {
        const res = await screenDeal(deal, opts.signal);
        if (res) {
          await setScreen(deal.id, { band: res.band, line: res.line, model: screenModel() });
          job.succeeded++;
          opts.log?.(`${res.band}: ${deal.title}`);
        } else {
          // Left unscreened on purpose: the card keeps reading NA rather than
          // acquiring a band nobody produced.
          job.failed++;
          opts.log?.(`no usable screen, left NA: ${deal.title}`);
        }
      } catch {
        job.failed++;
      } finally {
        job.done++;
        opts.onProgress?.(job.done, job.total);
      }
    });
    if (opts.signal?.aborted) {
      job.error = "stopped";
      throw opts.signal.reason instanceof Error ? opts.signal.reason : new Error("stopped");
    }
  } catch (e) {
    if (!job.error) job.error = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    job.running = false;
    job.finishedAt = Date.now();
  }
}

/** Fire-and-forget form for the feed pull. Never throws for "nothing to do". */
export async function startScreenBatch(opts?: ScreenBatchOpts): Promise<{ started: boolean; total: number; reason?: string }> {
  const plan = await planScreenBatch(opts);
  if (!plan.ok) return { started: false, total: plan.total, reason: plan.reason };
  void runScreenBatch(plan.targets).catch(() => {});
  return { started: true, total: plan.targets.length };
}
