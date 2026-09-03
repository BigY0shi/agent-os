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

console.log(`\n${failures === 0 ? "OK" : "FAILED"}  ${failures} failure(s)`);
console.log(`fixture: ${dir}`);
process.exit(failures === 0 ? 0 : 1);
