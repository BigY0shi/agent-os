import { LEADS_DIR, pruneLeadsFileByAge } from "@/lib/upworkDesk";
import { clampMaxAgeDays, crawlerInput } from "@/lib/dealDeskControl";
import { readUpworkCookie } from "@/lib/upworkAuth";
import { readSettings } from "@/lib/settings";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Re-scrape Upwork and rebuild board.json.
//
// This was the missing half of the Deal Desk's refresh story: /feeds refreshed
// RemoteOK+WWR and /refill re-pitched, but nothing re-ran the Upwork scrape — which
// is how board.json sat frozen for a month while the feeds stayed current.
//
// Unlike /feeds this CANNOT be a synchronous request. The actor drives a real browser
// through ~24 searches plus a detail page per job — call it 10–20 minutes. So POST
// starts a job and returns immediately; GET polls it.
//
// Three stages, in order:
//   1. actor    (Crawlee + Playwright)  → actor/storage/datasets/default/*.json
//   2. score    (score_board.mjs)       → board.json + shortlist.json
//   3. pitch    (pitch.mjs <ids>)       → pitches.json
//
// Stage 3 is NOT optional-by-default, and that is the whole lesson of this route.
// listDeals() skips any board record without a matching pitch, and a rescrape replaces
// every URL — so after stages 1–2 alone, the overlap between the new board and the old
// pitches.json is exactly ZERO and the desk's Upwork column renders empty. Measured:
// 122 fresh records, 55 old pitched URLs, 0 in common. Pass { pitch: false } to skip it
// deliberately (e.g. to re-pitch later via /api/deals/refill), knowing the board will be
// blank until something pitches it.

const ACTOR_DIR = path.join(LEADS_DIR, "actor");
const ACTOR_ENTRY = path.join(ACTOR_DIR, "src", "main.js");
const SCORE_SCRIPT = path.join(LEADS_DIR, "score_board.mjs");
const PITCH_SCRIPT = path.join(LEADS_DIR, "pitch.mjs");
const SHORTLIST = path.join(LEADS_DIR, "shortlist.json");
const BOARD = path.join(LEADS_DIR, "board.json");
const IDS_FILE = path.join(LEADS_DIR, ".shortlist-ids.json");
const DATASET_DIR = path.join(ACTOR_DIR, "storage", "datasets", "default");
const INPUT_FILE = path.join(ACTOR_DIR, "storage", "key_value_stores", "default", "INPUT.json");


type Stage = "idle" | "scraping" | "scoring" | "pitching" | "done" | "failed" | "stopped";

interface Job {
  stage: Stage;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  tail: string[];        // last few lines, so the UI can show progress
  child: ChildProcess | null;
  stopRequested?: boolean; // set by DELETE; checked between stages so nothing later starts
}

// Survives the stateless route handler and dev hot-reload, same reasoning as the
// terminal's session registry.
const g = globalThis as unknown as { __agentosScrape?: Job };
const job: Job = (g.__agentosScrape ??= {
  stage: "idle", startedAt: 0, finishedAt: null, error: null, tail: [], child: null,
});

function note(line: string) {
  const t = line.trim();
  if (!t) return;
  job.tail.push(t);
  if (job.tail.length > 12) job.tail.shift();
}

/** End a stage and everything it started. The crawler drives a real browser, and a bare
 *  child.kill() on Windows leaves the browser windows running, so taskkill /T takes the tree. */
function killStageTree(child: ChildProcess) {
  if (process.platform === "win32" && child.pid) {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).unref();
  } else {
    try { child.kill("SIGTERM"); } catch { /* already gone */ }
  }
}

function stopCheck() {
  if (job.stopRequested) throw new Error("STOPPED");
}

function datasetCount(): number {
  try { return readdirSync(DATASET_DIR).filter((f) => f.endsWith(".json")).length; }
  catch { return 0; }
}

/** shortlist.json holds full records; pitch.mjs wants board ids. Resolve via url. */
function shortlistIds(): string[] {
  try {
    const shortlist = JSON.parse(readFileSync(SHORTLIST, "utf8")) as { id?: string; url?: string }[];
    const board = JSON.parse(readFileSync(BOARD, "utf8")) as { id: string; url: string }[];
    const byUrl = new Map(board.map((b) => [b.url, b.id]));
    return shortlist.map((s) => s.id ?? (s.url ? byUrl.get(s.url) : undefined)).filter((x): x is string => !!x);
  } catch { return []; }
}

/** Spawn node directly rather than `npm start` — on Windows the npm .cmd shim is not
 *  executable by spawn without a shell, and a shell would complicate killing the tree. */
function runStage(stage: Stage, entry: string, cwd: string, args: string[] = [], extraEnv: Record<string, string> = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    job.stage = stage;
    const child = spawn(process.execPath, [entry, ...args], { cwd, env: { ...process.env, ...extraEnv } });
    job.child = child;
    child.stdout.on("data", (d) => String(d).split("\n").forEach(note));
    // Crawlee logs progress to stderr; that is information, not failure.
    child.stderr.on("data", (d) => String(d).split("\n").forEach(note));
    child.on("error", (e) => reject(new Error(`${stage} could not start: ${e}`)));
    child.on("close", (code) => {
      job.child = null;
      if (code === 0) resolve();
      else reject(new Error(`${stage} exited with code ${code}`));
    });
  });
}

