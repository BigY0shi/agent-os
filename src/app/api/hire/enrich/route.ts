import { listHireLeads, setHireFirmo, sizeFit, type Firmo } from "@/lib/hireDesk";
import { startHirePitchBatch } from "@/lib/hireBatch";
import { startModuleRun } from "@/lib/moduleRuns";
import { runErrorResponse } from "@/lib/runRoute";
import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST { ids?: string[] } → firmographics for approved leads.
//
// WHY THIS IS A SEPARATE, MANUAL STEP rather than part of the scrape: the job boards
// give a company NAME and nothing else, so a 12-person shop and a public enterprise
// posting the same $40k support role score identically. Size is the signal that
// separates them — and it is the one that decides whether the offer is even coherent.
// Looking it up costs two Hunter calls per lead, so it runs only on the handful you
// have approved, exactly like Deal Desk's "enrich approved".
//
// Chain (verified 2026-07-27):
//   1. domain-search?company=<name>  → domain (+ sometimes a contact email)
//   2. companies/find?domain=<domain> → headcount band, public/private, founded
// companies/find will NOT accept a company name, hence the two hops.

const CAP = 10;              // credit guard, mirrors the Deal Desk enrich cap
const CONCURRENCY = 3;

function keyPath() {
  return path.join(os.homedir(), ".agentic-os", "outreach", "config.json");
}

async function hunterKey(): Promise<string | null> {
  if (process.env.HUNTER_API_KEY) return process.env.HUNTER_API_KEY.trim();
  try {
    const cfg = JSON.parse(await readFile(keyPath(), "utf8")) as { hunterKey?: string };
    return cfg.hunterKey?.trim() || null;
  } catch { return null; }
}

async function getJson(url: string, signal: AbortSignal) {
  // The per-call timeout and the run's STOP both end the fetch.
  const r = await fetch(url, { signal: AbortSignal.any([AbortSignal.timeout(20_000), signal]) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j } as { ok: boolean; status: number; j: Record<string, unknown> };
}

/**
 * Hunter's name→domain match is fuzzy: "FSE LLC" resolved to fse.co.th, a Thai company
 * with no relation to the poster. A confidently-wrong headcount is worse than none, so
 * compare what we asked for against what came back and flag a weak match rather than
 * silently trusting it.
 */
function nameMatches(asked: string, got: string | undefined, domain: string | undefined): { ok: boolean; weak: boolean } {
  const norm = (x: string) => x.toLowerCase()
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|bv|plc|group|holdings|the)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
  const a = norm(asked);
  if (!a) return { ok: false, weak: false };
  const candidates = [got ?? "", (domain ?? "").split(".")[0] ?? ""].map(norm).filter(Boolean);
  // Substring either way covers "Zapier" vs "Zapier Inc"; the length guard stops
  // two-letter accidents from counting as a match.
  const ok = candidates.some((c) => c.length >= 3 && (c.includes(a) || a.includes(c)));
  // A short name is an acronym, and acronyms collide across unrelated companies —
  // "FSE LLC" matched fse.co.th, a Thai firm, and no string comparison can tell those
  // apart. Matching is not the same as being right, so say so.
  return { ok, weak: ok && a.length <= 4 };
}

async function lookup(company: string, key: string, signal: AbortSignal): Promise<Firmo> {
  // 1. name → domain
  const ds = await getJson(`https://api.hunter.io/v2/domain-search?company=${encodeURIComponent(company)}&limit=1&api_key=${key}`, signal);
  if (!ds.ok) {
    const err = (ds.j.errors as { details?: string }[] | undefined)?.[0]?.details;
    return { error: `domain lookup failed (${ds.status})${err ? `: ${err}` : ""}` };
  }
  const d = (ds.j.data ?? {}) as { domain?: string; organization?: string; emails?: { value?: string }[] };
  if (!d.domain) return { error: "no domain found for that company name" };
  const email = d.emails?.[0]?.value;

  const match = nameMatches(company, d.organization, d.domain);
  if (!match.ok) {
    // Return the domain so it can be eyeballed, but refuse to attach a size verdict
    // to a company we are not confident is the right one.
    return {
      domain: d.domain, email,
      error: `matched "${d.organization ?? d.domain}" — probably the wrong company, verify the domain before trusting this`,
    };
  }

  // 2. domain → firmographics
  const cf = await getJson(`https://api.hunter.io/v2/companies/find?domain=${encodeURIComponent(d.domain)}&api_key=${key}`, signal);
  if (!cf.ok) {
    // Partial success is still useful — we at least resolved the domain.
    return { domain: d.domain, email, ...sizeFit({}), error: `firmographics failed (${cf.status})` };
  }
  const c = (cf.j.data ?? {}) as {
    type?: string; foundedYear?: number; metrics?: { employees?: string };
  };
  const base = { employees: c.metrics?.employees, type: c.type };
  const verdict = sizeFit(base);
  return {
    domain: d.domain, email, foundedYear: c.foundedYear, ...base, ...verdict,
    ...(match.weak
      ? { fitWhy: `${verdict.fitWhy} NOTE: "${company}" is a short name and may have matched the wrong company (${d.domain}) — check the domain before sending.` }
      : {}),
  };
}

