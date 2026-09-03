import { listDeals } from "@/lib/upworkDesk";
import { readUpworkCookie } from "@/lib/upworkAuth";
import { runEnrichment, ENRICH_CAP } from "@/lib/dealEnrich";
import { startModuleRun } from "@/lib/moduleRuns";
import { runErrorResponse } from "@/lib/runRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// POST { ids?: string[] } -> the gated enrichment (S4 d) over the approved Upwork
// cards, or the given ids. Registered as a module run so the tray shows it and
// STOP kills the browser child. Supersedes /api/deals/enrich, which is left in
// place (it was in the owner's working set on 2026-09-02) and still works, but
// does not flag cards or stop at the wall the way the owner asked.
export async function POST(req: Request) {
  const { ids } = (await req.json().catch(() => ({}))) as { ids?: string[] };
  const cookie = readUpworkCookie();
  if (!cookie) {
    return Response.json({ ok: false, error: "No Upwork cookie saved - add it in Deal Desk (cookie button).", needsCookie: true }, { status: 400 });
  }

  const deals = await listDeals();
  const pool = (ids?.length ? deals.filter((d) => ids.includes(d.id)) : deals.filter((d) => d.status === "approved"))
    .filter((d) => !d.source); // Upwork-only; feed leads have no Upwork proposal data
  const targets = pool.map((d) => ({ id: d.id, url: d.url })).slice(0, ENRICH_CAP);
  if (!targets.length) {
    return Response.json({ ok: false, error: "No approved Upwork deals to enrich - approve some Upwork cards first." }, { status: 400 });
  }

  const run = startModuleRun(
    { module: "deals", label: `Enrich: ${targets.length} approved card${targets.length === 1 ? "" : "s"}`, href: "/deals" },
    (ctx) => runEnrichment(targets, { cookie, signal: ctx.signal, log: ctx.log }),
    { summarize: (o) => ({ enriched: o.enriched, attempted: o.attempted, stopped: o.stopped, needsLogin: o.needsLogin.length }) },
  );
  try {
    const o = await run.promise;
    if (!o.enriched && !o.stopped && o.exitCode !== 0) {
      return Response.json({ ok: false, error: `Enrichment failed: ${o.stderrTail || "no output"}`, runId: run.id }, { status: 502 });
    }
    return Response.json({ ok: true, enriched: o.enriched, attempted: o.attempted, stopped: o.stopped, needsLogin: o.needsLogin, errors: o.errors, runId: run.id });
  } catch (e) {
    return runErrorResponse(e, run.id);
  }
}
