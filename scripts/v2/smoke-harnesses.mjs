// SPEC-E F3.1/F3.2/F1.2 smoke: migration 051, harness seeds + CRUD +
// exile-not-drop, renderHarness/persona injection, the rule-11 fail-loud
// provider legs (cli AND ollama — both offline: bogus agent throws before any
// spawn, ollama points at a dead port), the §9.5 browser_evaluate approval
// seam (fail-closed), and the F1.2 lifecycle trigger-skip + deploy guard.
// Run: npx tsx scripts/v2/smoke-harnesses.mjs
//
// Temp-env recipe (smoke-browser-ws pattern) — the LIVE stores are never
// touched; process.exit at the end because route imports boot timers.
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// ── temp env BEFORE any src imports ──────────────────────────────────────────
const stamp = Date.now();
const tmpDb = path.join(os.tmpdir(), `agentos-smoke-harness-${stamp}.db`);
process.env.AGENTIC_OS_DB = tmpDb;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-harness-settings-"));
const settingsFile = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_SETTINGS = settingsFile;
const agentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-harness-agents-"));
process.env.AGENTIC_OS_AGENTS_DIR = agentsDir;
// createAgent registers a PRINCIPAL (identity + a browser profile it owns),
// so an un-redirected run writes fake agents into the owner's real
// ~/.agentic-os/principals.json. That is what happened before this line
// existed. Rule 19: redirect every store the code under test writes to.
process.env.AGENTIC_OS_PRINCIPALS = path.join(agentsDir, "principals.json");
process.env.OLLAMA_URL = "http://127.0.0.1:1"; // dead port — the ollama leg MUST fail loudly, offline
fs.writeFileSync(
  settingsFile,
  JSON.stringify({
    memory: { ingestEnabled: false },
    capability: { browserEnabled: false },
    tasks: { timezone: "America/Chicago" },
    browser: { wsPort: 0, wsBind: "local", profiles: [], sessions: [] },
  }),
);

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : extra ? `  [${extra}]` : ""}`);
  if (!cond) failures++;
};

const h = await import("../../src/lib/v2/agents/harnesses.ts");
const lc = await import("../../src/lib/v2/agents/lifecycle.ts");
const store = await import("../../src/lib/agentsStore.ts");
const { getDb } = await import("../../src/lib/v2/db.ts");

// ── §A migration 051 + seeds ─────────────────────────────────────────────────
console.log("\n── §A migration + seedBuiltins ──");
{
  const db = getDb();
  const applied = db.prepare("SELECT version FROM migrations WHERE version = 51").get();
  check("A1 migration 51 (agents_harnesses_status) applied", !!applied);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('harnesses','agent_status_events')").all();
  check("A2 harnesses + agent_status_events tables exist", tables.length === 2, JSON.stringify(tables));
  const cols = db.prepare("PRAGMA table_info(harnesses)").all().map((c) => `${c.name}:${c.type}`);
  check("A3 harness timestamps are TEXT (CONVENTIONS §1.4 amends SPEC-E's INTEGER DDL)",
    cols.includes("created_at:TEXT") && cols.includes("updated_at:TEXT"), JSON.stringify(cols));
  const evCols = db.prepare("PRAGMA table_info(agent_status_events)").all().map((c) => `${c.name}:${c.type}`);
  check("A4 agent_status_events.ts is TEXT", evCols.includes("ts:TEXT"), JSON.stringify(evCols));

  const list1 = h.listHarnesses();
  const ids = list1.map((x) => x.id).sort();
  check("A5 four builtins seeded (oneshot-plain/ralph-loop/fable-harness/feat-loop)",
    JSON.stringify(ids) === JSON.stringify(["fable-harness", "feat-loop", "oneshot-plain", "ralph-loop"]), JSON.stringify(ids));
  h.seedBuiltins();
  check("A6 seedBuiltins idempotent (still 4 rows)", h.listHarnesses().length === 4);
  const ralph = h.getHarness("ralph-loop");
  check("A7 ralph-loop is a loop harness with stopWhen marker + preamble",
    ralph?.kind === "loop" && ralph?.definition.loop?.stopWhen === "LOOP-COMPLETE" && /ONE/.test(ralph?.definition.systemPreamble ?? ""));
  const feat = h.getHarness("feat-loop");
  check("A8 feat-loop has plan→build→verify phases with an approval gate on build",
    Array.isArray(feat?.definition.phases) && feat.definition.phases.length === 3 &&
    feat.definition.phases[0].name === "plan" && feat.definition.phases[1].gate === "approval");
  check("A9 oneshot-plain has an EMPTY preamble (today's behavior)",
    h.getHarness("oneshot-plain")?.definition.systemPreamble === "");
}

// ── §B CRUD + exile-not-drop ─────────────────────────────────────────────────
console.log("\n── §B CRUD + exile semantics ──");
{
  const created = h.createHarness({
    name: "Smoke Custom", description: "smoke", kind: "loop",
    definition: { systemPreamble: "SMOKE PREAMBLE", loop: { maxIterations: 2, stopWhen: "SMOKE-DONE" } },
  });
  check("B1 createHarness → row with kebab id", created.id === "smoke-custom", JSON.stringify(created));
  const patched = h.patchHarness("smoke-custom", { definition: { systemPreamble: "SMOKE PREAMBLE v2", loop: { maxIterations: 3, stopWhen: "SMOKE-DONE" } } });
  check("B2 patchHarness round-trips the definition", patched.definition?.systemPreamble === "SMOKE PREAMBLE v2" && patched.definition.loop.maxIterations === 3);

  const exiled = h.exileHarness("smoke-custom");
  check("B3 exileHarness on a user row → ok", exiled.ok === true, JSON.stringify(exiled));
  check("B4 exiled row hidden from the default list", !h.listHarnesses().some((x) => x.id === "smoke-custom"));
  check("B5 exiled row visible with includeExiled", h.listHarnesses({ includeExiled: true }).some((x) => x.id === "smoke-custom"));
  const rowStillThere = getDb().prepare("SELECT definition FROM harnesses WHERE id = 'smoke-custom'").get();
  check("B6 EXILE-NOT-DROP: the row still exists, definition JSON carries exiled:true",
    !!rowStillThere && JSON.parse(rowStillThere.definition).exiled === true);

  const refused = h.exileHarness("ralph-loop");
  check("B7 builtin exile refused", "error" in refused && /builtin/.test(refused.error));
  const editedBuiltin = h.patchHarness("ralph-loop", { description: "edited by smoke" });
  check("B8 builtin stays editable (editable-but-not-deletable)", editedBuiltin.description === "edited by smoke");
  const sneaky = h.patchHarness("ralph-loop", { definition: { ...h.getHarness("ralph-loop").definition, exiled: true } });
  check("B9 a definition edit cannot sneak a builtin into exile", sneaky.definition?.exiled !== true &&
    h.listHarnesses().some((x) => x.id === "ralph-loop"));

  check("B10 validateHarnessDef rejects loop+phases combined",
    h.validateHarnessDef({ systemPreamble: "", loop: { maxIterations: 2, stopWhen: "X" }, phases: [{ name: "a", prompt: "b" }] }) !== null);
  check("B11 validateHarnessDef rejects a bad gate",
    h.validateHarnessDef({ systemPreamble: "", phases: [{ name: "a", prompt: "b", gate: "sometimes" }] }) !== null);
}

// ── §C renderHarness / persona injection (rule 17: ONE render site) ──────────
console.log("\n── §C renderHarness ──");
{
  const persona = { name: "Test Voice", voiceRules: "short sentences", audience: "devs", bannedPhrases: ["synergy", "delve"], ctaStyle: "soft ask" };
  const ralph = h.getHarness("ralph-loop");
  const out = h.renderHarness({ name: "smokey", persona }, ralph, "SYSTEM.MD CONTENT HERE");
  check("C1 persona block + preamble + system.md, in that order",
    out.indexOf("Test Voice") >= 0 &&
    out.indexOf("Test Voice") < out.indexOf("OPERATING HARNESS") &&
    out.indexOf("OPERATING HARNESS") < out.indexOf("SYSTEM.MD CONTENT HERE"));
  check("C2 banned phrases surfaced", out.includes("synergy") && out.includes("delve"));
  const plain = h.renderHarness({ name: "smokey" }, null, "  JUST SYSTEM  ");
  check("C3 no harness + no persona → trimmed system.md only", plain === "JUST SYSTEM");
  const oneshot = h.renderHarness({ name: "smokey" }, h.getHarness("oneshot-plain"), "SYS");
  check("C4 oneshot-plain adds nothing (empty preamble)", oneshot === "SYS");
}

// ── §D rule-11 fail-loud provider legs (OFFLINE by construction) ─────────────
console.log("\n── §D provider fail-loud (rule 11) ──");
const runtime = await import("../../src/lib/agentsRuntime.ts");
{
  const waitForEnd = async (agentId, runId, ms = 15000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const meta = await store.loadRunMeta(agentId, runId);
      if (meta?.endedAt) return meta;
      if (Date.now() > deadline) return meta;
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  // (a) cli provider with an unwired agent name — cliComplete throws BEFORE any
  // spawn ("isn't wired for Loop yet"), so this leg is fully offline.
  const cliAgent = await store.createAgent({ name: "smoke cli provider", instructions: "reply ok" });
  await store.saveAgent({ ...cliAgent, provider: { kind: "cli", agent: "not-a-real-agent" } });
  const cliDef = await store.loadAgent(cliAgent.id);
  const started = await runtime.startRun(cliDef, "manual");
  check("D1 startRun accepts the cli-provider agent", "runId" in started, JSON.stringify(started));
  const cliMeta = await waitForEnd(cliAgent.id, started.runId);
  check("D2 cli provider run FAILED LOUDLY (status error, names the provider)",
    cliMeta?.status === "error" && /provider cli:not-a-real-agent/.test(cliMeta?.error ?? ""), JSON.stringify(cliMeta));
  check("D3 error explains the unwired CLI (no silent behavior)", /isn't wired/.test(cliMeta?.error ?? ""), cliMeta?.error);
  const cliEvents = await store.readRunEvents(cliAgent.id, started.runId);
  check("D4 transcript shows the provider lane init (rule-11 note), NEVER an SDK model init",
    cliEvents.some((e) => e.kind === "init" && /provider cli:not-a-real-agent/.test(e.detail ?? "")) &&
    !cliEvents.some((e) => e.kind === "init" && /model /.test(e.detail ?? "")));

  // (b) ollama provider at a dead port — fetch fails, run errors loudly.
  const olAgent = await store.createAgent({ name: "smoke ollama provider", instructions: "reply ok" });
  await store.saveAgent({ ...olAgent, provider: { kind: "ollama", model: "smoke-model" } });
  const olDef = await store.loadAgent(olAgent.id);
  const started2 = await runtime.startRun(olDef, "manual");
  const olMeta = await waitForEnd(olAgent.id, started2.runId);
  check("D5 ollama provider run FAILED LOUDLY (status error, names provider ollama:smoke-model)",
    olMeta?.status === "error" && /provider ollama:smoke-model/.test(olMeta?.error ?? ""), JSON.stringify(olMeta));

  // (c) the transitions landed in agent_status_events (F2.1 tied to real runs).
  const rows = getDb().prepare("SELECT status FROM agent_status_events WHERE agent_id = ? ORDER BY id").all(cliAgent.id).map((r) => r.status);
  check("D6 real run produced status rows ending in error", rows.includes("running") || rows.includes("error"), JSON.stringify(rows));

  // (d) a missing harness id fails loudly too (never silently ignored).
  const badH = await store.createAgent({ name: "smoke bad harness", instructions: "reply ok" });
  await store.saveAgent({ ...badH, harnessId: "no-such-harness", provider: { kind: "cli", agent: "not-a-real-agent" } });
  const badDef = await store.loadAgent(badH.id);
  const started3 = await runtime.startRun(badDef, "manual");
  const badMeta = await waitForEnd(badH.id, started3.runId);
  check("D7 missing harness id errors the run loudly", badMeta?.status === "error" && /no-such-harness/.test(badMeta?.error ?? ""), JSON.stringify(badMeta));

  // (e) §9.5 seam: ask-mode agent + browser_evaluate with NO active run → fail closed.
  const askRes = await runtime.requestAgentToolApproval(cliAgent.id, "browser_evaluate", { script: "1+1" }, "smoke");
  check("D8 requestAgentToolApproval with no active run → denied (fail closed)",
    askRes.allowed === false && /no active run/.test(askRes.reason ?? ""), JSON.stringify(askRes));
}

// ── §E lifecycle: trigger skip + deploy guard ────────────────────────────────
console.log("\n── §E lifecycle (F1.2) ──");
{
  check("E1 absent lifecycle → triggers allowed (deployed)", lc.lifecycleAllowsTriggers({}) === true);
  check("E2 deployed → allowed", lc.lifecycleAllowsTriggers({ lifecycle: "deployed" }) === true);
  for (const skip of ["ideation", "forge", "test", "retired"]) {
    check(`E3 ${skip} → trigger tick SKIPS`, lc.lifecycleAllowsTriggers({ lifecycle: skip }) === false);
  }
  const triggers = read("src/lib/agentsTriggers.ts");
  check("E4 tick loop wired to lifecycleAllowsTriggers", /lifecycleAllowsTriggers\(def\)/.test(triggers));

  const agent = await store.createAgent({ name: "smoke lifecycle", instructions: "reply ok" });
  await store.saveAgent({ ...agent, lifecycle: "test" });
  const denied = await lc.transitionLifecycle(agent.id, "deployed");
  check("E5 deploy BEFORE any done run → guard refuses (409)", "error" in denied && denied.status === 409, JSON.stringify(denied));
  await store.saveRunMeta({ id: "run-ok-1", agentId: agent.id, trigger: "manual", status: "done", startedAt: Date.now() - 5000, endedAt: Date.now() - 4000, result: "ok" });
  const deployed = await lc.transitionLifecycle(agent.id, "deployed");
  check("E6 deploy AFTER a done run succeeds", "agent" in deployed && deployed.agent.lifecycle === "deployed", JSON.stringify(deployed));
  const onDisk = await store.loadAgent(agent.id);
  check("E7 lifecycle round-trips through agent.json (F1.1 write round-trip)", onDisk?.lifecycle === "deployed");

  // PATCH route enforces the same guard (used by the wizard's Deploy button).
  const { NextRequest } = await import("next/server.js");
  const idRoute = await import("../../src/app/api/agents/[id]/route.ts");
  const agent2 = await store.createAgent({ name: "smoke patch lifecycle", instructions: "reply ok" });
  await store.saveAgent({ ...agent2, lifecycle: "test" });
  const patchReq = (body) =>
    idRoute.PATCH(
      new NextRequest(`http://127.0.0.1:3737/api/agents/${agent2.id}`, { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
      { params: Promise.resolve({ id: agent2.id }) },
    );
  const res409 = await patchReq({ lifecycle: "deployed" });
  check("E8 PATCH lifecycle:deployed without a done run → 409", res409.status === 409, `status ${res409.status}`);
  const resV2 = await patchReq({ harnessId: "ralph-loop", persona: { name: "P", voiceRules: "v", bannedPhrases: ["x"] }, provider: { kind: "cli", agent: "claude" }, browserSessions: ["research"] });
  const v2Json = await resV2.json();
  check("E9 PATCH round-trips the V2 fields (harnessId/persona/provider/browserSessions)",
    resV2.status === 200 && v2Json.agent.harnessId === "ralph-loop" && v2Json.agent.persona?.name === "P" &&
    v2Json.agent.provider?.kind === "cli" && v2Json.agent.browserSessions?.[0] === "research", JSON.stringify(v2Json).slice(0, 300));
  const onDisk2 = await store.loadAgent(agent2.id);
  check("E10 V2 fields persisted to agent.json", onDisk2?.harnessId === "ralph-loop" && onDisk2?.persona?.name === "P");
  const badProvider = await patchReq({ provider: { kind: "cli" } });
  check("E11 PATCH rejects a malformed provider", badProvider.status === 400);
}

