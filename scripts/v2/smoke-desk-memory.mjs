// Deal Desk and Hire Engine -> Memory V2: what earns an episode and what does not.
//
// Run: npx tsx scripts/v2/smoke-desk-memory.mjs
//
// Rule 19: AGENTIC_OS_DB, AGENTIC_OS_SETTINGS and AGENTIC_OS_DESK are all
// redirected BEFORE the imports, so this never touches the owner's real memory
// database, settings, or board.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-deskmem-"));
process.env.AGENTIC_OS_DB = path.join(dir, "agentos.db");
process.env.AGENTIC_OS_SETTINGS = path.join(dir, "settings.json");
process.env.AGENTIC_OS_DESK = path.join(dir, "upwork-desk.json");
process.env.UPWORK_LEADS_DIR = path.join(dir, "leads");

// Offline, and it has to be written rather than assumed: the queue's drain loop
// runs `while (ingestEnabled())`, and with settings defaulting to true it woke up
// mid-run and made live calls to ollama.com with whatever credentials were on the
// box. This smoke is about what gets ENQUEUED; draining is Memory V2's own smoke.
fs.writeFileSync(process.env.AGENTIC_OS_SETTINGS, JSON.stringify({ memory: { ingestEnabled: false } }), "utf8");

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !extra ? "" : `  [${extra}]`}`);
  if (!cond) failures++;
};

const M = await import("../../src/lib/deskMemory.ts");
const { getDb } = await import("../../src/lib/v2/db.ts");

// The episode body lives inside the queue row's `data` JSON blob, not in a
// column of its own - the row is the envelope, `data` is the payload.
const queued = () =>
  getDb()
    .prepare("SELECT data, source, session_id AS sid FROM ingestion_queue ORDER BY rowid")
    .all()
    .map((r) => ({ ...r, body: JSON.parse(r.data).episodeBody ?? "" }));
const bodies = () => queued().map((r) => r.body);

const DEAL = { id: "job-1", title: "Zapier + HubSpot cleanup, 200 workflows", url: "https://x/1", context: "$3,000 fixed, client US" };
const LEAD = { id: "lead-1", title: "RevOps Manager", url: "https://y/1", context: "Acme, full-time, $140k" };

// -- A which statuses count as a decision ------------------------------------
console.log("\n-- A which statuses count as a decision --");
check("A1 deal approved is a judgment", M.isJudgmentStatus("deal-desk", "approved"));
check("A2 deal denied is a judgment", M.isJudgmentStatus("deal-desk", "denied"));
check("A3 deal sent is a judgment", M.isJudgmentStatus("deal-desk", "sent"));
check("A4 deal parked is a judgment", M.isJudgmentStatus("deal-desk", "parked"));
check("A5 deal new is NOT, it is triage motion", !M.isJudgmentStatus("deal-desk", "new"));
check("A6 deal reviewing is NOT", !M.isJudgmentStatus("deal-desk", "reviewing"));
check("A7 deal ready is NOT, it is a staging step between approved and sent", !M.isJudgmentStatus("deal-desk", "ready"));
check("A8 deal dismissed is NOT, refill dismisses in bulk", !M.isJudgmentStatus("deal-desk", "dismissed"));
check("A9 hire approved is a judgment", M.isJudgmentStatus("hire-engine", "approved"));
check("A10 hire researching is NOT", !M.isJudgmentStatus("hire-engine", "researching"));
check("A11 hire has no denied status, so it is not a judgment there", !M.isJudgmentStatus("hire-engine", "denied"));

// -- B a decision records the call AND the reason -----------------------------
console.log("\n-- B a decision records the call and the reason --");
await M.recordDeskDecision("deal-desk", DEAL, "denied", "Out of scope, this is creative video labor.");
const b1 = bodies().at(-1) ?? "";
check("B1 one episode was queued", queued().length === 1, `${queued().length}`);
check("B2 the body names the call", b1.includes("DENIED"));
check("B3 the body names the listing", b1.includes("Zapier + HubSpot cleanup"));
check("B4 the body carries the context line", b1.includes("$3,000 fixed"));
check("B5 the body carries the reason, which is the unregenerable part", b1.includes("Out of scope"));
check("B6 the session groups by listing so recall can pull one card's history", queued().at(-1).sid === "deal-desk-job-1");
check("B7 the source is the desk", queued().at(-1).source === "deal-desk");

await M.recordDeskDecision("deal-desk", DEAL, "approved", "");
check("B8 a decision with no note still records, and says so", (bodies().at(-1) ?? "").includes("No reason recorded"));

// -- C triage motion is silent ------------------------------------------------
console.log("\n-- C triage motion is silent --");
const before = queued().length;
await M.recordDeskDecision("deal-desk", DEAL, "reviewing", "moved it");
await M.recordDeskDecision("deal-desk", DEAL, "dismissed", "bulk refill");
await M.recordDeskDecision("deal-desk", DEAL, "ready", "");
await M.recordDeskDecision("hire-engine", LEAD, "researching", "");
check("C1 none of the four motion moves queued anything", queued().length === before, `${queued().length - before} extra`);

// -- D pitches and Q&A --------------------------------------------------------
console.log("\n-- D pitches and Q&A --");
await M.recordDeskPitch("deal-desk", DEAL, "You are running six tools that do not talk to each other.");
check("D1 a drafted pitch is recorded verbatim", (bodies().at(-1) ?? "").includes("six tools that do not talk"));
await M.recordDeskQA("hire-engine", LEAD, "Is the salary real?", "Published band, so probably yes.");
const d2 = bodies().at(-1) ?? "";
check("D2 a Q&A records both halves", d2.includes("Is the salary real?") && d2.includes("Published band"));
check("D3 and is filed under the hire desk", queued().at(-1).source === "hire-engine");

const beforeEmpty = queued().length;
await M.recordDeskPitch("deal-desk", DEAL, "   ");
await M.recordDeskQA("deal-desk", DEAL, "", "an answer to nothing");
await M.recordDeskQA("deal-desk", DEAL, "a question", "");
check("D4 empty pitches and half-empty Q&A are skipped, not queued blank", queued().length === beforeEmpty);

// -- E the short-body floor is a backstop, not the real gate ------------------
// Worth stating outright because it is counterintuitive: the 20-char floor
// cannot fire from any of the three entry points. Every body is wrapped in
// `Deal Desk: ... "title"`, which clears 20 chars on its own, so a two-character
// pitch still records. The gate that actually does the work is the empty check
// in D4. The floor stays as a backstop against a future builder that emits a
// bare body, and this test pins the real behaviour so nobody trusts the wrong one.
console.log("\n-- E the short-body floor is a backstop, not the real gate --");
const beforeShort = queued().length;
await M.recordDeskPitch("deal-desk", { id: "x", title: "a", url: null, context: null }, "no");
check("E1 a terse but real pitch records, because the envelope carries the context", queued().length === beforeShort + 1);
check("E2 and the envelope is what clears the floor", (bodies().at(-1) ?? "").length > 20, `${(bodies().at(-1) ?? "").length} chars`);

// -- F subject builders -------------------------------------------------------
console.log("\n-- F subject builders --");
const ds = M.dealSubject({ id: "j9", title: "Divi rebuild", url: "https://u/9", budget: "$1,200", jobType: "Fixed", clientCountry: "US", clientTotalSpent: 48000 });
check("F1 a deal subject carries id, title and url", ds.id === "j9" && ds.title === "Divi rebuild" && ds.url === "https://u/9");
check("F2 and a one-glance context line", ds.context === "$1,200, Fixed, client US, $48000 spent", ds.context ?? "null");
const hs = M.hireSubject({ id: "l9", title: "Ops Lead", url: "https://u/l9", company: "Acme", employment: "FTE", salary: "$130k", location: "Remote" });
check("F3 a hire subject builds the same shape", hs.context === "Acme, FTE, $130k, Remote", hs.context ?? "null");
const bare = M.dealSubject({ id: "j0", title: "Untitled", url: "", budget: null, jobType: null, clientCountry: null, clientTotalSpent: null });
check("F4 a listing with nothing known gets a null context, not a string of commas", bare.context === null, String(bare.context));

// -- G the route wiring, driven for real -------------------------------------
// tsc proves the imports resolve. It cannot prove the hook is reached, which is
// the half that silently does nothing if the call sits in the wrong branch. So
// this drives the actual action route against a fixture board.
console.log("\n-- G the route wiring, driven for real --");
fs.mkdirSync(process.env.UPWORK_LEADS_DIR, { recursive: true });
fs.writeFileSync(
  path.join(process.env.UPWORK_LEADS_DIR, "board.json"),
  JSON.stringify([{
    id: "route-1", title: "Snowflake and dbt pipeline audit", url: "https://x/route-1",
    budget: "$4,000", jobType: "Fixed", experienceLevel: "Expert", duration: null,
    posted: null, description: "audit the pipeline", tags: [], clientCountry: "US",
    clientTotalSpent: 91000, clientRating: 4.9, clientHires: 12, clientMemberSince: null,
    easiness: 3, winnability: 3, fit: 3, composite: 3,
  }]),
  "utf8",
);
// listDeals only surfaces the PITCHED shortlist - a board record with no matching
// pitches.json entry is skipped by url, so a board-only fixture yields nothing and
// getDeal returns null. Worth knowing beyond the test: a decision on an unpitched
// Upwork lead cannot be recorded, because the desk cannot see the lead either.
fs.writeFileSync(
  path.join(process.env.UPWORK_LEADS_DIR, "pitches.json"),
  JSON.stringify([{
    url: "https://x/route-1",
    summary: "They want the ingestion audited before a Series B data room.",
    why: "Strong fit, this is the same shape as the Fivetran migration.",
    approach: "Map the DAG, find the silent failures, then re-key the incremental loads.",
    crashCourse: "dbt incremental models; the gotcha is a changed unique_key silently full-refreshing.",
    pitch: "opener",
  }]),
  "utf8",
);
const post = (mod, payload) => mod.POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(payload) }));
const action = await import("../../src/app/api/deals/action/route.ts");

await post(action, { id: "route-1", action: "notes", value: "Client already tried Fivetran and it broke." });
const beforeRoute = queued().length;
await post(action, { id: "route-1", action: "status", value: "reviewing" });
check("G1 the route does NOT record triage motion", queued().length === beforeRoute);

const res = await post(action, { id: "route-1", action: "status", value: "approved" });
check("G2 the route still returns ok", (await res.json()).ok === true);
// The hooks are fire-and-forget, so let the microtask queue drain before asserting.
// Two of them fire on an approval and their order is not guaranteed, so find each
// episode by content rather than assuming which one landed last.
await new Promise((r) => setTimeout(r, 250));
const fresh = bodies().slice(beforeRoute);
const decision = fresh.find((b) => b.includes("APPROVED")) ?? "";
check("G3 approving recorded exactly two episodes, the decision and the brief", fresh.length === 2, `${fresh.length}`);
check("G4 the decision carries the listing title", decision.includes("Snowflake and dbt"));
check("G5 and the note the operator had already written, as the reason", decision.includes("already tried Fivetran"));

// -- H the brief, kept only for a lead we committed to ------------------------
console.log("\n-- H the brief, kept only for a lead we committed to --");
const brief = fresh.find((b) => b.includes("assessment of")) ?? "";
check("H1 approving also kept the assessment", brief.length > 0);
check("H2 it says why it was kept", brief.includes("because it was approved"));
check("H3 it carries what they want", brief.includes("Series B data room"));
check("H4 ...why we fit", brief.includes("same shape as the Fivetran migration"));
check("H5 ...the approach", brief.includes("re-key the incremental loads"));
check("H6 ...and the crash course, the part worth carrying forward", brief.includes("unique_key silently full-refreshing"));

const beforeDeny = queued().length;
await post(action, { id: "route-1", action: "status", value: "denied" });
await new Promise((r) => setTimeout(r, 250));
check("H7 denying records the decision but NOT the brief", queued().length === beforeDeny + 1, `${queued().length - beforeDeny}`);

const beforeBare = queued().length;
await M.recordDeskBrief("deal-desk", DEAL, { summary: null, why: "", approach: null, crashCourse: undefined });
check("H8 an approved lead that was never briefed records nothing", queued().length === beforeBare);

console.log(`\n${failures === 0 ? "OK" : "FAILED"}  ${failures} failure(s), ${queued().length} episodes queued`);
console.log(`fixture: ${dir}`);
process.exit(failures === 0 ? 0 : 1);
