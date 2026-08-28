// SPEC-E X.2 — smoke-agents-forge: the ForgeWizard's API path, OFFLINE.
// Covers: harness seeds + CRUD/exile over the route · the wizard's create
// path (POST /api/agents + PATCH V2 fields + lifecycle "test") · lifecycle
// transitions + the deploy guard's 409 leg AND the CONVENTIONS §11 warning
// mode (agents.requireTestRun=false → deploy succeeds with a warning) · the
// status snapshot reflecting the new agent (?once=1) · the telemetry route
// (listSessionRows({agentId}) + listStatusEvents) · the draft route's
// validation leg (no CLI is ever spawned here).
//
// Live-SDK legs (ralph-loop ≥2 iterations, phases approval card, deploy E2E
// with a real test run) are OUT of scope — see the Phase 7 manual checklist.
// Run: npx tsx scripts/v2/smoke-agents-forge.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// ── temp env BEFORE any src imports (smoke-harnesses recipe) ─────────────────
const stamp = Date.now();
const tmpDb = path.join(os.tmpdir(), `agentos-smoke-forge-${stamp}.db`);
process.env.AGENTIC_OS_DB = tmpDb;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-forge-settings-"));
const settingsFile = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_SETTINGS = settingsFile;
const agentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-forge-agents-"));
process.env.AGENTIC_OS_AGENTS_DIR = agentsDir;
process.env.OLLAMA_URL = "http://127.0.0.1:1"; // dead port — nothing may reach a live model

const baseSettings = {
  memory: { ingestEnabled: false },
  capability: { browserEnabled: false },
  tasks: { timezone: "America/Chicago" },
  browser: { wsPort: 0, wsBind: "local", profiles: [], sessions: [] },
};
const writeSettings = (extra = {}) =>
  fs.writeFileSync(settingsFile, JSON.stringify({ ...baseSettings, ...extra }));
writeSettings(); // default: agents.requireTestRun absent → DEFAULT_SETTINGS true (hard gate)

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : extra ? `  [${JSON.stringify(extra).slice(0, 300)}]` : ""}`);
  if (!cond) failures++;
};

const { NextRequest } = await import("next/server.js");
const store = await import("../../src/lib/agentsStore.ts");
const lc = await import("../../src/lib/v2/agents/lifecycle.ts");
const harnessRoute = await import("../../src/app/api/v2/harnesses/route.ts");
const agentsRoute = await import("../../src/app/api/agents/route.ts");
const idRoute = await import("../../src/app/api/agents/[id]/route.ts");
const statusRoute = await import("../../src/app/api/v2/agents/status/route.ts");
const telemetryRoute = await import("../../src/app/api/v2/agents/[id]/telemetry/route.ts");
const draftRoute = await import("../../src/app/api/v2/agents/draft/route.ts");

const req = (url, method = "GET", body = null) =>
  new NextRequest(`http://127.0.0.1:3737${url}`, {
    method,
    ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
  });
const patchAgent = (id, body) =>
  idRoute.PATCH(req(`/api/agents/${id}`, "PATCH", body), { params: Promise.resolve({ id }) });

// ── §A harness seeds + CRUD/exile over the route ─────────────────────────────
console.log("\n── §A harnesses route: seeds + CRUD + exile ──");
{
  const list = await (await harnessRoute.GET(req("/api/v2/harnesses"))).json();
  const ids = (list.harnesses ?? []).map((h) => h.id).sort();
  check("A1 GET lazy-seeds the 4 builtins",
    JSON.stringify(ids) === JSON.stringify(["fable-harness", "feat-loop", "oneshot-plain", "ralph-loop"]), ids);

  const created = await (await harnessRoute.POST(req("/api/v2/harnesses", "POST", {
    name: "Forge Smoke", kind: "loop",
    definition: { systemPreamble: "FORGE SMOKE", loop: { maxIterations: 2, stopWhen: "FS-DONE" } },
  }))).json();
  check("A2 POST creates a user harness", created.harness?.id === "forge-smoke", created);

  const patched = await (await harnessRoute.PATCH(req("/api/v2/harnesses", "PATCH", { id: "forge-smoke", description: "patched by smoke" }))).json();
  check("A3 PATCH round-trips", patched.harness?.description === "patched by smoke", patched);

  const builtinEdit = await (await harnessRoute.PATCH(req("/api/v2/harnesses", "PATCH", { id: "ralph-loop", description: "builtins are editable" }))).json();
  check("A4 builtins are EDITABLE", builtinEdit.harness?.description === "builtins are editable", builtinEdit);

  const del = await harnessRoute.DELETE(req("/api/v2/harnesses", "DELETE", { id: "forge-smoke" }));
  check("A5 DELETE exiles the user row", del.status === 200 && (await del.json()).ok === true);
  const after = await (await harnessRoute.GET(req("/api/v2/harnesses"))).json();
  check("A6 exiled row hidden from the default list", !after.harnesses.some((h) => h.id === "forge-smoke"));
  const withEx = await (await harnessRoute.GET(req("/api/v2/harnesses?includeExiled=1"))).json();
  check("A7 ...but present with ?includeExiled=1 (never dropped)", withEx.harnesses.some((h) => h.id === "forge-smoke"));

  const delBuiltin = await harnessRoute.DELETE(req("/api/v2/harnesses", "DELETE", { id: "fable-harness" }));
  check("A8 builtin DELETE → 409 (surfaced to the library UI)", delBuiltin.status === 409);
}

