// smoke-agents-questions — a background run asking the USER a question, OFFLINE.
//
// The bug this covers (found live 2026-08-28): an agent's clarifying question
// was pushed into the transcript as plain {kind:"text"} and nothing else
// happened — `waiting` was only reachable from queueApproval, i.e. from a TOOL
// asking permission, never from a sentence. The run carried on and guessed.
//
// Covers: detectQuestion (marker-first, heuristic opt-in) · parkRunOnQuestion
// flipping the run to `waiting` + the status snapshot agreeing (CONVENTIONS §6
// — getStatusSnapshot stays the single derivation) · the reply resuming the run
// through the SAME input queue · an UNANSWERED question finalizing as `error`,
// never a silent `done` (skip AND timeout legs) · the approvals route's answer
// verb · the ask-user protocol reaching BOTH lanes from the one render site.
//
// The turn path is driven with a SYNTHETIC message stream through the real
// consumeRunStream + makeTurnResultHandler — no SDK, no network, no model.
// Run: npx tsx scripts/v2/smoke-agents-questions.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// ── temp env BEFORE any src imports (smoke-agents-forge recipe) ──────────────
const stamp = Date.now();
const tmpDb = path.join(os.tmpdir(), `agentos-smoke-questions-${stamp}.db`);
process.env.AGENTIC_OS_DB = tmpDb;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-questions-settings-"));
const settingsFile = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_SETTINGS = settingsFile;
const agentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-questions-agents-"));
process.env.AGENTIC_OS_AGENTS_DIR = agentsDir;
// createAgent registers a PRINCIPAL (identity + a browser profile it owns),
// so an un-redirected run writes fake agents into the owner's real
// ~/.agentic-os/principals.json. That is what happened before this line
// existed. Rule 19: redirect every store the code under test writes to.
process.env.AGENTIC_OS_PRINCIPALS = path.join(agentsDir, "principals.json");
process.env.OLLAMA_URL = "http://127.0.0.1:1"; // dead port — nothing may reach a live model

const baseSettings = {
  memory: { ingestEnabled: false },
  capability: { browserEnabled: false },
  tasks: { timezone: "America/Chicago" },
  browser: { wsPort: 0, wsBind: "local", profiles: [], sessions: [] },
};
const writeSettings = (extra = {}) =>
  fs.writeFileSync(settingsFile, JSON.stringify({ ...baseSettings, ...extra }));
writeSettings();

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : extra ? `  [${JSON.stringify(extra).slice(0, 300)}]` : ""}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { NextRequest } = await import("next/server.js");
const store = await import("../../src/lib/agentsStore.ts");
const rt = await import("../../src/lib/agentsRuntime.ts");
const feed = await import("../../src/lib/v2/agents/statusFeed.ts");
const approvalsRoute = await import("../../src/app/api/agents/approvals/route.ts");

const req = (url, method = "GET", body = null) =>
  new NextRequest(`http://127.0.0.1:3737${url}`, {
    method,
    ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
  });

// A live run, seeded structurally into the registry agentsRuntime keeps on
// globalThis (the same read statusFeed does — no import cycle, no SDK).
const RUNS = (globalThis.__agentsRuns ??= new Map());
function seedRun(agentId, runId) {
  const meta = { id: runId, agentId, trigger: "manual", status: "running", startedAt: Date.now() };
  RUNS.set(runId, { meta, events: [], seq: 0, abort: new AbortController(), pending: new Map(), mcpHealth: [] });
  return RUNS.get(runId);
}
/** A synthetic SDK message stream — exactly the shape consumeRunStream reads. */
async function* stream(msgs) { for (const m of msgs) yield m; }
const resultMsg = (text) => ({ type: "result", subtype: "success", result: text, num_turns: 1 });

