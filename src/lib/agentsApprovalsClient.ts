/**
 * Client helper for resolving approval cards.
 *
 * Every approval surface used to do the same fire-and-forget POST: drop the card
 * optimistically, `.catch(() => {})`, never look at the reply. That made three
 * very different outcomes look identical to the person clicking — the run
 * resumed, the run was already dead, or the request never arrived. During the
 * 2026-08-29 duplicate-server incident that was the difference between "my
 * approval did nothing" and a diagnosis.
 *
 * The API already answers honestly with { ok, stale }. This just stops throwing
 * the answer away.
 */

export interface DecisionOutcome {
  /** The server found the live run and resolved it. */
  ok: boolean;
  /** The card was real, but its run is gone — ended, crashed, or restarted out
   *  from under it. The server has cleared the card. */
  stale: boolean;
  /** The request itself failed. Deliberately NOT folded into `stale`: one means
   *  the run vanished, the other means we never got to ask. */
  error?: string;
}

async function post(body: Record<string, unknown>): Promise<DecisionOutcome> {
  try {
    const r = await fetch("/api/agents/approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await r.json().catch(() => null)) as
      | { ok?: boolean; stale?: boolean; error?: string }
      | null;
    if (!r.ok) return { ok: false, stale: false, error: j?.error || `server said ${r.status}` };
    return { ok: !!j?.ok, stale: !!j?.stale };
  } catch {
    return { ok: false, stale: false, error: "could not reach the server" };
  }
}

export function postDecision(id: string, decision: "allow" | "deny"): Promise<DecisionOutcome> {
  return post({ id, decision });
}

export function postAnswer(id: string, answer: string): Promise<DecisionOutcome> {
  return post({ id, answer });
}

/** The one line worth showing a human, or null when it simply worked. */
export function decisionNotice(o: DecisionOutcome): string | null {
  if (o.ok) return null;
  if (o.error) return `That didn't go through — ${o.error}.`;
  if (o.stale) return "That run is already gone — it ended or was cut short by a restart. Card cleared.";
  return "That card could not be resolved.";
}
