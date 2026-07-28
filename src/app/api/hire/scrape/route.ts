import { LEADS_DIR } from "@/lib/hireDesk";
import { startHireBriefBatch } from "@/lib/hireBatch";
import { spawn } from "node:child_process";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST → re-run hire.mjs, refreshing hire-candidates.json.
//
// Unlike the Upwork scrape this is fast (three public JSON APIs, ~30s, no browser and
// no account needed) so it can stay synchronous. Sources: remotive, jobicy, himalayas.
export async function POST() {
  const script = path.join(LEADS_DIR, "hire.mjs");
  const res = await new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
    const child = spawn(process.execPath, [script], { cwd: LEADS_DIR, env: process.env });
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("close", (code) => resolve({ code, out, err }));
    child.on("error", (e) => resolve({ code: -1, out: "", err: String(e) }));
  });

  // hire.mjs prints one JSON summary line last.
  let stats: { raw?: number; candidates?: number; byMachine?: Record<string, number> } = {};
  try { stats = JSON.parse(res.out.trim().split("\n").pop() || "{}"); } catch { /* fall through */ }

  if (res.code !== 0 && stats.candidates == null) {
    return Response.json({ ok: false, error: res.err.slice(-300) || "hire scan failed" }, { status: 502 });
  }

  // Deal-Desk parity: a scan kicks off the brief pass so cards arrive analysed
  // (summary/why/approach/crashCourse) instead of waiting on per-card buttons.
  const brief = await startHireBriefBatch();

  return Response.json({
    ok: true,
    raw: stats.raw ?? 0,
    candidates: stats.candidates ?? 0,
    byMachine: stats.byMachine ?? {},
    briefing: brief.started ? brief.total : 0,
  });
}
