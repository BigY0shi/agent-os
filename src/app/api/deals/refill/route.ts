import { refillPlan, setStatus, LEADS_DIR } from "@/lib/upworkDesk";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { target?: number } → dismiss passed (parked/denied) leads, then pitch next-best so
// the NEW column reaches `target`, forcing the fresh picks into New so they actually show.
export async function POST(req: Request) {
  const { target } = (await req.json().catch(() => ({}))) as { target?: number };
  const t = Math.min(40, Math.max(5, target ?? 20));

  try {
    const { toDismiss, toPitch, newCount } = await refillPlan(t);

    // 1) dismiss the passed/rejected leads (parked + denied)
    for (const id of toDismiss) await setStatus(id, "dismissed");

    // 2) pitch the next-best to fill New up to target (pitch.mjs merges into pitches.json)
    let pitched = 0;
    let pitchError: string | null = null;
    if (toPitch.length) {
      const idsFile = path.join(os.tmpdir(), `refill-${Date.now()}.json`);
      await writeFile(idsFile, JSON.stringify(toPitch));
      const res = await new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
        const child = spawn(process.execPath, [path.join(LEADS_DIR, "pitch.mjs"), idsFile], {
          cwd: LEADS_DIR,
          env: process.env,
        });
        let out = "", err = "";
        child.stdout.on("data", (d) => { out += d.toString(); });
        child.stderr.on("data", (d) => { err += d.toString(); });
        child.on("close", (code) => resolve({ code, out, err }));
        child.on("error", (e) => resolve({ code: -1, out: "", err: String(e) }));
      });
      try { pitched = JSON.parse(res.out.trim().split("\n").pop() || "{}").pitched ?? 0; } catch { /* */ }
      if (res.code !== 0 && !pitched) pitchError = res.err.slice(-300) || "pitch step failed";

      // 3) force the freshly-pitched leads into the New column (override fit≤3 auto-park),
      //    so they always show up in the queue and count toward `target`.
      for (const id of toPitch) await setStatus(id, "new");
    }

    return Response.json({ ok: true, dismissed: toDismiss.length, pitched, newBefore: newCount, target: t, pitchError });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
