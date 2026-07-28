// Hire Engine — bulk brief + pitch jobs, the Deal Desk briefBatch pattern applied
// to hire leads. The user's complaint that forced this (2026-07-28): "no proposal
// pitches, no summaries, no crash course" — everything existed, but only behind
// per-card buttons, and nobody clicks 60 buttons. So:
//
//   BRIEF pass — runs at scan-time (and on demand): analyses the best-scoring
//   un-briefed leads so cards arrive with summary/why/approach/crashCourse.
//   PITCH pass — runs after "Enrich approved": writes the outreach for enriched
//   approved leads, because pitch quality depends on the firmographics verdict
//   (a pitch sized for an SMB is wrong for an enterprise).
//
// Job state lives on globalThis — route handlers are stateless, this work is not.

import { listHireLeads, setHireBrief, setHirePitch, setHireTriages } from "./hireDesk";
import { generateHireBrief, generateHirePitch, triageHireLeads } from "./hireBrief";
import { pool } from "./dealBrief";

// ~18s per brief; 3 at a time avoids stacking claude processes on top of the
// pitch pass that may follow.
const CONCURRENCY = 3;

export interface HireJob {
  running: boolean;
  /** Which stage the brief job is in — "triage" (cheap sweep) or "brief" (full monty). */
  phase?: "triage" | "brief";
  /** How many leads the triage stage judged this pass, and how many it marked pursue. */
  triaged?: number;
  pursued?: number;
  total: number;
  done: number;
  succeeded: number;
  failed: number;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
}

function freshJob(): HireJob {
  return { running: false, total: 0, done: 0, succeeded: 0, failed: 0, startedAt: 0, finishedAt: null, error: null };
}

const g = globalThis as unknown as { __agentosHireBrief?: HireJob; __agentosHirePitch?: HireJob };
const briefJob: HireJob = (g.__agentosHireBrief ??= freshJob());
const pitchJob: HireJob = (g.__agentosHirePitch ??= freshJob());

export function hireBatchStatus(): { brief: HireJob; pitch: HireJob } {
  return { brief: { ...briefJob }, pitch: { ...pitchJob } };
}

/**
 * Two-stage analysis over the WHOLE board (user decision 2026-07-28):
 *   1. TRIAGE — a cheap batched haiku sweep over every un-judged lead in play:
 *      pursue or skip, one sentence why. Every card gets a verdict.
 *   2. BRIEF  — the expensive full analysis (summary/why/approach/crashCourse,
 *      opus) runs ONLY on the pursue pile. Skips keep their reason on the card
 *      and can be overruled per-card in the drawer.
 * Returns immediately; poll hireBatchStatus().
 */
export async function startHireBriefBatch(): Promise<{ started: boolean; total: number; reason?: string }> {
  if (briefJob.running) return { started: false, total: briefJob.total, reason: "already running" };

  const leads = await listHireLeads();
  // Passed/parked leads are out of the review loop; sent ones are done.
  const inPlay = leads.filter((l) => ["new", "researching", "approved"].includes(l.status));
  const toTriage = inPlay.filter((l) => !l.triage && !l.summary);
  // Pursue verdicts from this or any earlier pass that still lack the full monty.
  const preApproved = inPlay.filter((l) => !l.summary && l.triage?.pursue);

  if (!toTriage.length && !preApproved.length) return { started: false, total: 0, reason: "nothing to analyse" };

  Object.assign(briefJob, {
    ...freshJob(), running: true, phase: "triage" as const,
    triaged: 0, pursued: 0, total: 0, startedAt: Date.now(),
  });

  // Deliberately not awaited.
  void (async () => {
    try {
      // ---- stage 1: cheap sweep over everything un-judged --------------------
      let pursued = [...preApproved];
      if (toTriage.length) {
        const verdicts = await triageHireLeads(toTriage);
        await setHireTriages(verdicts);
        briefJob.triaged = Object.keys(verdicts).length;
        pursued = pursued.concat(toTriage.filter((l) => verdicts[l.id]?.pursue));
      }
      pursued.sort((a, b) => b.composite - a.composite);
      briefJob.pursued = pursued.length;

      // ---- stage 2: full monty, pursue pile only -----------------------------
      briefJob.phase = "brief";
      briefJob.total = pursued.length;
      await pool(pursued, CONCURRENCY, async (lead) => {
        try {
          const brief = await generateHireBrief(lead);
          if ("error" in brief) briefJob.failed++;
          else { await setHireBrief(lead.id, brief); briefJob.succeeded++; }
        } catch {
          briefJob.failed++; // one bad lead must not abort the pass
        } finally {
          briefJob.done++;
        }
      });
    } catch (e) {
      briefJob.error = e instanceof Error ? e.message : String(e);
    } finally {
      briefJob.running = false;
      briefJob.finishedAt = Date.now();
    }
  })();

  return { started: true, total: toTriage.length + preApproved.length };
}

/**
 * Pitch approved leads that have firmographics but no outreach yet. Called by the
 * enrich route right after enrichment lands, optionally scoped to the ids it
 * just enriched.
 */
export async function startHirePitchBatch(ids?: string[]): Promise<{ started: boolean; total: number; reason?: string }> {
  if (pitchJob.running) return { started: false, total: pitchJob.total, reason: "already running" };

  const leads = await listHireLeads();
  const targets = leads
    .filter((l) => l.status === "approved" && !l.pitch && l.firmo && !l.firmo.error)
    .filter((l) => (ids?.length ? ids.includes(l.id) : true))
    .sort((a, b) => b.composite - a.composite)
    .slice(0, 20);

  if (!targets.length) return { started: false, total: 0, reason: "nothing to pitch" };

  Object.assign(pitchJob, { ...freshJob(), running: true, total: targets.length, startedAt: Date.now() });

  void (async () => {
    try {
      await pool(targets, CONCURRENCY, async (lead) => {
        try {
          const res = await generateHirePitch(lead);
          if ("error" in res) pitchJob.failed++;
          else { await setHirePitch(lead.id, res.pitch, res.read); pitchJob.succeeded++; }
        } catch {
          pitchJob.failed++;
        } finally {
          pitchJob.done++;
        }
      });
    } catch (e) {
      pitchJob.error = e instanceof Error ? e.message : String(e);
    } finally {
      pitchJob.running = false;
      pitchJob.finishedAt = Date.now();
    }
  })();

  return { started: true, total: targets.length };
}
