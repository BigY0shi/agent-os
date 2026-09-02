// Deal Desk and Hire Engine -> Memory V2.
//
// Both desks are V1 modules that predate the memory seam, so until now nothing
// either of them knew was recallable: every ingest writer in the codebase was a
// V2 module, and the two surfaces carrying the most human judgment wrote nothing
// at all. This is the wiring, through the one cross-module seam
// (ingestFromModule, CONVENTIONS section 4).
//
// What earns an episode, and what deliberately does not:
//
//   recorded  a judgment status - approved, denied, sent, parked - with the
//             note attached. The call plus the reason is the part that cannot be
//             regenerated from the listing.
//   recorded  a generated proposal or outreach pitch.
//   recorded  a Q&A answer about a specific listing.
//
//   skipped   triage motion: new, reviewing, researching, dismissed. Refill
//             auto-dismisses in bulk, and recording that would bury the signal
//             under the noise it exists to filter.
//   skipped   `ready`, which is a staging step between approved and sent. Both
//             ends of that move are already recorded; the middle would treble
//             one deal's episodes without adding a fact.
//   skipped   briefs. brief-batch runs one pass per un-briefed card, so a fresh
//             248-card board would enqueue 248 near-identical episodes on one
//             click, and a brief is regenerable from the listing in a way that a
//             decision and a pitch are not. One line here if that changes.
//
// Failure never breaks the desk. By the time any of this runs the card is
// already saved, so an ingest failure is logged loudly and swallowed - the same
// bargain anynotes/ingest.ts makes, for the same reason.

import { ingestFromModule } from "./v2/memory/queue";

export type Desk = "deal-desk" | "hire-engine";

/** The minimum a desk has to hand over. Keeps this module ignorant of both. */
export interface DeskSubject {
  id: string;
  title: string;
  url?: string | null;
  /** One line of who and what: budget, client, company, salary. */
  context?: string | null;
}

const DESK_LABEL: Record<Desk, string> = {
  "deal-desk": "Deal Desk",
  "hire-engine": "Hire Engine",
};

// Judgment statuses per desk. Deal Desk also has new/reviewing/ready/dismissed
// and Hire Engine new/researching/dismissed; those are motion, not decisions.
const JUDGMENT: Record<Desk, ReadonlySet<string>> = {
  "deal-desk": new Set(["approved", "denied", "sent", "parked"]),
  "hire-engine": new Set(["approved", "sent", "parked"]),
};

export function isJudgmentStatus(desk: Desk, status: string): boolean {
  return JUDGMENT[desk].has(status);
}

/**
 * Memory V2's ingest body schema rejects anything shorter than this.
 *
 * A backstop, not the real gate, and worth saying so: every body below is
 * wrapped in `Deal Desk: ... "title"`, which clears 20 characters on its own, so
 * this cannot fire from any current entry point. The checks that actually do the
 * work are the empty-content guards in each recordDesk* function. This stays for
 * a future builder that emits a barer body; smoke-desk-memory section E pins the
 * real behaviour so nobody mistakes one for the other.
 */
const MIN_EPISODE_CHARS = 20;

async function record(
  desk: Desk,
  kind: "decision" | "pitch" | "qa",
  subject: DeskSubject,
  body: string,
  extraLabels: string[] = [],
  extraMeta: Record<string, string | number | boolean> = {},
): Promise<void> {
  if (body.length < MIN_EPISODE_CHARS) return;
  try {
    await ingestFromModule({
      episodeBody: body,
      source: desk,
      sourceURL: subject.url || undefined,
      // Grouped per listing, so recall can pull one card's whole history the way
      // task-<uuid> does for a task.
      sessionId: `${desk}-${subject.id}`,
      labelNames: [desk, kind, ...extraLabels],
      metadata: { leadId: subject.id, title: subject.title.slice(0, 200), ...extraMeta },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${desk}/memory] ${kind} ingest FAILED for ${subject.id} (the card itself is saved):`, message);
  }
}

/** A deliberate call on a lead, with the operator's reason when they gave one. */
export async function recordDeskDecision(
  desk: Desk,
  subject: DeskSubject,
  status: string,
  notes?: string | null,
): Promise<void> {
  if (!isJudgmentStatus(desk, status)) return;
  const reason = (notes || "").trim();
  const body =
    `${DESK_LABEL[desk]}: ${status.toUpperCase()} "${subject.title}"` +
    (subject.context ? ` (${subject.context})` : "") +
    "." +
    (reason ? `\nReason given: ${reason}` : "\nNo reason recorded.");
  await record(desk, "decision", subject, body, [status], { status });
}

/** The proposal or outreach an agent actually wrote for this lead. */
export async function recordDeskPitch(desk: Desk, subject: DeskSubject, pitch: string): Promise<void> {
  const text = (pitch || "").trim();
  if (!text) return;
  const body =
    `${DESK_LABEL[desk]}: drafted an outreach pitch for "${subject.title}"` +
    (subject.context ? ` (${subject.context})` : "") +
    `.\n\n${text}`;
  await record(desk, "pitch", subject, body);
}

/** A question asked about one listing, and the answer that came back. */
export async function recordDeskQA(
  desk: Desk,
  subject: DeskSubject,
  question: string,
  answer: string,
): Promise<void> {
  const q = (question || "").trim();
  const a = (answer || "").trim();
  if (!q || !a) return;
  const body =
    `${DESK_LABEL[desk]}: question about "${subject.title}"` +
    (subject.context ? ` (${subject.context})` : "") +
    `.\nQ: ${q}\nA: ${a}`;
  await record(desk, "qa", subject, body);
}

// ---------------------------------------------------------------------------
// Subject builders
//
// Type-only imports, so this stays a leaf module at runtime and neither desk
// gains a dependency on the other. The context line is the one-glance "who and
// what" that makes an episode legible a month later, when "approved that CRM
// one" is no longer a thing anyone remembers.
// ---------------------------------------------------------------------------

import type { Deal } from "./upworkDesk";
import type { HireLead } from "./hireDesk";

export function dealSubject(d: Deal): DeskSubject {
  const bits = [
    d.budget,
    d.jobType,
    d.clientCountry ? `client ${d.clientCountry}` : null,
    typeof d.clientTotalSpent === "number" ? `$${d.clientTotalSpent} spent` : null,
  ].filter(Boolean);
  return { id: d.id, title: d.title, url: d.url, context: bits.length ? bits.join(", ") : null };
}

export function hireSubject(l: HireLead): DeskSubject {
  const bits = [l.company, l.employment, l.salary, l.location].filter(Boolean);
  return { id: l.id, title: l.title, url: l.url, context: bits.length ? bits.join(", ") : null };
}