// ── §B the wizard's create path (POST + PATCH V2 fields, lifecycle test) ─────
console.log("\n── §B wizard create path ──");
let agentId = null;
{
  const created = await (await agentsRoute.POST(req("/api/agents", "POST", {
    name: "smoke forge echo",
    description: "smoke wizard agent",
    instructions: "Reply with today's date and stop.",
    permissionMode: "bypass",
    intelligence: "fast",
  }))).json();
  agentId = created.agent?.id ?? null;
  check("B1 POST /api/agents creates the agent (manual trigger default)",
    !!agentId && created.agent.triggers?.[0]?.type === "manual", created);

  const patchRes = await patchAgent(agentId, {
    lifecycle: "test",
    harnessId: "oneshot-plain",
    persona: { name: "Smoke Voice", voiceRules: "terse", bannedPhrases: ["synergy"] },
    provider: { kind: "ollama", model: "smoke-model" },
    browserSessions: ["research"],
    toolIds: ["pkg-a"],
    connectorIds: [],
  });
  const patchJson = await patchRes.json();
  check("B2 PATCH lands every V2 field + lifecycle test", patchRes.status === 200 &&
    patchJson.agent.lifecycle === "test" && patchJson.agent.harnessId === "oneshot-plain" &&
    patchJson.agent.persona?.name === "Smoke Voice" && patchJson.agent.provider?.kind === "ollama" &&
    patchJson.agent.browserSessions?.[0] === "research" && patchJson.agent.toolIds?.[0] === "pkg-a", patchJson);

  const onDisk = await store.loadAgent(agentId);
  check("B3 V2 fields round-trip to agent.json on disk",
    onDisk?.lifecycle === "test" && onDisk?.persona?.name === "Smoke Voice" && onDisk?.provider?.model === "smoke-model");
  check("B4 test lifecycle parks the trigger tick (F1.2)", lc.lifecycleAllowsTriggers(onDisk) === false);

  const badPersona = await patchAgent(agentId, { persona: { name: "x" } });
  check("B5 malformed persona → 400", badPersona.status === 400);
  const badLc = await patchAgent(agentId, { lifecycle: "imaginary" });
  check("B6 unknown lifecycle → 400", badLc.status === 400);
}

// ── §C deploy guard: the 409 leg, then deploy after a done run ───────────────
console.log("\n── §C deploy guard (hard mode — default) ──");
{
  const denied = await patchAgent(agentId, { lifecycle: "deployed" });
  const deniedJson = await denied.json();
  check("C1 deploy BEFORE any done run → 409", denied.status === 409, `status ${denied.status}`);
  check("C2 the 409 error text tells the user what to do (surfaced by the wizard)",
    /successful|Test first/i.test(deniedJson.error ?? ""), deniedJson);

  const deniedLib = await lc.transitionLifecycle(agentId, "deployed");
  check("C3 transitionLifecycle agrees (shared checkDeployGuard)", "error" in deniedLib && deniedLib.status === 409);

  await store.saveRunMeta({
    id: "smoke-run-1", agentId, trigger: "manual", status: "done",
    startedAt: Date.now() - 9000, endedAt: Date.now() - 8000, result: "ok",
  });
  const okRes = await patchAgent(agentId, { lifecycle: "deployed" });
  const okJson = await okRes.json();
  check("C4 deploy AFTER a done run → 200, lifecycle deployed", okRes.status === 200 && okJson.agent.lifecycle === "deployed", okJson);
  check("C5 hard mode carries NO warning", okJson.warning === undefined, okJson);
  const onDisk = await store.loadAgent(agentId);
  check("C6 deployed agent re-enters the trigger tick", lc.lifecycleAllowsTriggers(onDisk) === true);
}