export async function POST(req: Request) {
  const { ids } = await req.json().catch(() => ({})) as { ids?: string[] };
  const key = await hunterKey();
  if (!key) {
    return Response.json({ ok: false, error: `No Hunter key found. Set HUNTER_API_KEY, or hunterKey in ${keyPath()}.` }, { status: 400 });
  }

  const leads = await listHireLeads();
  const pool = ids?.length
    ? leads.filter((l) => ids.includes(l.id))
    // Re-enriching what we already know is a waste of credits.
    : leads.filter((l) => l.status === "approved" && !l.firmo);
  const targets = pool.filter((l) => l.company).slice(0, CAP);

  if (!targets.length) {
    return Response.json({
      ok: false,
      error: "No approved leads left to enrich. Approve some cards first (already-enriched ones are skipped).",
    }, { status: 400 });
  }

  // Registered as a module run (roadmap S2 backlog): the tray shows a lead
  // counter and STOP ends the Hunter calls through ctx.signal (leads not yet
  // looked up stay un-enriched; a stopped lead is not written as "failed").
  // The run log names companies and verdicts, never the key or the emails.
  const run = startModuleRun(
    { module: "hire", label: `Enrich: ${targets.length} approved lead${targets.length === 1 ? "" : "s"}`, href: "/hire" },
    async (ctx) => {
      let done = 0, failed = 0;
      const results: { id: string; company: string | null; fit?: string; employees?: string; error?: string }[] = [];

      // Small pool: Hunter rate-limits, and this is at most 10 leads.
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
        while (next < targets.length && !ctx.signal.aborted) {
          const l = targets[next++];
          try {
            const firmo = await lookup(l.company as string, key, ctx.signal);
            await setHireFirmo(l.id, firmo);
            if (firmo.error) failed++; else done++;
            results.push({ id: l.id, company: l.company, fit: firmo.fit, employees: firmo.employees, error: firmo.error });
            ctx.log(`${l.company}: ${firmo.error ?? firmo.fit ?? "resolved"}`);
          } catch (e) {
            if (ctx.signal.aborted) throw e; // a STOP is not a lookup failure; leave the lead untouched
            failed++;
            const msg = e instanceof Error ? e.message : String(e);
            await setHireFirmo(l.id, { error: msg });
            results.push({ id: l.id, company: l.company, error: msg });
            ctx.log(`${l.company}: ${msg}`);
          } finally {
            ctx.progress(done + failed, targets.length);
          }
        }
      }));
      if (ctx.signal.aborted) throw new Error("enrichment stopped");

      // Enrichment is exactly the input the pitch needs (size verdict decides the
      // framing), so chain the outreach pass for what just landed — the approved
      // column fills with pitches without another button.
      const pitch = await startHirePitchBatch(targets.map((l) => l.id));
      ctx.log(pitch.started ? `pitch pass started for ${pitch.total}` : `pitch pass not started: ${pitch.reason ?? "unknown"}`);

      return {
        enriched: done, failed,
        skipped: Math.max(0, pool.length - targets.length),
        pitching: pitch.started ? pitch.total : 0,
        results,
      };
    },
    { summarize: (r) => ({ enriched: r.enriched, failed: r.failed, pitching: r.pitching }) },
  );
  try {
    const r = await run.promise;
    return Response.json({ ok: true, ...r, runId: run.id });
  } catch (e) {
    return runErrorResponse(e, run.id);
  }
}