const ASK = { enabled: true, heuristic: false, timeoutMs: 60_000 };
const waitForCard = async (kind = "question") => {
  for (let i = 0; i < 100; i++) {
    const list = await rt.pendingApprovals();
    const hit = list.find((a) => a.kind === kind);
    if (hit) return hit;
    await sleep(20);
  }
  return null;
};

const agent = await store.createAgent({ name: "smoke asker", instructions: "ask when unsure" });

// ── §A detectQuestion: marker first, punctuation only when opted in ──────────
console.log("\n── §A detectQuestion ──");
{
  check("A1 marker on its own line is detected",
    rt.detectQuestion("Looked at the repo.\n[[ASK-USER]] Which branch should I target?") === "Which branch should I target?");
  check("A2 a multi-line question after the marker is kept whole",
    rt.detectQuestion("[[ASK-USER]] Two options:\n(a) rebase\n(b) merge\nWhich?") === "Two options:\n(a) rebase\n(b) merge\nWhich?");
  check("A3 a BARE marker still parks (an agent that asked badly is not 'finished')",
    typeof rt.detectQuestion("[[ASK-USER]]") === "string");
  check("A4 plain finished work is NOT a question", rt.detectQuestion("Done. Wrote 3 files.") === null);

  const rhetorical = "Shipped the migration.\nWhat did that buy us? A clean rollback path.";
  check("A5 no marker + heuristic OFF → not a question (default)", rt.detectQuestion(rhetorical) === null);

  const trailing = "I need the target env.\nShould I deploy to staging or prod?";
  check("A6 heuristic OFF ignores a trailing question mark", rt.detectQuestion(trailing) === null);
  check("A7 heuristic ON catches it",
    rt.detectQuestion(trailing, true) === "Should I deploy to staging or prod?");
  check("A8 heuristic ON still rejects a long trailing paragraph (not a question)",
    rt.detectQuestion(`x\n${"y".repeat(320)}?`, true) === null);
  check("A9 the marker wins even when the heuristic is off",
    rt.detectQuestion("[[ASK-USER]] staging or prod?", false) === "staging or prod?");
}

// ── §B park → waiting → reply → running (the transition sites) ───────────────
console.log("\n── §B park / reply cycle ──");
{
  const r = seedRun(agent.id, "run-park-1");
  const parked = rt.parkRunOnQuestion(agent, "run-park-1", "Which inbox label should I use?");

  const card = await waitForCard();
  check("B1 the question lands on the pending queue as kind 'question'",
    !!card && card.kind === "question" && card.reason === "question", card);
  check("B2 the card carries the question verbatim for the reply box",
    card?.question === "Which inbox label should I use?", card);
  check("B3 the run flipped to waiting (the amber band's source)", r.meta.status === "waiting", r.meta);

  const snap = await feed.getStatusSnapshot();
  const mine = snap.find((e) => e.agentId === agent.id);
  check("B4 getStatusSnapshot agrees — waiting (CONVENTIONS §6, not re-derived)",
    mine?.status === "waiting", mine);

  const ev = r.events.find((e) => e.kind === "question");
  check("B5 the transcript records a 'question' event tied to the pending id",
    !!ev && ev.text === "Which inbox label should I use?" && ev.approvalId === card.id, ev);

  const delivered = await rt.answerQuestion(card.id, "  Use label: Ops/Triage  ");
  const answer = await parked;
  check("B6 answerQuestion resolves the parked promise", delivered === true);
  check("B7 the reply arrives trimmed, ready to push into the input queue",
    answer === "Use label: Ops/Triage", answer);
  check("B8 the run is back to running", r.meta.status === "running", r.meta);
  check("B9 the card is off the pending queue", (await rt.pendingApprovals()).length === 0);
  check("B10 an empty reply is refused (it would resume the agent with nothing)",
    (await rt.answerQuestion(card.id, "   ")) === false);
  RUNS.delete("run-park-1");
}

