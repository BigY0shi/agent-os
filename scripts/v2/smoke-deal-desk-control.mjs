// Deal Desk control (roadmap S4): verdict extraction, bulk deny, the max-age
// gate, login-wall detection on fixture HTML, intake URL validation.
//
// Run: npx tsx scripts/v2/smoke-deal-desk-control.mjs
//
// Rule 19: AGENTIC_OS_DESK, UPWORK_LEADS_DIR, AGENTIC_OS_SETTINGS and
// AGENTIC_OS_RUNS_DIR are redirected BEFORE any import. Nothing here reads the
// owner's board, his settings, or his leads directory. No browser, no claude.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-desk-control-"));
process.env.AGENTIC_OS_DESK = path.join(dir, "upwork-desk.json");
process.env.UPWORK_LEADS_DIR = path.join(dir, "leads");
process.env.AGENTIC_OS_SETTINGS = path.join(dir, "settings.json");
process.env.AGENTIC_OS_RUNS_DIR = dir;
fs.mkdirSync(process.env.UPWORK_LEADS_DIR, { recursive: true });
fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, JSON.stringify({ memory: { ingestEnabled: false } }), "utf8");

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !extra ? "" : `  [${extra}]`}`);
  if (!cond) failures++;
};

const C = await import("../../src/lib/dealDeskControl.ts");

// -- A (c) the verdict is the evaluator's own sentence, banded ---------------
console.log("\n-- A (c) verdict first --");
{
  const v = C.deriveVerdict({ why: "Strong fit: HubSpot + Zapier cleanup is exactly our lane. The client has spent $40k.", summary: "They want workflows fixed.", pitch: "I read your posting...", effectiveFit: 8 });
  check("A1 a 'strong fit' why reads as pursue", v.band === "pursue", v.band);
  check("A2 the line is the FIRST sentence of why, nothing after it", v.line === "Strong fit: HubSpot + Zapier cleanup is exactly our lane.", v.line);
  check("A3 source names the field", v.source === "why");
}
{
  const v = C.deriveVerdict({ why: "Not a fit - this is an SDR seat, not a systems build.", summary: "Cold calling role.", pitch: "Skip - staffing role.", effectiveFit: 2 });
  check("A4 'Skip -' pitch opener is a pass regardless of score", v.band === "pass", v.band);
  check("A5 and the why sentence is still the line shown", v.line.startsWith("Not a fit"), v.line);
}
{
  const v = C.deriveVerdict({ why: null, summary: "Borderline: the budget is thin but the stack is ours. They need a Make.com scenario rebuilt.", pitch: null, effectiveFit: 6 });
  check("A6 falls through to summary when why is empty", v.source === "summary" && v.band === "maybe", `${v.source}/${v.band}`);
  check("A7 summary line is its first sentence only", v.line === "Borderline: the budget is thin but the stack is ours.", v.line);
}
{
  const v = C.deriveVerdict({ why: "The client runs a Shopify store with 200 SKUs.", summary: null, pitch: null, effectiveFit: 8 });
  check("A8 text with no readable call keeps the sentence and bands on the score", v.band === "pursue" && v.source === "why", `${v.band}/${v.source}`);
  const w = C.deriveVerdict({ why: "The client runs a Shopify store with 200 SKUs.", summary: null, pitch: null, effectiveFit: 3 });
  check("A9 same sentence, low fit -> pass", w.band === "pass", w.band);
}
{
  const v = C.deriveVerdict({ why: null, summary: null, pitch: null, effectiveFit: 5 });
  check("A10 nothing written -> an honest 'no verdict' line, never an invented one", v.source === "score" && /No written verdict/.test(v.line), v.line);
  check("A11 and the band comes from the score (5 -> maybe)", v.band === "maybe", v.band);
}
{
  const v = C.deriveVerdict({ why: "Verdict: pass, the posting asks for a full-time employee.", summary: null, pitch: null, effectiveFit: 7 });
  check("A12 a leading 'Verdict:' label is stripped from the line", v.line.startsWith("pass, the posting"), v.line);
  check("A13 and a text pass beats a high score", v.band === "pass", v.band);
  const p = C.deriveVerdict({ why: "We would pass the data through their API and it is a good fit.", summary: null, pitch: null, effectiveFit: 8 });
  check("A14 'pass through' does not read as a pass", p.band === "pursue", p.band);
}
check("A15 every band has a colour and a label", ["pursue", "maybe", "pass"].every((b) => C.VERDICT_COLOR[b] && C.VERDICT_LABEL[b]));

// -- B (b) bulk deny is one write ----------------------------------------------
console.log("\n-- B (b) bulk deny --");
const D = await import("../../src/lib/upworkDesk.ts");
const LIVE = process.env.AGENTIC_OS_DESK;
const PREV = path.join(dir, "upwork-desk_prev.json");
const readLive = () => JSON.parse(fs.readFileSync(LIVE, "utf8"));
{
  await D.setStatus("d-1", "new");
  await D.setStatus("d-2", "reviewing");
  await D.setNotes("d-3", "keep this note");
  const prevBefore = fs.readFileSync(PREV, "utf8");
  const written = await D.setStatusBulk(["d-1", "d-2", "d-3", "d-3", " ", "d-4"], "denied");
  const live = readLive();
  check("B1 every id is denied", ["d-1", "d-2", "d-3", "d-4"].every((id) => live[id]?.status === "denied"));
  check("B2 duplicates and blanks are dropped from the written list", written.length === 4 && !written.includes(" "), written.join(","));
  check("B3 the note on d-3 survived the status change", live["d-3"].notes === "keep this note");
  check("B4 ONE generation was rotated, not one per card", fs.readFileSync(PREV, "utf8") !== prevBefore && Object.keys(JSON.parse(fs.readFileSync(PREV, "utf8"))).length === 3, `prev has ${Object.keys(JSON.parse(fs.readFileSync(PREV, "utf8"))).length} keys`);
  check("B5 every written card carries an updatedAt", written.every((id) => typeof live[id].updatedAt === "number"));
  const none = await D.setStatusBulk([], "denied");
  check("B6 an empty list writes nothing", none.length === 0 && JSON.stringify(readLive()) === JSON.stringify(live));
  let threw = false;
  try { await D.setStatusBulk(["d-1"], "bogus"); } catch { threw = true; }
  check("B7 an invalid status throws rather than writing", threw);
}

// -- C (f) the age gate ---------------------------------------------------------
console.log("\n-- C (f) max-age gate --");
{
  const NOW = Date.parse("2026-09-02T20:00:00Z");
  const iso = (daysAgo) => new Date(NOW - daysAgo * 86_400_000).toISOString();
  check("C1 default gate is 5 days", C.DEFAULT_MAX_AGE_DAYS === 5 && C.clampMaxAgeDays(undefined) === 5);
  check("C2 the knob is clamped to 1..365 and rounded", C.clampMaxAgeDays(0) === 5 && C.clampMaxAgeDays(-3) === 5 && C.clampMaxAgeDays(900) === 365 && C.clampMaxAgeDays("7.4") === 7 && C.clampMaxAgeDays("abc") === 5);
  check("C3 ageDays: whole days, never negative, null for unknown", C.ageDays(NOW - 2.9 * 86_400_000, NOW) === 2 && C.ageDays(NOW + 5000, NOW) === 0 && C.ageDays(null, NOW) === null && C.ageDays(NaN, NOW) === null);
  const items = [
    { id: "fresh", datePosted: iso(1) },
    { id: "edge", datePosted: iso(5) },
    { id: "old", datePosted: iso(6) },
    { id: "ancient", posted: "3 weeks ago", _scrapedAt: iso(0) },
    { id: "undated", posted: null },
    { id: "rfc", posted: new Date(NOW - 20 * 86_400_000).toUTCString() },
  ];
  const part = C.partitionByAge(items, (r) => D.resolvePostedAt(r), 5, NOW);
  const ids = (a) => a.map((x) => x.id).sort().join(",");
  check("C4 5-day gate keeps day 1 and day 5, drops day 6, the 3-week Upwork phrase and the RFC date", ids(part.kept) === "edge,fresh,undated" && ids(part.dropped) === "ancient,old,rfc", `kept=${ids(part.kept)} dropped=${ids(part.dropped)}`);
  check("C5 an undated record is KEPT and listed as unknown, never dropped", ids(part.unknown) === "undated");

  // The file-level prune: board.json in the redirected leads dir.
  const leads = process.env.UPWORK_LEADS_DIR;
  const boardFile = path.join(leads, "board.json");
  fs.writeFileSync(boardFile, JSON.stringify(items), "utf8");
  const r1 = await D.pruneLeadsFileByAge("board", 5, NOW);
  const after = JSON.parse(fs.readFileSync(boardFile, "utf8"));
  check("C6 pruneLeadsFileByAge rewrote board.json with the kept rows only", ids(after) === "edge,fresh,undated" && r1.kept === 3 && r1.dropped === 3 && r1.unknown === 1, JSON.stringify(r1));
  check("C7 the dropped rows were written beside the file, not discarded", r1.droppedFile && fs.existsSync(r1.droppedFile) && ids(JSON.parse(fs.readFileSync(r1.droppedFile, "utf8"))) === "ancient,old,rfc", r1.droppedFile || "no file");
  const r2 = await D.pruneLeadsFileByAge("board", 5, NOW);
  check("C8 a second prune with nothing to drop writes nothing", r2.dropped === 0 && r2.droppedFile === null && ids(JSON.parse(fs.readFileSync(boardFile, "utf8"))) === "edge,fresh,undated");
  const r3 = await D.pruneLeadsFileByAge("feeds", 5, NOW);
  check("C9 a missing feeds.json is an empty prune, not an error", r3.kept === 0 && r3.dropped === 0 && !fs.existsSync(path.join(leads, "feeds.json")));
  const S = await import("../../src/lib/settings.ts");
  check("C10 settings.deals.maxAgeDays defaults to 5 (gear-editable, rule 16)", S.DEFAULT_SETTINGS.deals?.maxAgeDays === 5 && S.readSettings().deals?.maxAgeDays === 5);
}

// -- D (d) the login wall ---------------------------------------------------------
console.log("\n-- D (d) login wall --");
{
  const listing = {
    title: "Zapier + HubSpot cleanup - Upwork",
    url: "https://www.upwork.com/jobs/~021234567890123456/",
    text: "Zapier + HubSpot cleanup. Posted 2 hours ago. Log in to apply. Proposals: 5 to 10. About the client: Payment method verified. 4.9 of 5 stars.",
  };
  check("D1 a real listing page is not a wall, even though it says 'Log in to apply'", C.detectLoginWall(listing).wall === false);
  const byUrl = C.detectLoginWall({ ...listing, url: "https://www.upwork.com/ab/account-security/login?redir=%2Fjobs%2F~02123" });
  check("D2 a redirect to /ab/account-security/login is a wall (reason url)", byUrl.wall && byUrl.reason === "url", byUrl.reason);
  const byTitle = C.detectLoginWall({ title: "Log in to Upwork", url: "https://www.upwork.com/jobs/~02123/", text: "" });
  check("D3 a 'Log in to Upwork' title is a wall (reason title)", byTitle.wall && byTitle.reason === "title", byTitle.reason);
  const byText = C.detectLoginWall({ title: "", url: "https://www.upwork.com/jobs/~02123/", text: "Welcome back Username or email Password Forgot password? Log in Continue with Google" });
  check("D4 the login form text with no listing markers is a wall (reason text)", byText.wall && byText.reason === "text", byText.reason);
  check("D5 empty page fields are not a wall", C.detectLoginWall({}).wall === false);
  check("D6 the re-login URL is Upwork's login route", /^https:\/\/www\.upwork\.com\/ab\/account-security\/login$/.test(C.UPWORK_LOGIN_URL));

  // Flag writes: one generation for many cards; a fresh cookie clears all.
  await D.setStatus("L-1", "approved");
  await D.setStatus("L-2", "approved");
  const flagged = await D.setNeedsLogin(["L-1", "L-2", "L-2"], true);
  let live = readLive();
  check("D7 setNeedsLogin flags many in one write, dedupes", flagged.length === 2 && live["L-1"].needsLogin === true && typeof live["L-2"].loginWallAt === "number");
  const cleared = await D.setNeedsLogin([], false);
  live = readLive();
  check("D8 setNeedsLogin([], false) clears EVERY flagged card (a fresh cookie)", cleared.sort().join(",") === "L-1,L-2" && live["L-1"].needsLogin === false && live["L-2"].needsLogin === false);
  const noop = await D.setNeedsLogin([], false);
  check("D9 clearing with nothing flagged writes nothing", noop.length === 0);

  // The gated runner against a fake actor script: card 1 enriches, card 2 hits
  // the wall, card 3 is never reached. No browser, no cookie of the owner's.
  const leads = process.env.UPWORK_LEADS_DIR;
  const actorDir = path.join(leads, "actor");
  fs.mkdirSync(actorDir, { recursive: true });
  const fake = path.join(actorDir, "enrich.mjs");
  fs.writeFileSync(fake, [
    'import fs from "node:fs";',
    'const t = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));',
    'if (!process.env.UPWORK_COOKIE) { console.error("NO_COOKIE"); process.exit(2); }',
    'if (process.argv.includes("--leak")) console.log(process.env.UPWORK_COOKIE);',
    'const rows = [{ id: t[0].id, proposals: "5 to 10", paymentVerified: true, hireRate: 80 }];',
    'if (t[1]) rows.push({ id: t[1].id, error: "login" });',
    'fs.writeFileSync(process.argv[3], JSON.stringify(rows));',
    'console.log(JSON.stringify({ done: true, count: rows.length, stopped: t[1] ? "login" : null }));',
  ].join("\n"), "utf8");
  const E = await import("../../src/lib/dealEnrich.ts");
  const logs = [];
  const o = await E.runEnrichment(
    [{ id: "L-1", url: "https://www.upwork.com/jobs/~021/" }, { id: "L-2", url: "https://www.upwork.com/jobs/~022/" }, { id: "L-3", url: "https://www.upwork.com/jobs/~023/" }],
    { cookie: "master_access_token=smoke; visitor_id=1", log: (t) => logs.push(t) },
  );
  live = readLive();
  check("D10 the run stops at the wall", o.stopped === "login" && o.attempted === 3 && o.enriched === 1, JSON.stringify(o));
  check("D11 the card before the wall was enriched and is NOT flagged", live["L-1"].enrichment?.proposals === "5 to 10" && live["L-1"].needsLogin === false);
  check("D12 the card at the wall AND the unreached card are flagged needs login", o.needsLogin.sort().join(",") === "L-2,L-3" && live["L-2"].needsLogin === true && live["L-3"].needsLogin === true);
  check("D13 the run log says so in words", logs.some((l) => /login wall/.test(l)), logs.join(" | "));
  check("D14 the cookie never appears in a log line", !logs.some((l) => /master_access_token/.test(l)));
  const single = await E.runEnrichment([{ id: "L-1", url: "https://www.upwork.com/jobs/~021/" }], { cookie: "master_access_token=smoke" });
  check("D15 a clean run has no stop and no flags", single.stopped === null && single.enriched === 1 && single.needsLogin.length === 0);
  check("D16 the cap is 10 per run (ban-risk guard)", E.ENRICH_CAP === 10);
  const deals = await D.listDeals();
  check("D17 listDeals carries needsLogin/loginWallAt (no board rows here, so the field just has to exist on the type path)", Array.isArray(deals));
}

// -- E (a) manual intake ---------------------------------------------------------
console.log("\n-- E (a) intake --");
{
  const p = C.parseIntakeUrls([
    "https://www.upwork.com/jobs/~021234567890123456/",
    "https://www.upwork.com/freelance-jobs/apply/Zapier-cleanup_~021234567890123456/",   // same listing, apply form
    "www.upwork.com/jobs/Make-scenario_~019876543210987654?referrer=x",
    "https://www.upwork.com/nx/search/jobs/?q=zapier",
    "https://remoteok.com/remote-jobs/12345",
    "not a url at all",
    "",
  ]);
  check("E1 the two spellings of the same listing collapse to one canonical target", p.accepted.length === 2 && p.accepted[0].url === "https://www.upwork.com/jobs/~021234567890123456/" && p.accepted[0].id === "1234567890123456", JSON.stringify(p.accepted));
  check("E2 a bare host and ~01 ids are accepted and canonicalised", p.accepted[1]?.id === "9876543210987654" && p.accepted[1].url.endsWith("~029876543210987654/"));
  check("E3 rejections are named with reasons", p.rejected.length === 3 && p.rejected.every((r) => r.reason), JSON.stringify(p.rejected));
  check("E4 a search page is 'not a job listing', another host is 'not an Upwork listing'", /not a job listing/.test(p.rejected[0].reason) && /not an Upwork listing/.test(p.rejected[1].reason) && /not a URL/.test(p.rejected[2].reason));
  const text = C.parseIntakeUrls("https://www.upwork.com/jobs/~021111111111111111/\nhttps://www.upwork.com/jobs/~022222222222222222/, https://www.upwork.com/jobs/~021111111111111111/");
  check("E5 pasted text splits on newlines, commas and spaces, and dedupes", text.accepted.length === 2);
  const many = C.parseIntakeUrls(Array.from({ length: 25 }, (_, i) => `https://www.upwork.com/jobs/~02${String(1000000000000000 + i)}/`));
  check("E6 the per-paste cap is enforced by name", many.accepted.length === C.INTAKE_MAX_URLS && many.rejected.length === 5 && /cap/.test(many.rejected[0].reason));

  // The runner with fake scripts in the redirected leads dir: a fake intake
  // scraper (row 1 fine, row 2 the login page, row 3 unreached), a fake
  // score_board that rebuilds board.json from the dataset, a fake pitch.mjs
  // that merges pitches.json. No browser, no claude.
  const leads = process.env.UPWORK_LEADS_DIR;
  const fakeDir = path.join(leads, "fake");
  fs.mkdirSync(fakeDir, { recursive: true });
  const w = (name, lines) => { const f = path.join(fakeDir, name); fs.writeFileSync(f, lines.join("\n"), "utf8"); return f; };
  const intakeScript = w("intake.mjs", [
    'import fs from "node:fs";',
    'const t = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));',
    'if (!process.env.UPWORK_ACTOR_DIR) { console.error("NO_ACTOR_DIR"); process.exit(2); }',
    'const rows = [];',
    'const rec = (id) => ({ id, title: "Pasted listing " + id, url: "https://www.upwork.com/jobs/~02" + id + "/", budget: "$500", jobType: "Fixed", description: "Fix our Zapier", datePosted: new Date().toISOString(), _query: "intake", tags: [] });',
    'rows.push({ id: t[0].id, url: t[0].url, page: { title: "Pasted listing - Upwork", url: t[0].url, text: "Fix our Zapier. Proposals: 5 to 10. About the client" }, record: rec(t[0].id) });',
    'if (t[1]) rows.push({ id: t[1].id, url: t[1].url, page: { title: "Log in to Upwork", url: "https://www.upwork.com/ab/account-security/login", text: "Welcome back Password" }, record: null });',
    'fs.writeFileSync(process.argv[3], JSON.stringify(rows));',
    'console.log(JSON.stringify({ done: true, count: rows.length }));',
  ]);
  const scoreScript = w("score.mjs", [
    'import fs from "node:fs"; import path from "node:path";',
    `const ds = ${JSON.stringify(path.join(leads, "dataset"))};`,
    'const rows = fs.readdirSync(ds).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(ds, f), "utf8")));',
    'const scored = rows.map((r) => ({ ...r, easiness: 7, winnability: 6, fit: 8, composite: 6.8 }));',
    `fs.writeFileSync(${JSON.stringify(path.join(leads, "board.json"))}, JSON.stringify(scored));`,
    'console.log("Scored " + scored.length);',
  ]);
  const pitchScript = w("pitch.mjs", [
    'import fs from "node:fs";',
    'const ids = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));',
    `const f = ${JSON.stringify(path.join(leads, "pitches.json"))};`,
    'let prev = []; try { prev = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}',
    'const next = ids.map((id) => ({ url: "https://www.upwork.com/jobs/~02" + id + "/", fitRefined: 8, summary: "Good fit: a Zapier fix.", why: "Strong fit, squarely in our lane.", pitch: "I read your posting.", approach: "Audit, fix, verify", crashCourse: "n/a" }));',
    'fs.writeFileSync(f, JSON.stringify([...prev, ...next]));',
    'console.log(JSON.stringify({ pitched: ids.length }));',
  ]);
  const I = await import("../../src/lib/dealIntake.ts");
  const seams = { intakeScript, scoreScript, pitchScript, actorDir: leads, datasetDir: path.join(leads, "dataset") };
  fs.writeFileSync(path.join(leads, "board.json"), "[]", "utf8"); // the age-gate section left a board; start clean
  const logs = [];
  const t = [
    { id: "3000000000000001", url: "https://www.upwork.com/jobs/~023000000000000001/", input: "" },
    { id: "3000000000000002", url: "https://www.upwork.com/jobs/~023000000000000002/", input: "" },
    { id: "3000000000000003", url: "https://www.upwork.com/jobs/~023000000000000003/", input: "" },
  ];
  const o = await I.runIntake(t, { ...seams, log: (l) => logs.push(l) });
  check("E7 the clean listing was scraped, the wall stopped the rest", o.scraped === 1 && o.stopped === "login", JSON.stringify(o));
  check("E8 the wall card and the unreached card are flagged needs login", o.needsLogin.sort().join(",") === "3000000000000002,3000000000000003" && readLive()["3000000000000003"]?.needsLogin === true);
  check("E9 the dataset row was written in the scraper's shape", fs.existsSync(path.join(leads, "dataset", "intake-3000000000000001.json")));
  check("E10 score then pitch ran and the card is in New", o.pitched === 1 && o.ids.join(",") === "3000000000000001" && readLive()["3000000000000001"]?.status === "new", JSON.stringify(o));
  const deals = await D.listDeals();
  const card = deals.find((d) => d.id === "3000000000000001");
  check("E11 listDeals shows the pasted listing with its pitch and a pursue verdict", !!card && card.summary === "Good fit: a Zapier fix." && card.verdict.band === "pursue" && card.status === "new", card ? `${card.verdict.band}/${card.status}` : "no card");
  check("E12 the run log names each stage", logs.some((l) => /visiting/.test(l)) && logs.some((l) => /scoring/.test(l)) && logs.some((l) => /pitching/.test(l)) && logs.some((l) => /login wall/.test(l)), logs.join(" | "));
  let missing = null;
  try { await I.runIntake(t.slice(0, 1), { ...seams, pitchScript: path.join(leads, "nope.mjs") }); } catch (e) { missing = e.message; }
  check("E13 a missing pipeline script fails loudly by name before anything runs", /pitch\.mjs not found/.test(missing || ""), missing);
}

console.log(`\n${failures === 0 ? "OK" : "FAILED"}  ${failures} failure(s)`);
console.log(`fixture: ${dir}`);
process.exit(failures === 0 ? 0 : 1);
