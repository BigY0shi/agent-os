// The quick pass/not screen: the unknown/NA band, response parsing, the target
// selection, and the guarantee that a failed check persists nothing.
//
// Run: npx tsx scripts/v2/smoke-deal-screen.mjs
//
// Rule 19: AGENTIC_OS_DESK, UPWORK_LEADS_DIR, AGENTIC_OS_SETTINGS and
// AGENTIC_OS_RUNS_DIR are redirected BEFORE any import. Nothing here reads the
// owner's board, his settings, or his leads directory. No network, no claude:
// screenDeal is never called, only the pure pieces around it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-deal-screen-"));
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
const S = await import("../../src/lib/dealScreen.ts");
const D = await import("../../src/lib/upworkDesk.ts");

// -- A an unjudged lead is unknown, never banded off the feed's fit ----------
console.log("\n-- A unjudged leads read NA --");
{
  // The exact shape that produced the bug: a WeWorkRemotely row carrying fit 8 from
  // the feed's keyword pass, with no brief and no pitch. It used to render a green
  // "Pursue / No written verdict yet (fit 8/10)".
  const v = C.deriveVerdict({ why: null, summary: null, pitch: null, effectiveFit: 8 });
  check("A1 fit 8 with no evaluation is unknown, not pursue", v.band === "unknown", v.band);
  check("A2 the line says so plainly", v.line === "Not screened yet.", v.line);
  check("A3 source records that nothing looked at it", v.source === "none", v.source);
  check("A4 the band is purple", C.VERDICT_COLOR.unknown === "#c084fc", C.VERDICT_COLOR.unknown);
  check("A5 the label is NA", C.VERDICT_LABEL.unknown === "NA", C.VERDICT_LABEL.unknown);
  check("A6 fitLabel hides the number it never earned", C.fitLabel("unknown", 8) === "NA", C.fitLabel("unknown", 8));
  check("A7 fitLabel keeps the number once a band exists", C.fitLabel("pursue", 8) === "8", C.fitLabel("pursue", 8));
}
{
  // A fit of 9 is the strongest heuristic score in the corpus; it must still be NA.
  const v = C.deriveVerdict({ why: null, summary: null, pitch: null, effectiveFit: 9 });
  check("A8 even fit 9 stays unknown without an evaluation", v.band === "unknown", v.band);
  const z = C.deriveVerdict({ why: null, summary: null, pitch: null, effectiveFit: 0 });
  check("A9 and fit 0 is unknown too, not a pass", z.band === "unknown", z.band);
}

// -- B a real evaluation still bands, so the fix does not blank the board ----
console.log("\n-- B evaluated leads are unaffected --");
{
  const v = C.deriveVerdict({ why: "Strong fit: this is a Zapier consolidation.", summary: null, pitch: null, effectiveFit: 8 });
  check("B1 readable prose still bands pursue", v.band === "pursue" && v.source === "why", v.band);
  const p = C.deriveVerdict({ why: "Cold calling seat.", summary: null, pitch: "Skip - staffing role.", effectiveFit: 8 });
  check("B2 a Skip pitch still overrides a high fit", p.band === "pass", p.band);
  // Prose with no explicit call: banding THAT off the score is interpretation of a
  // real evaluation, which is allowed. Only the no-evaluation case became unknown.
  const s = C.deriveVerdict({ why: "They use Salesforce and Marketo.", summary: null, pitch: null, effectiveFit: 8 });
  check("B3 prose without a call still bands off the fit", s.band === "pursue" && s.source === "why", `${s.band}/${s.source}`);
}

// -- C the screen result outranks banding the fit ---------------------------
console.log("\n-- C a screen result is a real call --");
{
  const screen = { band: "pass", line: "Customer support manager seat, not a systems build.", at: Date.now() };
  const v = C.deriveVerdict({ why: null, summary: null, pitch: null, screen, effectiveFit: 8 });
  check("C1 the screen decides when nothing else has", v.band === "pass", v.band);
  check("C2 and its sentence is what the card shows", v.line === screen.line, v.line);
  check("C3 source names the screen", v.source === "screen", v.source);
  // A brief written later is richer than the screen, so it wins.
  const w = C.deriveVerdict({ why: "Strong fit: they want the whole pipeline rebuilt.", summary: null, pitch: null, screen, effectiveFit: 8 });
  check("C4 a later brief outranks the screen", w.band === "pursue" && w.source === "why", `${w.band}/${w.source}`);
}