// GET /api/deals/scrape → current job status
export function GET() {
  return Response.json({
    ok: true,
    stage: job.stage,
    running: job.stage === "scraping" || job.stage === "scoring" || job.stage === "pitching",
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt,
    elapsedMs: job.startedAt ? (job.finishedAt ?? Date.now()) - job.startedAt : 0,
    scraped: datasetCount(),
    error: job.error,
    tail: job.tail,
  });
}

// POST /api/deals/scrape → start a scrape (409 if one is already running)
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { pitch?: boolean };
  // Default ON — see the header note: without it the desk comes back empty.
  const pitch = body.pitch !== false;

  if (job.stage === "scraping" || job.stage === "scoring" || job.stage === "pitching") {
    return Response.json(
      { ok: false, error: `A scrape is already running (${job.stage}).`, stage: job.stage },
      { status: 409 },
    );
  }
  if (!existsSync(ACTOR_ENTRY)) {
    return Response.json({ ok: false, error: `Scraper not found at ${ACTOR_ENTRY}` }, { status: 500 });
  }

  job.stage = "scraping";
  job.startedAt = Date.now();
  job.finishedAt = null;
  job.error = null;
  job.tail = [];
  job.stopRequested = false;

  // Fire and forget: the client polls GET. Awaiting here would hold the request open
  // for the whole run and hit every timeout between here and the browser.
  (async () => {
    try {
      // NOTE: Crawlee purges its default storage on start, so each run is a clean
      // scrape rather than a top-up. That is why stage 2 can just read the dataset.
      // Searches, pages and the age gate come from the gear, written fresh each run.
      let existing: Record<string, unknown> = {};
      try { existing = JSON.parse(readFileSync(INPUT_FILE, "utf8")) as Record<string, unknown>; } catch { /* first run */ }
      const input = crawlerInput(existing, readSettings().deals);
      mkdirSync(path.dirname(INPUT_FILE), { recursive: true });
      writeFileSync(INPUT_FILE, JSON.stringify(input, null, 2), "utf8");
      note(`searching ${(input.queries as string[]).length} topics, ${input.maxPagesPerQuery} page(s) each, skipping jobs older than ${input.maxAgeDays}d`);
      // Logged out, Upwork ignores newest-first and mixes in weeks-old jobs; the saved
      // cookie was handed to enrich/research but never to the scrape (fixed 2026-10-08).
      // Secret via env, never argv or INPUT.json.
      const cookie = readUpworkCookie();
      if (!cookie) note("WARNING: no Upwork cookie saved, so the scrape runs logged out and Upwork ignores newest-first. Set it with the cookie button in the Deal Desk.");
      await runStage("scraping", ACTOR_ENTRY, ACTOR_DIR, [], cookie ? { UPWORK_COOKIE: cookie } : {});
      stopCheck();
      await runStage("scoring", SCORE_SCRIPT, LEADS_DIR);
      stopCheck();
      // S4 (f): the age gate lands here, between scoring and pitching, so an old
      // listing is neither pitched (a claude call each) nor shown. Dropped rows
      // are kept beside the file, never discarded.
      const maxAgeDays = clampMaxAgeDays(readSettings().deals?.maxAgeDays);
      const board = await pruneLeadsFileByAge("board", maxAgeDays);
      const short = await pruneLeadsFileByAge("shortlist", maxAgeDays);
      note(`age gate ${maxAgeDays}d: kept ${board.kept}, dropped ${board.dropped} (${board.unknown} undated kept); shortlist dropped ${short.dropped}`);
      if (pitch) {
        // pitch.mjs takes a file of board IDS, but score_board writes shortlist.json
        // as full records keyed by url — so bridge the two here.
        const ids = shortlistIds();
        if (ids.length) {
          writeFileSync(IDS_FILE, JSON.stringify(ids));
          stopCheck();
          note(`pitching ${ids.length} shortlisted leads`);
          await runStage("pitching", PITCH_SCRIPT, LEADS_DIR, [IDS_FILE]);
        } else {
          note("shortlist was empty — nothing to pitch");
        }
      }
      job.stage = "done";
    } catch (e) {
      if (job.stopRequested) {
        job.stage = "stopped";
        job.error = null;
        note("stopped by you; the board was left as it was before this scrape");
      } else {
        job.stage = "failed";
        job.error = e instanceof Error ? e.message : String(e);
      }
    } finally {
      job.finishedAt = Date.now();
    }
  })();

  return Response.json({ ok: true, started: true, stage: job.stage });
}

// DELETE /api/deals/scrape -> stop the running scrape (owner, 2026-10-08: "I also don't have
// any functionality to stop it"). Ends the current stage's process tree (crawler + browser,
// or the scorer / pitcher) and no later stage starts. Stopped while scraping, the board is
// untouched: it is only rebuilt by the scoring stage. Stopped while pitching, the board is
// already rebuilt and the leads pitched so far keep their pitches.
export function DELETE() {
  const running = job.stage === "scraping" || job.stage === "scoring" || job.stage === "pitching";
  if (!running) return Response.json({ ok: false, error: "No scrape is running.", stage: job.stage }, { status: 409 });
  job.stopRequested = true;
  const stage = job.stage;
  if (job.child) killStageTree(job.child);
  note(`stop requested during ${stage}`);
  return Response.json({ ok: true, stopping: true, stage });
}
