import { LEADS_DIR } from "@/lib/hireDesk";
import { startHireBriefBatch } from "@/lib/hireBatch";
import { startModuleRun } from "@/lib/moduleRuns";
import { HttpError, runErrorResponse } from "@/lib/runRoute";
import { spawn } from "node:child_process";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST → re-run hire.mjs, refreshing hire-candidates.json.
//
// Unlike the Upwork scrape this is fast (three public JSON APIs, ~30s, no browser and
// no account needed) so it can stay synchronous. Sources: remotive, jobicy, himalayas.
//
// Registered as a module run (roadmap S2 backlog) so the tray shows the scan and
// STOP kills the hire.mjs child through ctx.signal. Same await, same codes.
export async function POST() {
  const script = path.join(LEADS_DIR, "hire.mjs");
  const run = startModuleRun(
    { module: "hire", label: "Scan job boards: remotive, jobicy, himalayas", href: "/hire" },
    async (ctx) => {
      ctx.log("running hire.mjs");
      const res = await new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
        const child = spawn(process.execPath, [script], { cwd: LEADS_DIR, env: process.env });
        const onAbort = () => { try { child.kill(); } catch { /* already gone */ } };
        ctx.signal.addEventListener("abort", onAbort, { once: true });
        let out = "", err = "";
        child.stdout.on("data", (d) => { out += d.toString(); });
        child.stderr.on("data", (d) => { err += d.toString(); });
        child.on("close", (code) => { ctx.signal.removeEventListener("abort", onAbort); resolve({ code, out, err }); });
        child.on("error", (e) => { ctx.signal.removeEventListener("abort", onAbort); resolve({ code: -1, out: "", err: String(e) }); });
      });
      if (ctx.signal.aborted) throw new Error("scan stopped");

      // hire.mjs prints one JSON summary line last.
      let stats: { raw?: number; candidates?: number; byMachine?: Record<string, number> } = {};
      try { stats = JSON.parse(res.out.trim().split("\n").pop() || "{}"); } catch { /* fall through */ }

      if (res.code !== 0 && stats.candidates == null) {
        throw new HttpError(502, res.err.slice(-300) || "hire scan failed");
      }
      ctx.log(`${stats.candidates ?? 0} candidates from ${stats.raw ?? 0} raw postings`);

      // Deal-Desk parity: a scan kicks off the brief pass so cards arrive analysed
      // (summary/why/approach/crashCourse) instead of waiting on per-card buttons.
      const brief = await startHireBriefBatch();
      ctx.log(brief.started ? `brief pass started for ${brief.total}` : `brief pass not started: ${brief.reason ?? "unknown"}`);

      return {
        raw: stats.raw ?? 0,
        candidates: stats.candidates ?? 0,
        byMachine: stats.byMachine ?? {},
        briefing: brief.started ? brief.total : 0,
      };
    },
    { summarize: (r) => ({ raw: r.raw, candidates: r.candidates, briefing: r.briefing }) },
  );
  try {
    const r = await run.promise;
    return Response.json({ ok: true, ...r, runId: run.id });
  } catch (e) {
    return runErrorResponse(e, run.id);
  }
}