// ── §D warning mode (CONVENTIONS §11: agents.requireTestRun=false) ───────────
console.log("\n── §D deploy gate warning mode ──");
{
  writeSettings({ agents: { requireTestRun: false } });
  const created = await (await agentsRoute.POST(req("/api/agents", "POST", {
    name: "smoke warn agent", instructions: "reply ok",
  }))).json();
  const warnId = created.agent.id;
  await patchAgent(warnId, { lifecycle: "test" });

  const res = await patchAgent(warnId, { lifecycle: "deployed" });
  const j = await res.json();
  check("D1 requireTestRun=false: deploy WITHOUT a done run succeeds", res.status === 200 && j.agent.lifecycle === "deployed", j);
  check("D2 ...and the response carries the WARNING for the amber banner",
    typeof j.warning === "string" && /without a successful test run/.test(j.warning), j);

  const libRes = await lc.transitionLifecycle(warnId, "test"); // back to test
  check("D3 transitionLifecycle back to test is unguarded", "agent" in libRes && libRes.agent.lifecycle === "test");
  const libDeploy = await lc.transitionLifecycle(warnId, "deployed");
  check("D4 transitionLifecycle warning mode agrees", "agent" in libDeploy && typeof libDeploy.warning === "string", libDeploy);

  // No-trigger leg stays HARD in both modes.
  await store.saveAgent({ ...(await store.loadAgent(warnId)), lifecycle: "test", triggers: [] });
  const noTrig = await patchAgent(warnId, { lifecycle: "deployed" });
  check("D5 zero triggers → 409 even in warning mode", noTrig.status === 409);

  writeSettings(); // restore hard mode
  const restored = await lc.checkDeployGuard("nonexistent-id", { triggers: [{ type: "manual" }] });
  check("D6 settings restore: hard mode back on (guard blocks again)", !!restored.block && restored.block.status === 409);
}

// ── §E status snapshot reflects the fleet (?once=1) ──────────────────────────
console.log("\n── §E status feed reflects the forge ──");
{
  // Park the first agent back in test so both bands are represented.
  await patchAgent(agentId, { lifecycle: "test" });
  const once = await (await statusRoute.GET(req("/api/v2/agents/status?once=1"))).json();
  check("E1 ?once=1 returns the snapshot", Array.isArray(once.agents) && once.agents.length >= 2, once);
  const mine = once.agents.find((a) => a.agentId === agentId);
  check("E2 test-lifecycle agent → offline with the lifecycle word as detail",
    mine?.status === "offline" && mine?.detail === "test", mine);

  await patchAgent(agentId, { lifecycle: "deployed" }); // has a done run — allowed
  const once2 = await (await statusRoute.GET(req("/api/v2/agents/status?once=1"))).json();
  const mine2 = once2.agents.find((a) => a.agentId === agentId);
  check("E3 deployed + no live run → idle", mine2?.status === "idle", mine2);

  const { getDb } = await import("../../src/lib/v2/db.ts");
  const rows = getDb().prepare("SELECT status FROM agent_status_events WHERE agent_id = ? ORDER BY id").all(agentId);
  check("E4 agent_status_events recorded the transitions (offline→idle)",
    rows.length >= 2 && rows.some((r) => r.status === "offline") && rows.some((r) => r.status === "idle"), rows);
}

// ── §F telemetry route (RunsTab side data) ───────────────────────────────────
console.log("\n── §F telemetry route ──");
{
  const res = await telemetryRoute.GET(req(`/api/v2/agents/${agentId}/telemetry`), { params: Promise.resolve({ id: agentId }) });
  const j = await res.json();
  check("F1 telemetry 200 with sessions[] + statusEvents[]",
    res.status === 200 && Array.isArray(j.sessions) && Array.isArray(j.statusEvents), j);
  check("F2 no browser sessions driven yet (honest empty)", j.sessions.length === 0);
  check("F3 statusEvents history present for this agent",
    j.statusEvents.length >= 1 && j.statusEvents.every((e) => e.agent_id === agentId), j.statusEvents.slice(0, 3));
  const bad = await telemetryRoute.GET(req("/api/v2/agents/..%2F/telemetry"), { params: Promise.resolve({ id: "../evil" }) });
  check("F4 bad id → 400", bad.status === 400);
}

// ── §G draft route (validation only — NO CLI spawn offline) ──────────────────
console.log("\n── §G draft route validation ──");
{
  const res = await draftRoute.POST(req("/api/v2/agents/draft", "POST", {}));
  check("G1 missing idea → 400 (no provider spawned)", res.status === 400);
  const j = await res.json();
  check("G2 error names the problem", /idea/.test(j.error ?? ""), j);
}

// ── cleanup note ─────────────────────────────────────────────────────────────
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}  (temp db: ${tmpDb}, agents: ${agentsDir})`);
process.exit(failures === 0 ? 0 : 1); // route imports hold ensureV2 timers
