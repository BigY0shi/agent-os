import { LEADS_DIR } from "@/lib/upworkDesk";
import { startBriefBatch } from "@/lib/briefBatch";
import { spawn } from "node:child_process";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST → refresh remote gig feeds (RemoteOK / WWR / Reddit) into feeds.json.
export async function POST() {
  const script = path.join(LEADS_DIR, "feeds.mjs");
  const res = await new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
    const child = spawn(process.execPath, [script], { cwd: LEADS_DIR, env: process.env });
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("close", (code) => resolve({ code, out, err }));
    child.on("error", (e) => resolve({ code: -1, out: "", err: String(e) }));
  });
  let stats: { relevant?: number; bySource?: Record<string, number> } = {};
  try { stats = JSON.parse(res.out.trim().split("\n").pop() || "{}"); } catch { /* */ }
  if (res.code !== 0 && stats.relevant == null) {
    return Response.json({ ok: false, error: res.err.slice(-300) || "feed pull failed" }, { status: 502 });
  }

  // Analyse before review, not after. Upwork leads arrive pre-pitched (scrape → score →
  // shortlist → pitch), so every Upwork card is already reviewable. Feed leads had no
  // equivalent and landed in New with empty summary/why/approach. Kick off a brief pass
  // over the best-scoring unanalysed leads now — NOT awaited, because it runs for
  // minutes and this response should return as soon as the pull is done.
  const brief = await startBriefBatch();

  return Response.json({
    ok: true,
    relevant: stats.relevant ?? 0,
    bySource: stats.bySource ?? {},
    briefing: brief.started ? brief.total : 0,
  });
}
