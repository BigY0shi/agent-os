// A card the owner has touched survives a scrape that drops its lead record.
//
// Run: npx tsx scripts/v2/smoke-deal-lead-snapshot.mjs
//
// Rule 19: AGENTIC_OS_DESK, UPWORK_LEADS_DIR and AGENTIC_OS_SETTINGS are redirected
// BEFORE any import, so this never reads the owner's real board or desk state.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-snapshot-"));
const leads = path.join(dir, "leads");
fs.mkdirSync(leads, { recursive: true });
process.env.AGENTIC_OS_DESK = path.join(dir, "upwork-desk.json");
process.env.UPWORK_LEADS_DIR = leads;
process.env.AGENTIC_OS_SETTINGS = path.join(dir, "settings.json");
fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, JSON.stringify({ memory: { ingestEnabled: false } }), "utf8");

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !extra ? "" : `  [${extra}]`}`);
  if (!cond) failures++;
};

const rec = (id, title) => ({
  id, title, url: `https://example.test/jobs/${id}`,
  budget: "$1k", jobType: "fixed", experienceLevel: "expert", duration: null,
  posted: new Date().toISOString(), description: "A listing.", tags: [],
  clientCountry: "US", clientTotalSpent: 5000, clientRating: 4.9, clientHires: 3,
  clientMemberSince: null, easiness: 7, winnability: 8, fit: 9, composite: 7.8,
});

const writeBoard = (rows) => fs.writeFileSync(path.join(leads, "board.json"), JSON.stringify(rows), "utf8");
const writePitches = (rows) => fs.writeFileSync(path.join(leads, "pitches.json"), JSON.stringify(rows), "utf8");
// The state file is only created on the first write, so a read before any mutation
// must answer "nothing yet" rather than throw.
const readState = () => {
  try { return JSON.parse(fs.readFileSync(process.env.AGENTIC_OS_DESK, "utf8")); } catch { return {}; }
};

writeBoard([rec("KEEP-1", "The one he approved"), rec("DROP-1", "Never touched")]);
writePitches([
  { id: "KEEP-1", url: "https://example.test/jobs/KEEP-1", title: "The one he approved", pitch: "draft", fitRefined: 9 },
  { id: "DROP-1", url: "https://example.test/jobs/DROP-1", title: "Never touched", pitch: "draft", fitRefined: 5 },
]);

const D = await import("../../src/lib/upworkDesk.ts");

// -- A the snapshot is taken the moment the owner commits ----------------------
console.log("");
console.log("-- A capture on first touch --");
{
  const before = await D.listDeals();
  check("A1 both leads are on the board to start", before.length === 2, String(before.length));
  check("A2 an untouched lead has no snapshot", !readState()["KEEP-1"]?.lead);

  await D.setStatus("KEEP-1", "approved");
  const snap = readState()["KEEP-1"].lead;
  check("A3 approving captures the lead record", !!snap);
  check("A4 with the title and url, which is what a card needs", snap.title === "The one he approved" && snap.url.endsWith("KEEP-1"));
  check("A5 tagged with where it came from", snap.from === "board", String(snap?.from));
  check("A6 and when", typeof snap.at === "number" && snap.at > 0);
  check("A7 the untouched lead still has none - it is pipeline output, not a commitment", !readState()["DROP-1"]?.lead);
}

// -- B a scrape that drops the record cannot take the card ---------------------
console.log("");
console.log("-- B surviving the wholesale board rewrite --");
{
  // Exactly what score_board.mjs does: replace board.json with this run's results.
  writeBoard([]);
  const after = await D.listDeals();
  const kept = after.find((d) => d.id === "KEEP-1");
  check("B1 the approved card is still on the board", !!kept);
  check("B2 with its status intact", kept?.status === "approved", String(kept?.status));
  check("B3 and its title, not a placeholder", kept?.title === "The one he approved");
  check("B4 the untouched lead is gone, which is correct", !after.find((d) => d.id === "DROP-1"));
  check("B5 a card captured live off board.json is not flagged as rebuilt", kept?.recovered !== true);
  check("B6 its real scores survived the rewrite", kept?.easiness === 7 && kept?.winnability === 8);
}

// -- C the owner is still the only one who removes a card ----------------------
console.log("");
console.log("-- C dismissal is still his call --");
{
  await D.setStatus("KEEP-1", "dismissed");
  const after = await D.listDeals();
  check("C1 dismissing removes it even though a snapshot exists", !after.find((d) => d.id === "KEEP-1"));
  check("C2 but the snapshot is kept, so the act is reversible", !!readState()["KEEP-1"].lead);
  await D.setStatus("KEEP-1", "approved");
  check("C3 and it comes back", !!(await D.listDeals()).find((d) => d.id === "KEEP-1"));
}

// -- D the capture happens once ------------------------------------------------
console.log("");
console.log("-- D captured once, not refreshed --");
{
  const at = readState()["KEEP-1"].lead.at;
  writeBoard([{ ...rec("KEEP-1", "A DIFFERENT TITLE"), easiness: 1 }]);
  await D.setNotes("KEEP-1", "a note");
  check("D1 a later touch does not overwrite the snapshot", readState()["KEEP-1"].lead.at === at);
  check("D2 nor its title", readState()["KEEP-1"].lead.title === "The one he approved");
  // With the record back in board.json the normal path serves it again, so the fresher
  // fields win on the card - the snapshot is a floor, never a ceiling.
  const live = (await D.listDeals()).find((d) => d.id === "KEEP-1");
  check("D3 while the live record is authoritative when it exists", live?.title === "A DIFFERENT TITLE", String(live?.title));
}

// -- E a rebuilt record admits what it does not know ---------------------------
console.log("");
console.log("-- E honesty about a pitches.json rebuild --");
{
  const st = readState();
  st["REBUILT-1"] = {
    status: "ready",
    editedPitch: "the proposal he wrote",
    lead: { id: "REBUILT-1", title: "Rebuilt from pitches", url: "https://example.test/jobs/REBUILT-1", fit: 9, at: Date.now(), from: "pitches" },
  };
  fs.writeFileSync(process.env.AGENTIC_OS_DESK, JSON.stringify(st), "utf8");
  const d = (await D.listDeals()).find((x) => x.id === "REBUILT-1");
  check("E1 it renders", !!d);
  check("E2 flagged as rebuilt so the UI can show NA rather than a zero", d?.recovered === true);
  check("E3 the fit the pitch pass judged is real and kept", d?.effectiveFit === 9);
  check("E4 the scraper's scores are absent, not invented", d?.easiness === 0 && d?.winnability === 0);
  check("E5 the owner's proposal survived, which is the whole point", d?.pitch === "the proposal he wrote");
  check("E6 an unknowable post date stays unknowable", d?.postedAt === null);
  check("E7 client details are null, never fabricated", d?.clientRating === null && d?.clientTotalSpent === null);
}

console.log(`\n${failures === 0 ? "OK" : "FAILED"}  ${failures} failure(s)`);
console.log(`fixture: ${dir}`);
process.exit(failures === 0 ? 0 : 1);
