// Manual intake (roadmap S4 a): pasted Upwork job URLs become cards through the
// SAME pipeline a scrape uses, so an intake card is indistinguishable from a
// scraped one:
//
//   1. scripts/deals/intake-scrape.mjs visits each page and returns the page
//      fields plus a mergeRecord()-shaped row (the actor's own parser).
//   2. detectLoginWall() over the page fields: a wall stops the run and flags the
//      rest `needsLogin`, exactly like enrichment (S4 d).
//   3. Each row is written into the actor's dataset dir as intake-<uid>.json,
//      then score_board.mjs rebuilds board.json from the dataset (scores,
//      composite), then pitch.mjs writes the analysis into pitches.json.
//   4. The ids are forced into "new" so a fit<=3 pick still shows in the queue,
//      the way /api/deals/refill does it.
//
// Cost, stated: Crawlee purges the dataset at the start of the next actor run,
// so a re-scrape drops intake rows from board.json unless the search finds the
// same listing. That is the lifecycle of every board row today (a re-scrape
// replaces every URL; see api/deals/scrape); the desk state survives by id.
// Every script is a seam (opts) so the smoke runs the flow with fakes.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { LEADS_DIR, setNeedsLogin, setStatusBulk } from "@/lib/upworkDesk";
import { detectLoginWall, type IntakeTarget, type ScrapedPage } from "@/lib/dealDeskControl";
import { sanitizeSpawnEnv } from "@/lib/spawnEnv";

export interface IntakeRow {
  id: string;
  url: string;
  page: ScrapedPage | null;
  record: Record<string, unknown> | null;
  error?: string;
}

export interface IntakeOutcome {
  attempted: number;
  scraped: number;
  pitched: number;
  stopped: "login" | null;
  needsLogin: string[];
  errors: { id: string; error: string }[];
  /** The ids that reached the board. */
  ids: string[];
}

export interface IntakeOpts {
  cookie?: string;
  signal?: AbortSignal;
  log?: (text: string) => void;
  progress?: (n: number, total: number) => void;
  /** Seams for the smoke; defaults are the real scripts. */
  intakeScript?: string;
  scoreScript?: string;
  pitchScript?: string;
  actorDir?: string;
  datasetDir?: string;
  /** Node to spawn with (default process.execPath). */
  node?: string;
}

export const INTAKE_SCRIPT = path.join(process.cwd(), "scripts", "deals", "intake-scrape.mjs");

function runNode(node: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(node, args, { cwd, env: sanitizeSpawnEnv(env) });
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { err += d.toString(); });
    const onAbort = () => { try { child.kill(); } catch { /* gone */ } };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("close", (code) => { signal?.removeEventListener("abort", onAbort); resolve({ code, out, err }); });
    child.on("error", (e) => { signal?.removeEventListener("abort", onAbort); resolve({ code: -1, out, err: String(e) }); });
  });
}

function stoppedError(): Error {
  const e = new Error("intake stopped");
  e.name = "AbortError";
  return e;
}

