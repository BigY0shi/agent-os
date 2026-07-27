// Lead brief generation — summary / why / approach / crashCourse for one deal.
//
// Upwork leads get these fields in BULK from the offline pitch pass (pitch.mjs →
// pitches.json). RemoteOK and WWR leads never go through it, so without this they
// stay blank forever. Shared by the single-card route and the batch route; the batch
// path is the one that matters, because clicking 248 cards individually is not a
// workflow.
import { run } from "@/lib/runner";
import { CLAUDE_MODEL } from "@/lib/config";
import { claudeBuilderArgs } from "@/lib/agentPowers";
import { LEADS_DIR, type Brief, type Deal } from "@/lib/upworkDesk";

export function briefPrompt(deal: Deal): string {
  return (
    "You are the analyst for a RevOps / automation consultancy triaging inbound job leads.\n" +
    "Assess the listing below and return ONLY minified JSON — no prose, no code fences — with EXACTLY these keys:\n" +
    '{"summary":"...","why":"...","approach":"...","crashCourse":"..."}\n\n' +
    "summary     — 1–2 sentences: what the client actually wants, in plain language.\n" +
    "why         — 1–2 sentences: why we are a credible fit, or honestly why we are not.\n" +
    "approach    — 3–5 short bullets separated by newlines: how we would deliver it.\n" +
    "crashCourse — 2–4 sentences on any unfamiliar tool/API named here, and the single biggest gotcha. Empty string if nothing is unfamiliar.\n\n" +
    "Be concrete and honest. If the listing is thin or a poor fit, say so plainly in `why` — a false positive costs more than a skipped lead.\n\n" +
    `SOURCE: ${deal.source || "upwork"}\n` +
    `LISTING: ${deal.title}\n` +
    `Budget: ${deal.budget ?? "?"} ${deal.jobType ?? ""} · ${deal.experienceLevel ?? ""}\n` +
    `Tags: ${(deal.tags || []).join(", ")}\n` +
    `Description: ${(deal.description || "").slice(0, 4000)}`
  );
}

/** Returns null on any failure — callers decide whether that is fatal. */
export async function generateBrief(deal: Deal, signal?: AbortSignal): Promise<Brief | null> {
  const r = await run(
    "claude",
    ["-p", "--model", CLAUDE_MODEL, "--output-format", "text", ...claudeBuilderArgs()],
    { timeoutMs: 180_000, input: briefPrompt(deal), cwd: LEADS_DIR, signal },
  );
  const out = (r.stdout || "").trim();
  if (!r.ok || !out) return null;

  // Agents wrap JSON in fences or preamble often enough that hard-failing would make
  // this feel broken. Take the outermost object.
  const m = out.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(m[0]); } catch { return null; }

  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const brief: Brief = {
    summary: str(parsed.summary), why: str(parsed.why),
    approach: str(parsed.approach), crashCourse: str(parsed.crashCourse),
  };
  // A brief with neither of the two headline fields is not worth persisting.
  return brief.summary || brief.why ? brief : null;
}

/**
 * Run `fn` over items with bounded concurrency.
 * Sequential would take 15s × N; unbounded would spawn N `claude` processes at once.
 */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
