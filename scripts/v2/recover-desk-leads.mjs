// Rebuild the lead record for desk cards the pipeline has dropped.
//
// score_board.mjs ends with a wholesale writeFileSync of board.json, so a scrape that
// does not re-find a lead removes its record. The owner's state row - his status, his
// notes, a finished proposal - survives in ~/.agentic-os/upwork-desk.json but points at
// nothing, and listDeals() cannot render a card with no title or URL. On 2026-09-04 that
// silently took 12 cards off the board, 8 of them carrying submit-ready proposals.
//
// pitches.json is keyed by the same ids and still holds title, url and the analysis, so
// the record can be rebuilt from the owner's own data rather than invented. Everything
// only the scraper knew (budget, client rating, the posted date, easiness/winnability)
// stays absent and renders as NA - a recovered card says what it does not know.
//
// Dry run by default. Nothing is written without --apply, and --apply backs up the state
// file to .exile/ first.
//
//   node scripts/v2/recover-desk-leads.mjs
//   node scripts/v2/recover-desk-leads.mjs --apply
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const LEADS = process.env.UPWORK_LEADS_DIR || path.join(os.homedir(), "Documents", "Upwork-Leads");
const STATE = process.env.AGENTIC_OS_DESK || path.join(os.homedir(), ".agentic-os", "upwork-desk.json");

const readJson = (p, fallback) => {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
};

const state = readJson(STATE, null);
if (!state) { console.error(`cannot read the desk state at ${STATE}`); process.exit(1); }

const board = readJson(path.join(LEADS, "board.json"), []);
const feeds = readJson(path.join(LEADS, "feeds.json"), []);
const pitches = readJson(path.join(LEADS, "pitches.json"), []);
const live = new Set([...board.map((r) => r.id), ...feeds.map((r) => r.id)]);
const pitchById = new Map(pitches.filter((p) => p.id).map((p) => [String(p.id), p]));

const orphans = Object.keys(state).filter(
  (id) => !live.has(id) && !state[id].lead && state[id].status !== "dismissed",
);

const plan = [];
const unrecoverable = [];
for (const id of orphans) {
  const p = pitchById.get(id);
  if (!p || !p.title || !p.url) { unrecoverable.push(id); continue; }
  plan.push({ id, status: state[id].status || "new", title: p.title, pitch: p });
}

console.log(`state rows          ${Object.keys(state).length}`);
console.log(`records still live  ${live.size}`);
console.log(`orphaned, no snapshot ${orphans.length}`);
console.log(`recoverable from pitches.json ${plan.length}`);
console.log(`unrecoverable ${unrecoverable.length}${unrecoverable.length ? ` (${unrecoverable.join(", ")})` : ""}`);
console.log("");
for (const r of plan) console.log(`  ${r.status.padEnd(9)} ${r.title.slice(0, 62)}`);

if (!plan.length) { console.log("\nnothing to do"); process.exit(0); }
if (!APPLY) { console.log("\nDRY RUN - re-run with --apply to write"); process.exit(0); }

// Rule 3: never overwrite the owner's data without a recoverable copy beside it.
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const exile = path.join(process.cwd(), ".exile", `${stamp}_desk-recovery`);
fs.mkdirSync(exile, { recursive: true });
fs.copyFileSync(STATE, path.join(exile, "upwork-desk.json"));
console.log(`\nbacked up the state file to ${exile}`);

const at = Date.now();
for (const { id, pitch: p } of plan) {
  const st = state[id];
  st.lead = {
    id,
    title: p.title,
    url: p.url,
    // The refined fit is a real judgement from the pitch pass. easiness and winnability
    // were the scraper's and are genuinely gone, so they are left off and shown as NA.
    ...(typeof p.fitRefined === "number" ? { fit: p.fitRefined } : {}),
    at,
    from: "pitches",
  };
  // The analysis was in pitches.json too. Only fill what the card does not already
  // have - a brief generated on demand is newer than the offline pitch pass.
  const b = st.brief || {};
  const merged = {
    summary: b.summary ?? p.summary ?? undefined,
    why: b.why ?? p.why ?? undefined,
    approach: b.approach ?? p.approach ?? undefined,
    crashCourse: b.crashCourse ?? p.crashCourse ?? undefined,
    at: b.at ?? at,
  };
  if (merged.summary || merged.why || merged.approach || merged.crashCourse) st.brief = merged;
  if (!st.editedPitch && p.pitch) st.editedPitch = p.pitch;
}

fs.writeFileSync(STATE, JSON.stringify(state, null, 2), "utf8");
console.log(`recovered ${plan.length} card(s) into ${STATE}`);