export async function runIntake(targets: IntakeTarget[], opts: IntakeOpts = {}): Promise<IntakeOutcome> {
  const node = opts.node ?? process.execPath;
  const actorDir = opts.actorDir ?? path.join(LEADS_DIR, "actor");
  const datasetDir = opts.datasetDir ?? path.join(actorDir, "storage", "datasets", "default");
  const intakeScript = opts.intakeScript ?? INTAKE_SCRIPT;
  const scoreScript = opts.scoreScript ?? path.join(LEADS_DIR, "score_board.mjs");
  const pitchScript = opts.pitchScript ?? path.join(LEADS_DIR, "pitch.mjs");
  for (const [what, f] of [["intake scraper", intakeScript], ["score_board.mjs", scoreScript], ["pitch.mjs", pitchScript]] as const) {
    if (!existsSync(f)) throw new Error(`${what} not found at ${f}`);
  }

  const outcome: IntakeOutcome = { attempted: targets.length, scraped: 0, pitched: 0, stopped: null, needsLogin: [], errors: [], ids: [] };
  const stamp = `${Date.now()}-${process.pid}`;
  const tmpIn = path.join(os.tmpdir(), `intake-${stamp}.json`);
  const tmpOut = path.join(os.tmpdir(), `intake-${stamp}-out.json`);
  await writeFile(tmpIn, JSON.stringify(targets.map((t) => ({ id: t.id, url: t.url }))));

  // 1. scrape
  opts.log?.(`visiting ${targets.length} pasted listing(s)`);
  opts.progress?.(0, 3);
  const env: NodeJS.ProcessEnv = { ...process.env, UPWORK_ACTOR_DIR: actorDir };
  if (opts.cookie) env.UPWORK_COOKIE = opts.cookie; // secret via env, never argv
  const scrape = await runNode(node, [intakeScript, tmpIn, tmpOut], process.cwd(), env, opts.signal);
  if (opts.signal?.aborted) throw stoppedError();
  let rows: IntakeRow[] = [];
  try { rows = JSON.parse(await readFile(tmpOut, "utf8")) as IntakeRow[]; } catch { /* none written */ }
  if (!rows.length) throw new Error(`the intake scraper returned nothing (exit ${scrape.code}): ${scrape.err.slice(-300) || "no output"}`);

  // 2. the login wall, then 3. the dataset rows
  await mkdir(datasetDir, { recursive: true });
  const reached = new Set<string>();
  const landed: string[] = [];
  for (const r of rows) {
    reached.add(r.id);
    if (outcome.stopped) { outcome.needsLogin.push(r.id); continue; }
    if (r.page && detectLoginWall(r.page).wall) { outcome.stopped = "login"; outcome.needsLogin.push(r.id); continue; }
    if (r.error || !r.record) { outcome.errors.push({ id: r.id, error: r.error || "no record" }); continue; }
    await writeFile(path.join(datasetDir, `intake-${r.id}.json`), JSON.stringify(r.record, null, 2), "utf8");
    landed.push(r.id);
    outcome.scraped++;
  }
  if (outcome.stopped === "login") {
    for (const t of targets) if (!reached.has(t.id)) outcome.needsLogin.push(t.id);
    await setNeedsLogin(outcome.needsLogin, true);
    opts.log?.(`login wall: stopped, ${outcome.needsLogin.length} pasted listing(s) marked needs login`);
  }
  if (!landed.length) { opts.log?.("nothing reached the board"); return outcome; }

  // 3. score (rebuilds board.json from the dataset) and pitch (pitches.json)
  opts.log?.(`scoring ${landed.length} listing(s) into board.json`);
  opts.progress?.(1, 3);
  const score = await runNode(node, [scoreScript], LEADS_DIR, process.env, opts.signal);
  if (opts.signal?.aborted) throw stoppedError();
  if (score.code !== 0) throw new Error(`score_board.mjs exited ${score.code}: ${score.err.slice(-300)}`);

  opts.log?.(`pitching ${landed.length} listing(s) (claude, one call each)`);
  opts.progress?.(2, 3);
  const idsFile = path.join(os.tmpdir(), `intake-${stamp}-ids.json`);
  await writeFile(idsFile, JSON.stringify(landed));
  const pitch = await runNode(node, [pitchScript, idsFile], LEADS_DIR, process.env, opts.signal);
  if (opts.signal?.aborted) throw stoppedError();
  try { outcome.pitched = JSON.parse(pitch.out.trim().split("\n").pop() || "{}").pitched ?? 0; } catch { /* the count is reporting only */ }
  if (pitch.code !== 0 && !outcome.pitched) throw new Error(`pitch.mjs exited ${pitch.code}: ${pitch.err.slice(-300)}`);

  // 4. into the queue
  outcome.ids = await setStatusBulk(landed, "new");
  opts.progress?.(3, 3);
  opts.log?.(`${outcome.ids.length} card(s) in New`);
  return outcome;
}
