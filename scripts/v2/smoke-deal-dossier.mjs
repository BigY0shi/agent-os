// The dossier: input hashing and staleness, response parsing, the coverage check's
// deliberate one-sidedness, and persistence.
//
// Run: npx tsx scripts/v2/smoke-deal-dossier.mjs
//
// Rule 19: AGENTIC_OS_DESK, UPWORK_LEADS_DIR, AGENTIC_OS_SETTINGS and
// AGENTIC_OS_RUNS_DIR are redirected BEFORE any import. No network and no claude:
// generateDossier is never called, only the pure pieces around it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-dossier-"));
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
const G = await import("../../src/lib/dealDossier.ts");
const D = await import("../../src/lib/upworkDesk.ts");

const baseInputs = {
  description: "We need a HubSpot to Snowflake pipeline. To Apply: state your hourly rate and open with the word ORCHID.",
  notes: "Quoted $2.5k for the 90-day ramp.",
  answers: [{ q: "Do we know Snowflake?", a: "Yes, two prior builds." }],
  summary: "Pipeline build.",
  why: "Squarely our lane.",
  approach: "Audit, then build.",
  crashCourse: "",
};

// -- A the hash notices every input, and only the inputs ---------------------
console.log("");
console.log("-- A input hashing --");
{
  const h = C.dossierInputHash(baseInputs);
  check("A1 hashing is stable across calls", h === C.dossierInputHash({ ...baseInputs }), h);
  check("A2 it is a short hex digest", /^[0-9a-f]{8}$/.test(h), h);
  const fields = ["description", "notes", "summary", "why", "approach", "crashCourse"];
  for (const k of fields) {
    const changed = C.dossierInputHash({ ...baseInputs, [k]: `${baseInputs[k]} CHANGED` });
    check(`A3 a change to ${k} changes the hash`, changed !== h, `${k}`);
  }
  // The case that matters most: the owner asks another question mid-review.
  const moreQA = C.dossierInputHash({
    ...baseInputs,
    answers: [...baseInputs.answers, { q: "Their timezone?", a: "US Eastern." }],
  });
  check("A4 a new Q&A answer changes the hash", moreQA !== h);
  const editedQA = C.dossierInputHash({
    ...baseInputs,
    answers: [{ q: "Do we know Snowflake?", a: "No, never used it." }],
  });
  check("A5 editing an existing answer changes the hash", editedQA !== h);
  check("A6 an empty input set still hashes", /^[0-9a-f]{8}$/.test(C.dossierInputHash({})));
}

// -- B staleness -------------------------------------------------------------
console.log("");
console.log("-- B staleness --");
{
  const h = C.dossierInputHash(baseInputs);
  const fresh = { asks: [], openWith: null, position: "p", gaps: [], at: Date.now(), inputHash: h };
  check("B1 a dossier matching its inputs is fresh", C.dossierIsStale(fresh, h) === false);
  check("B2 a dossier built from other inputs is stale", C.dossierIsStale(fresh, "deadbeef") === true);
  // No dossier must read as stale, not as fresh: the proposal path branches on this,
  // and "fresh" would mean writing with no account at all.
  check("B3 a missing dossier is stale", C.dossierIsStale(null, h) === true);
  check("B4 undefined is stale too", C.dossierIsStale(undefined, h) === true);
}

// -- C parsing ---------------------------------------------------------------
console.log("");
console.log("-- C response parsing --");
{
  const good = '{"asks":[{"ask":"State your rate","answer":"$2.5k for 90 days"}],"openWith":"ORCHID","position":"Our lane.","gaps":["Timezone"]}';
  const p = G.parseDossier(good);
  check("C1 a well-formed dossier parses", !!p && p.asks.length === 1);
  check("C2 the ask and answer survive", p.asks[0].ask === "State your rate" && p.asks[0].answer === "$2.5k for 90 days");
  check("C3 openWith survives", p.openWith === "ORCHID");
  check("C4 gaps survive", p.gaps.length === 1 && p.gaps[0] === "Timezone");
  check("C5 fenced output with preamble still parses", !!G.parseDossier('Sure:\n```json\n' + good + '\n```'));

  // An unanswered ask must come back as null, never as an empty string that would
  // render as though we had answered it.
  const nullAns = G.parseDossier('{"asks":[{"ask":"Rate?","answer":""}],"openWith":null,"position":"p","gaps":[]}');
  check("C6 an empty answer becomes null, not an empty answer", nullAns.asks[0].answer === null);
  const missingAns = G.parseDossier('{"asks":[{"ask":"Rate?"}],"openWith":null,"position":"p","gaps":[]}');
  check("C7 a missing answer becomes null", missingAns.asks[0].answer === null);

  // A listing that asks for nothing is legitimate, as long as we got a position.
  const noAsks = G.parseDossier('{"asks":[],"openWith":null,"position":"Straightforward build.","gaps":[]}');
  check("C8 no asks but a position is valid", !!noAsks && noAsks.asks.length === 0);
  // Neither asks nor position means the pass did not understand the listing.
  check("C9 neither asks nor position is rejected", G.parseDossier('{"asks":[],"openWith":null,"position":"","gaps":[]}') === null);

  check("C10 a non-array asks is rejected", G.parseDossier('{"asks":"lots","position":"p"}') === null);
  check("C11 malformed JSON is rejected", G.parseDossier('{"asks":[') === null);
  check("C12 prose with no JSON is rejected", G.parseDossier('I read the listing and it seems fine.') === null);
  check("C13 an empty response is rejected", G.parseDossier('') === null);
  check("C14 blank asks are dropped", G.parseDossier('{"asks":[{"ask":"  "},{"ask":"Rate?"}],"position":"p"}').asks.length === 1);
  check("C15 a blank openWith becomes null rather than an empty demand", G.parseDossier('{"asks":[],"openWith":"  ","position":"p"}').openWith === null);
  check("C16 non-array gaps degrade to empty", G.parseDossier('{"asks":[],"position":"p","gaps":"none"}').gaps.length === 0);
}