// ── §F harnesses route (exile-not-drop over HTTP) ────────────────────────────
console.log("\n── §F /api/v2/harnesses route ──");
{
  const { NextRequest } = await import("next/server.js");
  const route = await import("../../src/app/api/v2/harnesses/route.ts");
  const req = (method, body, qs = "") =>
    new NextRequest(`http://127.0.0.1:3737/api/v2/harnesses${qs}`, { method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });

  const listRes = await route.GET(req("GET"));
  const listJson = await listRes.json();
  check("F1 GET lists the builtins (seeded lazily)", listRes.status === 200 && listJson.harnesses.length >= 4);

  const postRes = await route.POST(req("POST", { name: "Route Smoke", definition: { systemPreamble: "RS" } }));
  const postJson = await postRes.json();
  check("F2 POST creates a user harness", postRes.status === 200 && postJson.harness?.id === "route-smoke", JSON.stringify(postJson));

  const patchRes = await route.PATCH(req("PATCH", { id: "route-smoke", description: "patched" }));
  check("F3 PATCH updates it", patchRes.status === 200 && (await patchRes.json()).harness.description === "patched");

  const delRes = await route.DELETE(req("DELETE", { id: "route-smoke" }));
  check("F4 DELETE exiles (ok:true)", delRes.status === 200 && (await delRes.json()).ok === true);
  const after = await (await route.GET(req("GET"))).json();
  check("F5 exiled row gone from default GET", !after.harnesses.some((x) => x.id === "route-smoke"));
  const withExiled = await (await route.GET(req("GET", null, "?includeExiled=1"))).json();
  check("F6 ...but present with ?includeExiled=1 (never dropped)", withExiled.harnesses.some((x) => x.id === "route-smoke"));
  const delBuiltin = await route.DELETE(req("DELETE", { id: "ralph-loop" }));
  check("F7 DELETE on a builtin → 409", delBuiltin.status === 409);

  const badPost = await route.POST(req("POST", { name: "Bad", definition: { systemPreamble: "", loop: { maxIterations: 2, stopWhen: "X" }, phases: [{ name: "a", prompt: "b" }] } }));
  check("F8 POST validates the HarnessDef shape", badPost.status === 400);
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}  (temp db: ${tmpDb})`);
process.exit(failures === 0 ? 0 : 1); // route imports may hold ensureV2 timers
