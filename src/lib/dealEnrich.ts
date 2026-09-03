// Gated Upwork enrichment (roadmap S4 d).
//
// The actor's enrich.mjs visits each logged-in job page and reads proposals /
// payment-verified / hire rate. The old route (/api/deals/enrich) ran it and, when
// the browser turned out to be logged out, reported "stopped on login" in a
// banner and left every card exactly as it was, so the next click did the same
// thing. This runner is the same spawn with the gate the owner asked for:
//
//   - a login wall (the actor's own `error: "login"`, or detectLoginWall over any
//     page fields a row carries) STOPS the run,
//   - the cards it did not get to are flagged `needsLogin` in one write, so the
//     board shows the state and the banner offers the re-login link,
//   - a card that enriches cleanly has its flag cleared.
//
// The cookie is a secret: it goes to the child through the environment, never
// argv, and never appears in a log line. No fallback path exists: no cookie is a
// 400 from the route, not a run.
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { LEADS_DIR, setEnrichment, setNeedsLogin } from "@/lib/upworkDesk";
import { detectLoginWall } from "@/lib/dealDeskControl";
import { sanitizeSpawnEnv } from "@/lib/spawnEnv";

/** Ban-risk guard: never authenticate-hit more than this per run. */
export const ENRICH_CAP = 10;

export interface EnrichTarget { id: string; url: string }

export interface EnrichRow {
  id: string;
  proposals?: string | number | null;
  paymentVerified?: boolean | null;
  hireRate?: number | null;
  error?: string;
  /** Optional page fields; a row carrying them is re-checked by detectLoginWall. */
  title?: string | null;
  finalUrl?: string | null;
  text?: string | null;
}

export interface EnrichOutcome {
  attempted: number;
  enriched: number;
  /** "login" | "captcha" | null: why the run ended early. */
  stopped: "login" | "captcha" | null;
  /** Cards flagged needsLogin by this run (the one that hit the wall + the rest of the queue). */
  needsLogin: string[];
  /** Per-card errors other than the stop reason. */
  errors: { id: string; error: string }[];
  exitCode: number | null;
  stderrTail: string;
}

export interface EnrichOpts {
  cookie: string;
  signal?: AbortSignal;
  log?: (text: string) => void;
  /** Test seam: the script to spawn (default <LEADS_DIR>/actor/enrich.mjs). */
  script?: string;
  cwd?: string;
}

export function enrichScriptPath(): string {
  return path.join(LEADS_DIR, "actor", "enrich.mjs");
}

export async function runEnrichment(targets: EnrichTarget[], opts: EnrichOpts): Promise<EnrichOutcome> {
  const queue = targets.slice(0, ENRICH_CAP);
  const stamp = `${Date.now()}-${process.pid}`;
  const tmpIn = path.join(os.tmpdir(), `enrich-${stamp}.json`);
  const tmpOut = path.join(os.tmpdir(), `enrich-${stamp}-out.json`);
  await writeFile(tmpIn, JSON.stringify(queue));

  const actorDir = opts.cwd ?? path.join(LEADS_DIR, "actor");
  const script = opts.script ?? enrichScriptPath();
  opts.log?.(`enriching ${queue.length} listing(s) through the logged-in browser`);

  const res = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [script, tmpIn, tmpOut], {
      cwd: actorDir,
      env: sanitizeSpawnEnv({ ...process.env, UPWORK_COOKIE: opts.cookie }), // secret via env, never argv
    });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    const onAbort = () => { try { child.kill(); } catch { /* already gone */ } };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.on("close", (code) => { opts.signal?.removeEventListener("abort", onAbort); resolve({ code, stderr }); });
    child.on("error", (e) => { opts.signal?.removeEventListener("abort", onAbort); resolve({ code: -1, stderr: String(e) }); });
  });

  let out: EnrichRow[] = [];
  try { out = JSON.parse(await readFile(tmpOut, "utf8")) as EnrichRow[]; } catch { /* none written */ }

  const outcome: EnrichOutcome = {
    attempted: queue.length, enriched: 0, stopped: null, needsLogin: [], errors: [],
    exitCode: res.code, stderrTail: res.stderr.slice(-300),
  };
  const cleared: string[] = [];
  for (const r of out) {
    if (outcome.stopped) break;
    // The actor's own verdict, or our check over any page fields it handed back.
    const wall = r.error === "login" || (r.title != null || r.finalUrl != null || r.text != null
      ? detectLoginWall({ title: r.title, url: r.finalUrl, text: r.text }).wall
      : false);
    if (wall) { outcome.stopped = "login"; outcome.needsLogin.push(r.id); continue; }
    if (r.error === "captcha") { outcome.stopped = "captcha"; continue; }
    if (r.error) { outcome.errors.push({ id: r.id, error: r.error }); continue; }
    await setEnrichment(r.id, {
      proposals: r.proposals ?? null,
      paymentVerified: r.paymentVerified ?? null,
      hireRate: r.hireRate ?? null,
    });
    cleared.push(r.id);
    outcome.enriched++;
  }

  if (outcome.stopped === "login") {
    // Everything the run did not reach would have hit the same wall.
    const reached = new Set(out.map((r) => r.id));
    for (const t of queue) if (!reached.has(t.id) && !outcome.needsLogin.includes(t.id)) outcome.needsLogin.push(t.id);
    await setNeedsLogin(outcome.needsLogin, true);
    opts.log?.(`login wall: stopped, ${outcome.needsLogin.length} card(s) marked needs login`);
  } else if (outcome.stopped === "captcha") {
    opts.log?.("captcha: stopped (never retried; that is what escalates an account to a ban)");
  }
  if (cleared.length) await setNeedsLogin(cleared, false);
  opts.log?.(`enriched ${outcome.enriched}/${outcome.attempted}`);
  return outcome;
}
