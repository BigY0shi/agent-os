// Bulk brief generation — the feed-side counterpart to pitch.mjs.
//
// The Upwork pipeline never asks you to review raw leads: it scrapes, scores,
// shortlists the top 20, and pitches ONLY those, so every Upwork card arrives already
// analysed. Feed leads (RemoteOK / WWR) had no equivalent — all 248 landed in the New
// column with empty summary/why/approach, and a per-card button doesn't fix that
// because nobody clicks 248 buttons.
//
// So this runs at INGEST: pulling feeds kicks off a brief pass over the best-scoring
// leads, and by the time you look at the column they are ready to review.
//
// Job state lives on globalThis for the same reason the terminal's and the scrape's
// do — route handlers are stateless, this work is not.
//
// Two halves (roadmap S2 backlog): planBriefBatch() picks the targets and
// runBriefBatch() works them, so a route can put the work inside
// startModuleRun() and hand it the run's signal / progress / log. startBriefBatch()
// is the original one-call form the feed pull and "refill" still use.
import { listDeals, setBrief, type Deal } from "@/lib/upworkDesk";
import { generateBrief, pool } from "@/lib/dealBrief";

// ~15s per lead. 4 at a time keeps a batch of 20 around 75s without spawning 20
// `claude` processes at once.
const CONCURRENCY = 4;
// A batch is 20 — matching the Upwork shortlist, and sized to what a person can
// actually review in one sitting. Running it again takes the NEXT 20 best unanalysed
// leads, so it doubles as the "repopulate New once I've worked through these" action.
export const DEFAULT_LIMIT = 20;

export interface BriefJob {
  running: boolean;
  total: number;
  done: number;
  // NOT named `ok`: responses spread this object alongside their own `ok: true`
  // success flag, which would overwrite the count with a boolean.
  succeeded: number;
  failed: number;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  /** The top-up target this pass was started with, if any (for status reporting). */
  target?: number;
  /** The module run this pass is registered under, when a route registered one. */
  runId?: string;
}

const g = globalThis as unknown as { __agentosBrief?: BriefJob };
const job: BriefJob = (g.__agentosBrief ??= {
  running: false, total: 0, done: 0, succeeded: 0, failed: 0,
  startedAt: 0, finishedAt: null, error: null,
});

export function briefBatchStatus(): BriefJob {
  return { ...job };
}

export interface BriefBatchOpts {
  source?: string;
  limit?: number;
  /**
   * Top-up mode: brief only enough leads to get `target` ANALYSED feed cards sitting in
   * New. This is what "Clear passed & refill" wants — reviewing 5 leads should pull in
   * 5 more, not another full batch of 20 on top of the ones already waiting.
   */
  target?: number;
}

export type BriefBatchPlan =
  | { ok: true; targets: Deal[] }
  | { ok: false; total: number; reason: "already running" | "queue already full" | "nothing to brief" };

/**
 * Pick the leads a pass would brief, best-scoring first. Pure selection: nothing
 * starts here. Never throws for "nothing to do"; that is a normal outcome when
 * every lead already has a brief.
 */
export async function planBriefBatch(opts?: BriefBatchOpts): Promise<BriefBatchPlan> {
  if (job.running) return { ok: false, total: job.total, reason: "already running" };

  const all = await listDeals();
  const feedOnly = (d: { source?: string }) => (opts?.source ? (d.source || "upwork") === opts.source : true);
  const pool0 = all.filter(feedOnly);

  let limit: number;
  if (opts?.target != null) {
    // Only count cards in the live review queue — approved/sent leads have left it.
    const analysedInNew = pool0.filter((d) => d.status === "new" && d.summary).length;
    limit = Math.max(0, opts.target - analysedInNew);
    if (limit === 0) return { ok: false, total: 0, reason: "queue already full" };
  } else {
    limit = Math.max(1, Math.min(100, opts?.limit ?? DEFAULT_LIMIT));
  }

  const targets = pool0
    .filter((d) => !d.summary)
    // Best-scoring first. Briefing 250 leads indiscriminately would cost 16 minutes to
    // analyse a queue nobody can review anyway — the shortlist is the point.
    .sort((a, b) => b.composite - a.composite)
    .slice(0, limit);

  if (!targets.length) return { ok: false, total: 0, reason: "nothing to brief" };
  return { ok: true, targets };
}

/**
 * Work a planned pass to the end. Owns the job state for its whole life. The
 * signal ends the pass early: leads not yet started are left un-briefed (they
 * are picked up by the next pass), the claude children in flight are killed
 * through generateBrief, and the job records "stopped".
 */
export async function runBriefBatch(targets: Deal[], opts: {
  target?: number;
  runId?: string;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  log?: (text: string) => void;
} = {}): Promise<void> {
  // planBriefBatch checked this, but two POSTs can plan in the same tick.
  if (job.running) throw new Error("A brief pass is already running.");
  Object.assign(job, {
    running: true, total: targets.length, done: 0, succeeded: 0, failed: 0,
    startedAt: Date.now(), finishedAt: null, error: null, target: opts.target, runId: opts.runId,
  });
  opts.log?.(`briefing ${targets.length} leads, ${CONCURRENCY} at a time`);
  try {
    await pool(targets, CONCURRENCY, async (deal) => {
      if (opts.signal?.aborted) return; // do not start another lead after STOP
      try {
        const brief = await generateBrief(deal, opts.signal);
        if (brief) { await setBrief(deal.id, brief); job.succeeded++; opts.log?.(`briefed: ${deal.title}`); }
        else { job.failed++; opts.log?.(`no usable brief: ${deal.title}`); }
      } catch {
        // One bad lead must not abort the pass.
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

/**
 * Start a brief pass over unanalysed leads, best-scoring first.
 * Returns immediately — callers poll briefBatchStatus(). Never throws for "nothing to
 * do"; that is a normal outcome when every lead already has a brief.
 */
export async function startBriefBatch(opts?: BriefBatchOpts): Promise<{ started: boolean; total: number; reason?: string }> {
  const plan = await planBriefBatch(opts);
  if (!plan.ok) return { started: false, total: plan.total, reason: plan.reason };
  // Deliberately not awaited; the job state carries the outcome.
  void runBriefBatch(plan.targets, { target: opts?.target }).catch(() => {});
  return { started: true, total: plan.targets.length };
}
