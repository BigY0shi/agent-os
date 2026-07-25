import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { getSites } from "@/lib/seoPipeline";
import { pythonBin } from "@/lib/platform";

const pexec = promisify(execFile);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Research tab runs live, read-only Google Search Console keyword research via the
// same cached OAuth token the keyword-research skill uses (~/.agentic-os/gsc-*).
const AOS = path.join(os.homedir(), ".agentic-os");
const SCRIPT = path.join(AOS, "gsc-research.py");
const TOKEN = path.join(AOS, "gsc-token.json");
const LATEST = path.join(AOS, "gsc-latest.json");
// Was hardcoded to "/usr/bin/python3" (macOS absolute path) — guaranteed ENOENT on
// Windows, so GSC research could never run. Resolved per-platform instead.
const PY = pythonBin() ?? "python";
// The user's own sites (from the SEO config menu) as bare domains — the fallback when
// the fresh GSC pull isn't cached yet. No hardcoded sites.
function knownSites(): string[] {
  return getSites().map((s) => s.url.replace(/^https?:\/\//, "").replace(/\/+$/, "")).filter(Boolean);
}

// GET → connection status + the verified GSC properties (from the fresh cached pull).
export async function GET() {
  let sites = knownSites();
  try {
    if (existsSync(LATEST)) {
      const keys = Object.keys(JSON.parse(readFileSync(LATEST, "utf8")));
      if (keys.length) sites = keys;
    }
  } catch { /* fall back to the known set */ }
  return Response.json(
    { connected: existsSync(TOKEN), hasScript: existsSync(SCRIPT), sites },
    { headers: { "cache-control": "no-store" } },
  );
}

// POST {site, days, seed} → live GSC research + scored opportunities.
export async function POST(req: Request) {
  if (!existsSync(SCRIPT)) return Response.json({ error: "research script missing" }, { status: 500 });
  const { site, days, seed } = await req.json().catch(() => ({}));
  if (!site || typeof site !== "string" || !/^[a-z0-9.-]+$/i.test(site)) {
    return Response.json({ error: "bad site" }, { status: 400 });
  }
  const d = String(Math.min(Math.max(parseInt(String(days), 10) || 28, 7), 365));
  const args = [SCRIPT, site, d];
  if (seed && typeof seed === "string") {
    for (const w of seed.slice(0, 80).split(/\s+/).filter(Boolean).slice(0, 8)) args.push(w);
  }
  try {
    const { stdout } = await pexec(PY, args, {
      timeout: 90_000,
      maxBuffer: 12 * 1024 * 1024,
      env: { ...process.env, PYTHONWARNINGS: "ignore" },
    });
    const line = stdout.trim().split("\n").filter(Boolean).pop() || "{}";
    const data = JSON.parse(line);
    if (data.error) return Response.json(data, { status: 502, headers: { "cache-control": "no-store" } });
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  } catch (e: unknown) {
    const out = (e as { stdout?: string })?.stdout;
    let msg: string | null = null;
    if (out) { try { msg = JSON.parse(out.trim().split("\n").filter(Boolean).pop() || "{}").error ?? null; } catch { /* ignore */ } }
    return Response.json(
      { error: msg || "GSC research failed — run `python3 ~/.agentic-os/gsc-report.py` once to refresh auth." },
      { status: 502 },
    );
  }
}