// ── §C the real turn path: a question suspends the stream, a reply resumes ───
console.log("\n── §C turn path — question → reply → done ──");
{
  const r = seedRun(agent.id, "run-turn-1");
  const pushed = [];
  const queue = { push: (t) => pushed.push(t), close: () => pushed.push("<CLOSED>") };
  const onTurn = rt.makeTurnResultHandler(agent, "run-turn-1", null, queue, ASK);

  const done = rt.consumeRunStream("run-turn-1", stream([
    { type: "assistant", message: { content: [{ type: "text", text: "Checked the repo." }] } },
    resultMsg("Checked the repo.\n[[ASK-USER]] Target master or the feature branch?"),
    resultMsg("Opened the PR against master."),
  ]), onTurn);

  const card = await waitForCard();
  check("C1 the stream is suspended mid-iteration on the question", !!card && r.meta.status === "waiting");
  await rt.answerQuestion(card.id, "the feature branch");
  await done;

  check("C2 the answer was pushed into the run's OWN input queue (same session)",
    pushed[0] === "the feature branch", pushed);
  check("C3 the run then completed normally", r.meta.status === "done", r.meta);
  check("C4 ...with the post-answer result, not the question turn",
    r.meta.result === "Opened the PR against master.", r.meta.result);
  check("C5 no stranded marker left behind", r.stranded === undefined);
  RUNS.delete("run-turn-1");
}

// ── §D an UNANSWERED question must not silently complete ────────────────────
console.log("\n── §D unanswered → error, never a silent done ──");
{
  // D-i: the user skips it (Deny on the question card).
  const r = seedRun(agent.id, "run-turn-2");
  const queue = { push: () => {}, close: () => {} };
  const onTurn = rt.makeTurnResultHandler(agent, "run-turn-2", null, queue, ASK);
  const done = rt.consumeRunStream("run-turn-2", stream([
    resultMsg("[[ASK-USER]] Ship it now or wait for review?"),
  ]), onTurn);

  const card = await waitForCard();
  await rt.resolveApproval(card.id, false); // "Skip" on the card
  await done;

  check("D1 skipped question → run status error (NOT done)", r.meta.status === "error", r.meta);
  check("D2 the error names the unanswered question",
    /unanswered question/.test(r.meta.error ?? "") && /Ship it now/.test(r.meta.error ?? ""), r.meta.error);
  check("D3 the transcript says so out loud",
    r.events.some((e) => e.kind === "status" && /went unanswered/.test(e.detail ?? "")), r.events.map((e) => e.detail));
  check("D4 the SDK's own 'success' subtype did NOT make it a completed run",
    r.meta.status !== "done");
  RUNS.delete("run-turn-2");

  // D-ii: nobody ever answers — the park times out on its own.
  const r2 = seedRun(agent.id, "run-turn-3");
  const timedOut = await rt.parkRunOnQuestion(agent, "run-turn-3", "Anyone there?", 60);
  check("D5 the park times out to null rather than hanging forever", timedOut === null);
  check("D6 ...and marks the run stranded for the caller to finalize as error",
    r2.stranded === "Anyone there?", r2.stranded);
  check("D7 the timed-out card is cleaned off the pending queue",
    (await rt.pendingApprovals()).every((a) => a.runId !== "run-turn-3"));
  RUNS.delete("run-turn-3");

  // D-iii: killing a parked run unparks the question instead of leaking it.
  const r3 = seedRun(agent.id, "run-turn-4");
  const parked = rt.parkRunOnQuestion(agent, "run-turn-4", "Still waiting?");
  await waitForCard();
  rt.killRun("run-turn-4");
  check("D8 killRun unparks a waiting question (null, not a hung promise)", (await parked) === null);
  RUNS.delete("run-turn-4");
}

