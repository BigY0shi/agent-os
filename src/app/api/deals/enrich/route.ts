import { listDeals, setEnrichment, LEADS_DIR } from "@/lib/upworkDesk";
import { readUpworkCookie } from "@/lib/upworkAuth";
import { spawn } from "node:child_process";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CAP = 10; // ban-risk guard: never authenticate-hit more than this per run

// POST { ids?: string[] } → enrich approved deals (or the given ids), shortlist-only.
export async function POST(req: Request) {
  const { ids } = (await req.json().catch(() => ({}))) as { ids?: string[] };
  const cookie = readUpworkCookie();
  if (!cookie) {
    return Response.json({ ok: false, error: "No Upwork cookie saved — add it in Deal Desk settings (gear)." }, { status: 400 });
  }

  const deals = await listDeals();
  const pool = (ids?.length ? deals.filter((d) => ids.includes(d.id)) : deals.filter((d) => d.status === "approved"))
    .filter((d) => !d.source); // enrichment is Upwork-only; remote-feed leads have no Upwork proposal data
  const targets = pool.map((d) => ({ id: d.id, url: d.url })).slice(0, CAP);
  if (!targets.length) {
    return Response.json({ ok: false, error: "No approved Upwork deals to enrich — approve some Upwork cards first." }, { status: 400 });
  }

  const stamp = Date.now();
  const tmpIn = path.join(os.tmpdir(), `enrich-${stamp}.json`);
  const tmpOut = path.join(os.tmpdir(), `enrich-${stamp}-out.json`);
  await writeFile(tmpIn, JSON.stringify(targets));

  const actorDir = path.join(LEADS_DIR, "actor");
  const script = path.join(actorDir, "enrich.mjs");

  const res = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [script, tmpIn, tmpOut], {
      cwd: actorDir,
      env: { ...process.env, UPWORK_COOKIE: cookie }, // secret via env, never argv
    });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => resolve({ code, stderr }));
    child.on("error", (e) => resolve({ code: -1, stderr: String(e) }));
  });

  type EnrichRow = { id: string; proposals?: string | null; paymentVerified?: boolean; hireRate?: number | null; error?: string };
  let out: EnrichRow[] = [];
  try { out = JSON.parse(await readFile(tmpOut, "utf8")) as EnrichRow[]; } catch { /* none */ }

  let enriched = 0;
  let stopped: string | null = null;
  for (const r of out) {
    if (r.error === "captcha" || r.error === "login") { stopped = r.error; continue; }
    if (r.error) continue;
    await setEnrichment(r.id, {
      proposals: r.proposals ?? null,
      paymentVerified: r.paymentVerified ?? null,
      hireRate: r.hireRate ?? null,
    });
    enriched++;
  }

  if (!out.length && res.code !== 0) {
    return Response.json({ ok: false, error: `Enrichment failed: ${res.stderr.slice(-300) || "no output"}` }, { status: 502 });
  }
  return Response.json({ ok: true, enriched, attempted: targets.length, stopped });
}