// -- D parsing: anything unrecognised leaves the lead unscreened -------------
console.log("\n-- D response parsing --");
{
  check("D1 plain minified JSON parses",
    S.parseScreen('{"band":"pass","line":"Staff role."}')?.band === "pass");
  check("D2 fenced JSON with preamble still parses",
    S.parseScreen('Here you go:\n```json\n{"band":"pursue","line":"Zapier build."}\n```')?.band === "pursue");
  check("D3 band casing is normalised",
    S.parseScreen('{"band":"PASS","line":"No."}')?.band === "pass");
  check("D4 the sentence comes back trimmed",
    S.parseScreen('{"band":"maybe","line":"  Could go either way.  "}')?.line === "Could go either way.");
  // Every one of these must yield null, because null is what keeps a card at NA.
  check("D5 an unknown band is rejected", S.parseScreen('{"band":"probably","line":"x"}') === null);
  check("D6 'unknown' cannot be claimed by the model", S.parseScreen('{"band":"unknown","line":"x"}') === null);
  check("D7 a missing line is rejected", S.parseScreen('{"band":"pass"}') === null);
  check("D8 an empty line is rejected", S.parseScreen('{"band":"pass","line":"   "}') === null);
  check("D9 malformed JSON is rejected", S.parseScreen('{"band":"pass",') === null);
  check("D10 prose with no JSON is rejected", S.parseScreen('I think you should pass on this one.') === null);
  check("D11 an empty response is rejected", S.parseScreen('') === null);
  check("D12 a refusal is rejected", S.parseScreen('I cannot help with that.') === null);
}

// -- E persistence: a screen sticks, a failure writes nothing ----------------
console.log("\n-- E persistence --");
{
  const readLive = () => JSON.parse(fs.readFileSync(process.env.AGENTIC_OS_DESK, "utf8"));
  await D.setScreen("S-1", { band: "pass", line: "Support seat.", model: "test-model" });
  const live = readLive();
  check("E1 a screen persists with its band and line",
    live["S-1"].screen?.band === "pass" && live["S-1"].screen?.line === "Support seat.");
  check("E2 it records which model made the call", live["S-1"].screen?.model === "test-model");
  check("E3 and when", typeof live["S-1"].screen?.at === "number" && live["S-1"].screen.at > 0);

  // The failure path is the whole point: runScreenBatch only calls setScreen when
  // screenDeal returned a result, so a lead it could not judge has no screen key
  // at all and keeps reading NA.
  const before = JSON.stringify(readLive());
  const parsed = S.parseScreen("garbage, no json here");
  if (parsed) await D.setScreen("S-2", parsed);
  check("E4 an unparseable check writes nothing", JSON.stringify(readLive()) === before);
  check("E5 so the untouched lead is still unknown",
    C.deriveVerdict({ why: null, summary: null, pitch: null, screen: null, effectiveFit: 8 }).band === "unknown");
}

// -- F the guard rail on batch size -----------------------------------------
console.log("\n-- F batch bounds --");
{
  check("F1 MAX_SCREEN is a runaway guard, not a shortlist cap", S.MAX_SCREEN === 500, String(S.MAX_SCREEN));
  // No board fixture is written, so there is nothing to screen. This also proves the
  // planner does not throw on an empty board.
  const plan = await S.planScreenBatch();
  check("F2 an empty board plans nothing rather than failing", plan.ok === false && plan.reason === "nothing to screen", plan.reason);
  const st = S.screenBatchStatus();
  check("F3 a pass that never ran reports total 0", st.running === false && st.total === 0);
}

// -- G the model knob honours the gear --------------------------------------
console.log("\n-- G gear --");
{
  check("G1 blank settings fall back to the configured Claude model", typeof S.screenModel() === "string" && S.screenModel().length > 0, S.screenModel());
}

console.log(`\n${failures === 0 ? "OK" : "FAILED"}  ${failures} failure(s)`);
console.log(`fixture: ${dir}`);
process.exit(failures === 0 ? 0 : 1);