// -- D the coverage check only ever reports MISSES ---------------------------
console.log("");
console.log("-- D coverage is one-sided on purpose --");
{
  const dossier = {
    asks: [
      { ask: "State your hourly rate", answer: "$120" },
      { ask: "Describe your Snowflake experience", answer: "Two builds" },
    ],
    openWith: "ORCHID", position: "p", gaps: [], at: Date.now(), inputHash: "x",
  };
  const covering = "ORCHID. My hourly rate is $120. On Snowflake, I delivered two warehouse builds last year.";
  check("D1 a draft that echoes both asks flags nothing", C.likelyMissedAsks(covering, dossier).length === 0);

  const partial = "ORCHID. I would start with an audit of your pipeline and then build it out.";
  const missed = C.likelyMissedAsks(partial, dossier);
  check("D2 a draft answering neither flags both", missed.length === 2, String(missed.length));

  check("D3 an empty draft flags every ask", C.likelyMissedAsks("", dossier).length === 2);
  check("D4 no dossier flags nothing rather than throwing", C.likelyMissedAsks("anything", null).length === 0);
  check("D5 a dossier with no asks flags nothing", C.likelyMissedAsks("anything", { ...dossier, asks: [] }).length === 0);

  // The honesty guarantee: this reports what looks MISSING and never asserts coverage.
  // A draft can echo an ask's words without answering it, and the check must not be
  // read as proof either way - hence "likelyMissed", never "covered".
  check("D6 the helper is named for what it can actually claim", typeof C.likelyMissedAsks === "function" && typeof C.coveredAsks === "undefined");

  check("D7 the opening phrase is enforced", C.openWithViolated("My rate is $120.", dossier) === true);
  check("D8 and satisfied when present", C.openWithViolated("ORCHID. My rate is $120.", dossier) === false);
  check("D9 case and padding do not matter", C.openWithViolated("  orchid. My rate is $120.", dossier) === false);
  check("D10 no demanded phrase is never a violation", C.openWithViolated("anything", { ...dossier, openWith: null }) === false);
  check("D11 nor is a missing dossier", C.openWithViolated("anything", null) === false);
}

// -- E the rendered block tells the writer not to invent ---------------------
console.log("");
console.log("-- E rendering --");
{
  const d = {
    asks: [{ ask: "State your rate", answer: null }, { ask: "Timezone?", answer: "US Eastern" }],
    openWith: "ORCHID", position: "Our lane.", gaps: ["Their budget ceiling"], at: Date.now(), inputHash: "x",
  };
  const block = G.dossierBlock(d);
  check("E1 the opening phrase is stated as a requirement", block.includes("MUST OPEN WITH") && block.includes("ORCHID"));
  check("E2 every ask is numbered into the block", block.includes("1.") && block.includes("2."));
  check("E3 an unanswered ask says so instead of showing null", block.includes("do not invent") && !block.includes("null"));
  check("E4 gaps are carried through", block.includes("Their budget ceiling"));
  check("E5 the position is carried through", block.includes("Our lane."));
  const bare = G.dossierBlock({ asks: [], openWith: null, position: "p", gaps: [], at: 0, inputHash: "x" });
  check("E6 a listing that asks nothing renders honestly", bare.includes("asks for nothing specific") && !bare.includes("MUST OPEN WITH"));
}

// -- F persistence -----------------------------------------------------------
console.log("");
console.log("-- F persistence --");
{
  const readLive = () => JSON.parse(fs.readFileSync(process.env.AGENTIC_OS_DESK, "utf8"));
  const d = { asks: [{ ask: "Rate?", answer: "$120" }], openWith: null, position: "p", gaps: [], at: Date.now(), model: "test-model", inputHash: "abc12345" };
  await D.setDossier("DOS-1", d);
  const live = readLive();
  check("F1 the dossier persists", live["DOS-1"].dossier?.asks?.[0]?.ask === "Rate?");
  check("F2 with the hash it was built from", live["DOS-1"].dossier?.inputHash === "abc12345");
  check("F3 and which model built it", live["DOS-1"].dossier?.model === "test-model");

  // A failed build persists nothing, so the card has no dossier at all. That must read
  // as "build one", not as "this listing asks for nothing".
  const before = JSON.stringify(readLive());
  const parsed = G.parseDossier("the model refused");
  if (parsed) await D.setDossier("DOS-2", { ...parsed, at: Date.now(), inputHash: "x" });
  check("F4 an unusable response writes nothing", JSON.stringify(readLive()) === before);
  check("F5 so that card reads as stale and gets rebuilt", C.dossierIsStale(readLive()["DOS-2"]?.dossier, "x") === true);
}

// -- G the model knob ---------------------------------------------------------
console.log("");
console.log("-- G gear --");
{
  check("G1 a blank setting falls back to the configured Claude model", typeof G.dossierModel() === "string" && G.dossierModel().length > 0, G.dossierModel());
}

console.log(`\n${failures === 0 ? "OK" : "FAILED"}  ${failures} failure(s)`);
console.log(`fixture: ${dir}`);
process.exit(failures === 0 ? 0 : 1);
