import { LEADS_DIR } from "@/lib/upworkDesk";
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
  return Response.json({ ok: true, relevant: stats.relevant ?? 0, bySource: stats.bySource ?? {} });
}
