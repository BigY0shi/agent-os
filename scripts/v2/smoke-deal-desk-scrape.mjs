// smoke-deal-desk-scrape: the Upwork scrape stops reading old jobs, and its search topics are a
// setting (owner, 2026-10-08: "about an hour to scrape ... still grabbing 4 weeks, 1 week, 10
// days" + "a space in the configuration settings to set the topic/keywords"). Evidence that day:
// the in-progress run's dataset held 254 fully-read jobs, 108 of them older than the 5-day gate,
// because the gate ran only after the scrape, and the scrape ran logged out (no cookie handed
// over), where Upwork ignores newest-first.
//   A. search topics + pages: defaults, cleaning, caps
//   B. crawlerInput: gear values in, the crawler's own keys kept
//   C. the scrape route writes INPUT.json from settings and hands the cookie over via env
//   D. the crawler (Upwork-Leads/actor/src/main.js): the tile age parser, run for real, and the
//      skip-before-open + stop-paging wiring. SKIPped (not failed) where that folder is absent.
//   E. the gear exposes both fields
// Offline: no network, no crawler run. Settings redirected to a temp file (rule 19).
// Run: npx tsx scripts/v2/smoke-deal-desk-scrape.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-dealscrape-"));
process.env.AGENTIC_OS_SETTINGS = path.join(tmp, "settings.json");
process.env.AGENTIC_OS_DB = path.join(tmp, "test.db");
process.env.AGENTIC_OS_AGENTMAIL_DIR = path.join(tmp, "agentmail");
process.env.AGENTIC_OS_NEWSLETTER_DIR = path.join(tmp, "newsletter");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || extra === undefined ? "" : `  [${JSON.stringify(extra).slice(0, 200)}]`}`);
  if (!cond) failures++;
};
const read = (p) => fs.readFileSync(p, "utf8");

const C = await import("../../src/lib/dealDeskControl.ts");

// ── A ───────────────────────────────────────────────────────────────────────
check("A1 defaults are the 24 searches INPUT.json held on 2026-10-08", C.DEFAULT_SEARCH_QUERIES.length === 24 && C.DEFAULT_SEARCH_QUERIES[0] === "hubspot automation" && C.DEFAULT_SEARCH_QUERIES.at(-1) === "workflow optimization");
check("A2 nothing set -> the defaults", C.cleanSearchQueries(undefined).join() === C.DEFAULT_SEARCH_QUERIES.join());
check("A3 empty / blank-only -> the defaults (an empty list would make the crawler throw)", C.cleanSearchQueries([]).length === 24 && C.cleanSearchQueries("  \n , ").length === 24);
const nl = String.fromCharCode(10);
const q = C.cleanSearchQueries(["  n8n   automation ", "N8N automation", "", "webflow"].join(nl) + ", shopify");
check("A4 one-per-line or commas; trimmed, spaces collapsed, case-insensitive dedupe", q.join("|") === "n8n automation|webflow|shopify", q);
check("A5 capped at MAX_SEARCH_QUERIES, each at most 80 chars",
  C.cleanSearchQueries(Array.from({ length: 99 }, (_, i) => `topic ${i}`)).length === C.MAX_SEARCH_QUERIES && C.cleanSearchQueries(["x".repeat(200)])[0].length === 80);
check("A6 pages per search: default 2, clamped 1..10", C.clampPagesPerQuery(undefined) === 2 && C.clampPagesPerQuery(0) === 2 && C.clampPagesPerQuery(99) === 10 && C.clampPagesPerQuery("3") === 3);

// ── B ───────────────────────────────────────────────────────────────────────
const inp = C.crawlerInput({ headless: false, maxConcurrency: 2, dedupe: false, queries: ["stale"], maxPagesPerQuery: 9 }, { searchQueries: ["ai seo"], pagesPerQuery: 3, maxAgeDays: 4 });
check("B1 gear values replace queries / pages and add the age gate", JSON.stringify(inp.queries) === '["ai seo"]' && inp.maxPagesPerQuery === 3 && inp.maxAgeDays === 4, inp);
check("B2 the crawler's own keys are kept", inp.headless === false && inp.maxConcurrency === 2 && inp.dedupe === false);
const inp0 = C.crawlerInput({}, undefined);
check("B3 no Deal Desk settings -> defaults, 2 pages, 5-day gate", inp0.queries.length === 24 && inp0.maxPagesPerQuery === 2 && inp0.maxAgeDays === 5, inp0);

// ── C ───────────────────────────────────────────────────────────────────────
const r = read("src/app/api/deals/scrape/route.ts");
check("C1 INPUT.json is written from the settings before the crawler starts",
  /const input = crawlerInput\(existing, readSettings\(\)\.deals\);/.test(r) && /writeFileSync\(INPUT_FILE, JSON\.stringify\(input/.test(r) && r.indexOf("writeFileSync(INPUT_FILE") < r.indexOf('await runStage("scraping"'));
check("C2 the saved Upwork cookie reaches the crawler via env (never argv / INPUT.json)",
  /const cookie = readUpworkCookie\(\);/.test(r) && /runStage\("scraping", ACTOR_ENTRY, ACTOR_DIR, \[\], cookie \? \{ UPWORK_COOKIE: cookie \} : \{\}\)/.test(r) && /env: \{ \.\.\.process\.env, \.\.\.extraEnv \}/.test(r));
check("C3 a missing cookie is said out loud, not silent", /WARNING: no Upwork cookie saved/.test(r));
check("C4 the landing-time prune still runs after scoring (belt and braces)", /pruneLeadsFileByAge\("board", maxAgeDays\)/.test(r));

// ── D ───────────────────────────────────────────────────────────────────────
const leads = process.env.UPWORK_LEADS_DIR || path.join(os.homedir(), "Documents", "Upwork-Leads");
const mainJs = path.join(leads, "actor", "src", "main.js");
if (!fs.existsSync(mainJs)) {
  console.log(`SKIP  D: ${mainJs} not present on this machine`);
} else {
  const m = read(mainJs);
  const s = m.indexOf("const REL_DAYS"); const e = m.indexOf("let skippedOld");
  let tileAgeDays = null;
  try { tileAgeDays = new Function(`${m.slice(s, e)}; return tileAgeDays;`)(); } catch (err) { check("D0 tileAgeDays extracts", false, String(err)); }
  if (tileAgeDays) {
    const cases = [["Posted 2 hours ago", 2 / 24], ["Posted 4 days ago", 4], ["Posted 1 week ago", 7], ["Posted 4 weeks ago", 28], ["Posted 10 days ago", 10],
      ["Posted yesterday", 1], ["Posted last week", 7], ["Posted 2 months ago", 60], ["Posted just now", 0], ["", null], [null, null]];
    const bad = cases.filter(([t, want]) => { const got = tileAgeDays(t); return want === null ? got !== null : Math.abs(got - want) > 1e-9; });
    check("D1 the crawler's tile age parser reads every Upwork form (and null when unreadable)", bad.length === 0, bad);
    check("D2 with a 5-day gate: 4 days opens, 1 week / 10 days / 4 weeks do not", [4, 7, 10, 28].map((d) => d > 5).join() === "false,true,true,true" && tileAgeDays("Posted 4 days ago") <= 5 && tileAgeDays("Posted 1 week ago") > 5);
  }
  check("D3 an old tile is skipped BEFORE its detail page is queued",
    /if \(maxAgeDays > 0 && age !== null && age > maxAgeDays\) \{ oldOnPage \+= 1; skippedOld \+= 1; continue; \}/.test(m) && m.indexOf("age > maxAgeDays") < m.indexOf("label: 'DETAIL'"));
  check("D4 paging stops once a whole newest-first page is past the gate (logged in only)", /const pastGate = maxAgeDays > 0 && sessionCookie && sort === 'recency' && datedOnPage > 0 && oldOnPage === datedOnPage;/.test(m) && /&& !pastGate\)/.test(m));
  check("D5 the run summary counts what was not opened, and says when it ran logged out", /not opened as older than/.test(m) && /ran logged out/.test(m));
}

// ── E ───────────────────────────────────────────────────────────────────────
const g = read("src/components/DealDeskSettings.tsx");
check("E1 the gear has Search topics (one per line) and Pages per search, saved to settings.deals",
  /label="Search topics \(one per line\)"/.test(g) && /label="Pages per search"/.test(g) && /save\(\{ deals: \{ maxAgeDays, searchQueries, pagesPerQuery,/.test(g));
check("E2 settings.ts declares both", /searchQueries\?: string\[\];/.test(read("src/lib/settings.ts")) && /pagesPerQuery\?: number;/.test(read("src/lib/settings.ts")));

// ── F: Stop (owner, 2026-10-08: "I also don't have any functionality to stop it") ──
// The route's job lives on globalThis, so a fake running stage can be planted and the real
// DELETE handler called. No process is spawned: the fake child has no pid, so the stop takes
// the kill() path and records it.
const route = await import("../../src/app/api/deals/scrape/route.ts");
let res = route.DELETE();
check("F1 Stop with nothing running: 409, said plainly", res.status === 409 && /No scrape is running/.test(await res.text()));
let killed = 0;
const jobRef = globalThis.__agentosScrape;
Object.assign(jobRef, { stage: "scraping", startedAt: Date.now(), finishedAt: null, error: null, tail: [], stopRequested: false, child: { pid: undefined, kill: () => { killed++; return true; } } });
res = route.DELETE();
const body = await res.json();
check("F2 Stop while scraping: ok, the stage's process is ended, the stop is remembered", res.status === 200 && body.stopping === true && killed === 1 && jobRef.stopRequested === true, { body, killed });
const rs = read("src/app/api/deals/scrape/route.ts");
check("F3 the process TREE is ended on Windows (the crawler's browser too)", /spawn\("taskkill", \["\/PID", String\(child\.pid\), "\/T", "\/F"\]/.test(rs));
check("F4 no later stage starts after a stop (checked before scoring, after scoring, before pitching)", (rs.match(/stopCheck\(\);/g) || []).length === 3);
check("F5 a stop ends as 'stopped', not 'failed'", /job\.stage = "stopped";/.test(rs));
const st = read("src/lib/upworkDeskStore.ts"), dd = read("src/components/DealDesk.tsx");
check("F6 the desk shows Stop while scraping and calls DELETE", /\{scraping && \(\s*<button onClick=\{stopScrape\}/.test(dd) && /fetch\("\/api\/deals\/scrape", \{ method: "DELETE" \}\)/.test(st) && /j\.stage === "stopped"/.test(st));
Object.assign(jobRef, { stage: "idle", child: null, stopRequested: false });

console.log(failures ? `\n${failures} failure(s)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