// ── §E the approvals route's answer verb ─────────────────────────────────────
console.log("\n── §E /api/agents/approvals ──");
{
  const r = seedRun(agent.id, "run-route-1");
  const parked = rt.parkRunOnQuestion(agent, "run-route-1", "Which client is this for?");
  const card = await waitForCard();

  const list = await (await approvalsRoute.GET()).json();
  check("E1 GET carries the question card with its kind + text",
    list.approvals.some((a) => a.id === card.id && a.kind === "question" && a.question === "Which client is this for?"), list.approvals);

  const empty = await approvalsRoute.POST(req("/api/agents/approvals", "POST", { id: card.id, answer: "   " }));
  check("E2 an empty answer → 400 (never resume an agent with nothing)", empty.status === 400);

  const noId = await approvalsRoute.POST(req("/api/agents/approvals", "POST", { answer: "hi" }));
  check("E3 missing id → 400", noId.status === 400);

  const res = await approvalsRoute.POST(req("/api/agents/approvals", "POST", { id: card.id, answer: "Cobalt Research Supply" }));
  const j = await res.json();
  check("E4 POST {id, answer} resolves the question", res.status === 200 && j.ok === true, j);
  check("E5 ...and the run receives it", (await parked) === "Cobalt Research Supply");

  const stale = await approvalsRoute.POST(req("/api/agents/approvals", "POST", { id: "no-such-card", answer: "x" }));
  const staleJson = await stale.json();
  check("E6 a stale card answers ok:false / stale:true (server restarted)", staleJson.ok === false && staleJson.stale === true, staleJson);

  const badDecision = await approvalsRoute.POST(req("/api/agents/approvals", "POST", { id: card.id, decision: "maybe" }));
  check("E7 an unknown decision is still rejected", badDecision.status === 400);
  RUNS.delete("run-route-1");
}

// ── §F the protocol reaches both lanes from the ONE render site ──────────────
console.log("\n── §F ask-user protocol wiring ──");
{
  const src = read("src/lib/agentsRuntime.ts");
  check("F1 the protocol is appended to renderedSystem — the single render site both lanes read",
    /const renderedSystem = renderHarness\(def, harness, system\)\s*\n\s*\+ \(ask\.enabled \? `\\n\\n\$\{ASK_USER_PROTOCOL\}` : ""\);/.test(src));
  check("F2 the provider lane (cli/ollama) gets the same ask config, not a fork",
    /executeViaProvider\(def, runId, provider, renderedSystem, harness, prompt, ask\)/.test(src) &&
    /ask: AskUserConfig,/.test(src));
  check("F3 the provider lane parks on a question too",
    /const question = ask\.enabled \? detectQuestion\(lastOut, ask\.heuristic\) : null;/.test(src));
  check("F4 the protocol tells the agent the exact marker",
    src.includes("${ASK_USER_MARKER} <your question"));

  check("F5 the one-shot queue is no longer closed up front (no channel to answer into)",
    !/if \(!controller\) queue\.close\(\);/.test(src));
  check("F6 park + resume hit the SAME notifyStatus transition sites as approvals",
    (src.match(/void notifyStatus\(def\.id\); \/\/ F2\.1 transition site/g) ?? []).length >= 4);
  check("F7 band status is never re-derived here (CONVENTIONS §6 — statusFeed owns it)",
    !/BandStatus/.test(src) && !/getStatusSnapshot/.test(src));

  const strip = read("src/components/AgentsView.tsx");
  check("F8 the approvals strip renders a reply box for question cards",
    /kind === "question" \? \(\s*<QuestionCard/.test(strip) && /onAnswer\?: \(id: string, answer: string\) => void/.test(strip));
  check("F9 the run transcript renders the question event",
    /ev\.kind === "question"/.test(strip));

  const types = read("src/lib/agentsTypes.ts");
  check("F10 ApprovalReq.kind is OPTIONAL (old approvals.json parses unchanged)",
    /kind\?: PendingKind;/.test(types));
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}  (temp db: ${tmpDb}, agents: ${agentsDir})`);
process.exit(failures === 0 ? 0 : 1); // route imports hold ensureV2 timers
