import { listDeals } from "@/lib/upworkDesk";
import { readUpworkCookie } from "@/lib/upworkAuth";
import { parseIntakeUrls } from "@/lib/dealDeskControl";
import { runIntake } from "@/lib/dealIntake";
import { startModuleRun } from "@/lib/moduleRuns";
import { runErrorResponse } from "@/lib/runRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// POST { urls: string[] | string } -> pasted Upwork job URLs become cards through
// the normal scrape -> score -> pitch path (S4 a). Rejected URLs come back by
// name with the reason; listings already on the desk are skipped and named.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { urls?: string[] | string };
  const parsed = parseIntakeUrls(body.urls ?? "");
  if (!parsed.accepted.length) {
    return Response.json({ ok: false, error: "No Upwork job URLs to take in.", rejected: parsed.rejected }, { status: 400 });
  }

  const onDesk = new Set((await listDeals()).map((d) => d.id));
  const skipped = parsed.accepted.filter((t) => onDesk.has(t.id));
  const targets = parsed.accepted.filter((t) => !onDesk.has(t.id));
  if (!targets.length) {
    return Response.json({ ok: true, accepted: [], skipped, rejected: parsed.rejected, scraped: 0, pitched: 0, stopped: null, needsLogin: [], ids: [] });
  }

  const cookie = readUpworkCookie(); // optional: a public job page scrapes anonymously
  const run = startModuleRun(
    { module: "deals", label: `Intake: ${targets.length} pasted listing${targets.length === 1 ? "" : "s"}`, href: "/deals" },
    (ctx) => runIntake(targets, { cookie: cookie || undefined, signal: ctx.signal, log: ctx.log, progress: ctx.progress }),
    { summarize: (o) => ({ scraped: o.scraped, pitched: o.pitched, stopped: o.stopped, needsLogin: o.needsLogin.length }) },
  );
  try {
    const o = await run.promise;
    return Response.json({ ok: true, accepted: targets, skipped, rejected: parsed.rejected, ...o, runId: run.id });
  } catch (e) {
    return runErrorResponse(e, run.id);
  }
}
