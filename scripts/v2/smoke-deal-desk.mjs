// Deal Desk state store: generation rotation, crash recovery, and the write mutex.
//
// Run: npx tsx scripts/v2/smoke-deal-desk.mjs
//
// Rule 19: AGENTIC_OS_DESK and UPWORK_LEADS_DIR are redirected BEFORE the import,
// so this never reads or rewrites the owner's live board. That board held 145
// deals and 5 drafted proposals on 2026-09-01; this smoke exists because losing
// them to a truncated write was a real possibility.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-desk-"));
process.env.AGENTIC_OS_DESK = path.join(dir, "upwork-desk.json");
process.env.UPWORK_LEADS_DIR = path.join(dir, "leads");

const LIVE = process.env.AGENTIC_OS_DESK;
const PREV = path.join(dir, "upwork-desk_prev.json");
const GEN = "upwork-desk_gen_";

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !extra ? "" : `  [${extra}]`}`);
  if (!cond) failures++;
};
const readLive = () => JSON.parse(fs.readFileSync(LIVE, "utf8"));
const readPrev = () => JSON.parse(fs.readFileSync(PREV, "utf8"));
const strays = () => fs.readdirSync(dir).filter((n) => n.startsWith(GEN));

const D = await import("../../src/lib/upworkDesk.ts");

// -- A the rotation ----------------------------------------------------------
console.log("\n-- A the rotation --");
await D.setStatus("deal-1", "approved");
check("A1 the first write creates the live file", fs.existsSync(LIVE));
check("A2 the first write leaves no _prev, there was nothing to retire", !fs.existsSync(PREV));
check("A3 no staging file is left behind", strays().length === 0, strays().join(","));

await D.setEditedPitch("deal-2", "a drafted proposal that must never vanish");
check("A4 the second write retires generation 1 to _prev", fs.existsSync(PREV));
check("A5 _prev holds generation 1", Object.keys(readPrev()).length === 1);
check("A6 live holds generation 2", Object.keys(readLive()).length === 2);
check("A7 still no staging file left behind", strays().length === 0, strays().join(","));

await D.setStatus("deal-3", "new");
check("A8 renaming over an EXISTING _prev works on this platform", Object.keys(readPrev()).length === 2);
check("A9 live holds generation 3", Object.keys(readLive()).length === 3);

// -- B bodies are write-once -------------------------------------------------
console.log("\n-- B bodies are write-once --");
const beforeBytes = fs.readFileSync(LIVE, "utf8");
await D.setNotes("deal-1", "a note");
check("B1 the previous body survives byte for byte in _prev, moved not rewritten", fs.readFileSync(PREV, "utf8") === beforeBytes);
check("B2 live is a different body", fs.readFileSync(LIVE, "utf8") !== beforeBytes);
check("B3 the note landed", readLive()["deal-1"].notes === "a note");

// -- C a corrupt live file does not wipe the board ---------------------------
// This is the failure the rotation exists for. The old reader caught the parse
// error and returned {}, so the very next write persisted a one-deal board over
// the top of everything else.
console.log("\n-- C a corrupt live file does not wipe the board --");
const beforeCorrupt = Object.keys(readLive()).length;
fs.writeFileSync(LIVE, '{"deal-1": {"status": "appro', "utf8"); // truncated mid-write
await D.setStatus("deal-9", "new");
check("C1 every other deal survived", Object.keys(readLive()).length === beforeCorrupt + 1, `${Object.keys(readLive()).length} keys, expected ${beforeCorrupt + 1}`);
check("C2 the drafted proposal survived", readLive()["deal-2"]?.editedPitch === "a drafted proposal that must never vanish");
check("C3 the new write landed too", readLive()["deal-9"]?.status === "new");
// The recovery write must not retire the damaged file over the good _prev - that
// would destroy the only intact copy at the moment it is the only intact copy.
check("C4 _prev was left intact, not overwritten with the damaged file", Object.keys(readPrev()).length >= beforeCorrupt - 1);
check("C5 the damaged file was parked, never deleted", fs.readdirSync(dir).some((n) => n.startsWith("upwork-desk_corrupt_")));

// -- D a missing live file ---------------------------------------------------
console.log("\n-- D a missing live file --");
fs.renameSync(LIVE, path.join(dir, "moved-away.json")); // moved, never deleted
const beforeMissing = Object.keys(readPrev()).length;
await D.setStatus("deal-10", "new");
check("D1 recovers from _prev rather than starting empty", Object.keys(readLive()).length === beforeMissing + 1, `${Object.keys(readLive()).length} keys`);

// -- E an interrupted write beats the older _prev ----------------------------
console.log("\n-- E an interrupted write beats the older _prev --");
const orphanPath = path.join(dir, `${GEN}interrupted.json`);
fs.writeFileSync(orphanPath, JSON.stringify({ ...readLive(), "deal-orphan": { status: "ready" } }), "utf8");
fs.writeFileSync(LIVE, "not json at all", "utf8");
await D.setStatus("deal-11", "new");
check("E1 the interrupted write is preferred over the older _prev", !!readLive()["deal-orphan"]);
check("E2 and the drafted proposal is still there", readLive()["deal-2"]?.editedPitch === "a drafted proposal that must never vanish");

// -- F an ancient orphan must NOT roll the board back ------------------------
console.log("\n-- F an ancient orphan must not roll the board back --");
const stale = path.join(dir, `${GEN}ancient.json`);
fs.writeFileSync(stale, JSON.stringify({ "deal-ancient": { status: "new" } }), "utf8");
fs.utimesSync(stale, new Date(2000, 0, 1), new Date(2000, 0, 1));
fs.utimesSync(orphanPath, new Date(2000, 0, 2), new Date(2000, 0, 2));
fs.writeFileSync(LIVE, "still not json", "utf8");
await D.setStatus("deal-12", "new");
check("F1 an orphan older than _prev is ignored", !readLive()["deal-ancient"]);
check("F2 _prev was used instead, and the drafted proposal is still there", readLive()["deal-2"]?.editedPitch === "a drafted proposal that must never vanish");
// The guarantee is one generation, not all of them. _prev deliberately stops
// advancing while live keeps arriving damaged, since a known-good older copy
// beats a newer broken one - so back-to-back corruptions, as staged above, do
// lose the writes in between. A single corruption followed by any healthy write
// costs at most the one generation, because that healthy live then becomes _prev.
check("F3 the board did not collapse to the single new deal", Object.keys(readLive()).length >= 4, `${Object.keys(readLive()).length} keys`);

// -- G concurrent writes do not clobber each other ---------------------------
console.log("\n-- G concurrent writes do not clobber each other --");
await Promise.all([
  D.setStatus("deal-1", "sent"),
  D.setEditedPitch("deal-3", "second draft"),
  D.setNotes("deal-9", "third writer"),
]);
const g = readLive();
check("G1 all three concurrent writes survived", g["deal-1"]?.status === "sent" && g["deal-3"]?.editedPitch === "second draft" && g["deal-9"]?.notes === "third writer");

console.log(`\n${failures === 0 ? "OK" : "FAILED"}  ${failures} failure(s)`);
console.log(`fixture: ${dir}`);
process.exit(failures === 0 ? 0 : 1);
