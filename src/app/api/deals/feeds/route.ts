import { LEADS_DIR, pruneLeadsFileByAge } from "@/lib/upworkDesk";
import { startBriefBatch } from "@/lib/briefBatch";
import { startScreenBatch } from "@/lib/dealScreen";
import { clampMaxAgeDays } from "@/lib/dealDeskControl";
import { readSettings } from "@/lib/settings";
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

  // S4 (f): the feed was the source of the 3-4 week old listings. Gate it as it
  // lands, before the brief pass spends a claude call on each old row.
  const maxAgeDays = clampMaxAgeDays(readSettings().deals?.maxAgeDays);
  const aged = await pruneLeadsFileByAge("feeds", maxAgeDays);

  // Analyse before review, not after. Upwork leads arrive pre-pitched (scrape → score →
  // shortlist → pitch), so every Upwork card is already reviewable. Feed leads had no
  // equivalent and landed in New with empty summary/why/approach. Kick off a brief pass
  // over the best-scoring unanalysed leads now — NOT awaited, because it runs for
  // minutes and this response should return as soon as the pull is done.
  const brief = await startBriefBatch();

  // The brief pass covers the top 20 by composite. Everything under that cap used to
  // land unevaluated and get banded off the feed's keyword fit. The screen is the
  // cheap call that gives the rest a real call; leads it cannot judge stay NA.
  const settings = readSettings();
  const screen = settings.deals?.screenOnPull === false
    ? { started: false, total: 0 }
    : await startScreenBatch();

  return Response.json({
    ok: true,
    relevant: stats.relevant ?? 0,
    bySource: stats.bySource ?? {},
    briefing: brief.started ? brief.total : 0,
    screening: screen.started ? screen.total : 0,
    ageGate: { maxAgeDays, dropped: aged.dropped, kept: aged.kept, undated: aged.unknown },
  });
}
