import { LEADS_DIR, pruneLeadsFileByAge } from "@/lib/upworkDesk";
import { clampMaxAgeDays } from "@/lib/dealDeskControl";
import { readSettings } from "@/lib/settings";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

type Stage = "idle" | "scraping" | "scoring" | "pitching" | "done" | "failed";

interface Job {
  stage: Stage;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  tail: string[];        // last few lines, so the UI can show progress
  child: ChildProcess | null;
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
function runStage(stage: Stage, entry: string, cwd: string, args: string[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    job.stage = stage;
    const child = spawn(process.execPath, [entry, ...args], { cwd, env: process.env });
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

  // Fire and forget: the client polls GET. Awaiting here would hold the request open
  // for the whole run and hit every timeout between here and the browser.
  (async () => {
    try {
      // NOTE: Crawlee purges its default storage on start, so each run is a clean
      // scrape rather than a top-up. That is why stage 2 can just read the dataset.
      await runStage("scraping", ACTOR_ENTRY, ACTOR_DIR);
      await runStage("scoring", SCORE_SCRIPT, LEADS_DIR);
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
          note(`pitching ${ids.length} shortlisted leads`);
          await runStage("pitching", PITCH_SCRIPT, LEADS_DIR, [IDS_FILE]);
        } else {
          note("shortlist was empty — nothing to pitch");
        }
      }
      job.stage = "done";
    } catch (e) {
      job.stage = "failed";
      job.error = e instanceof Error ? e.message : String(e);
    } finally {
      job.finishedAt = Date.now();
    }
  })();

  return Response.json({ ok: true, started: true, stage: job.stage });
}
