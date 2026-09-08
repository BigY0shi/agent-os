// SPEC-C chunk-3 smoke: the Jarvis V2 brain (C3-C6).
//   OFFLINE (always, stub embed server, AGENTOS_MOCK_LLM):
//     - C4 context assembly order (with/without persona doc/pageContext)
//     - migration 031 tables; conversations CRUD
//     - tool handler layer: navigate translation, get_actions/execute_action
//       registry passthrough (coding_ask discoverable), hub tools by exact name,
//       requires_approval refusal, §9.4 integration-taint refusal (applyRecallTaint)
//     - cli answer-only lane end to end (mock cliComplete): meta note, sentences,
//       persistence, auto-ingest queue row, error path
//     - pageContext NEVER persisted (DB grep after asks)
//     - ask route direct-import (SSE frames)
//   ONLINE (needs local Ollama; SKIPs loudly otherwise):
//     - CROSS-PAGE RECALL (CONVENTIONS §11): ingest a fact, ask with pageContext
//       route A then route B — both recall it
//   SDK LIVE (needs the claude CLI/SDK; SKIPs loudly otherwise):
//     - ONE live ask driving tasks_create through the tool round trip
// Run: npx tsx scripts/v2/smoke-jarvis-brain.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import http from "node:http";

// ── temp env BEFORE any imports — never touch the live DB/settings ──────────
const stamp = Date.now();
const tmpDb = path.join(os.tmpdir(), `agentos-smoke-jbrain-${stamp}.db`);
const tmpDb2 = path.join(os.tmpdir(), `agentos-smoke-jbrain-online-${stamp}.db`);
process.env.AGENTIC_OS_DB = tmpDb;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-jbrain-"));
const settingsFile = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_SETTINGS = settingsFile;
const webmcpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-jbrain-sec-"));
process.env.AGENTIC_OS_WEBMCP_DIR = webmcpDir;
process.env.AGENTOS_MOCK_LLM = "1";

// Mirror Next's .env loading (OLLAMA_API_KEY for the online half's cloud LLM)
for (const envFile of [".env.local", ".env"]) {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), envFile), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {}
}

// ── deterministic embedding stub (same trick as smoke-search) ───────────────
function hashStr(s) {
  let h = 2166136261;
  for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function stubEmbed(text) {
  let seed = hashStr(String(text)) || 1;
  const v = new Array(768);
  for (let i = 0; i < 768; i++) {
    seed ^= (seed << 13) >>> 0; seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= (seed << 5) >>> 0; seed >>>= 0;
    v[i] = (seed / 4294967296) * 2 - 1;
  }
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / n);
}
const stubServer = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    try {
      const { input } = JSON.parse(body);
      const texts = Array.isArray(input) ? input : [input];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ embeddings: texts.map(stubEmbed) }));
    } catch {
      res.writeHead(500, { "content-type": "application/json" });
      res.end("{}");
    }
  });
});
await new Promise((r) => stubServer.listen(0, "127.0.0.1", r));
process.env.OLLAMA_URL = `http://127.0.0.1:${stubServer.address().port}`;

const writeSettings = (obj) => fs.writeFileSync(settingsFile, JSON.stringify(obj, null, 2));
writeSettings({
  jarvis: { engine: "cli", cliAgent: "claude" },
  memory: { embedProvider: "ollama-local", embedModel: "stub-embed", ingestEnabled: true },
});

const { ensureDb, getDb, __closeForTests } = await import("../../src/lib/v2/db.ts");
const ctx = await import("../../src/lib/v2/jarvis/context.ts");
const prompts = await import("../../src/lib/v2/jarvis/prompts/system.ts");
const conv = await import("../../src/lib/v2/jarvis/conversations.ts");
const tools = await import("../../src/lib/v2/jarvis/tools.ts");
const brain = await import("../../src/lib/v2/jarvis/brain.ts");
const store = await import("../../src/lib/v2/webmcp/store.ts");
const { seedSelfTools } = await import("../../src/lib/v2/webmcp/seedSelfTools.ts");
const { ensureTaskActions } = await import("../../src/lib/v2/mcp/taskActions.ts");
const { ensureCoreActions } = await import("../../src/lib/v2/mcp/actions.ts");
const { listTasks } = await import("../../src/lib/v2/tasks/store.ts");
const labels = await import("../../src/lib/v2/memory/labels.ts");
const queue = await import("../../src/lib/v2/memory/queue.ts");
const askRoute = await import("../../src/app/api/v2/jarvis/ask/route.ts");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${String(extra).slice(0, 300)}` : ""}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cleanup = async () => {
  try { await brain.resetJarvisBrain(); } catch {}
  try { queue.stopMemoryQueue(); } catch {}
  stubServer.close();
  try { __closeForTests(); } catch {}
  for (const f of [tmpDb, tmpDb2]) {
    for (const suf of ["", "-wal", "-shm"]) {
      try { fs.rmSync(f + suf, { force: true }); } catch {}
    }
  }
  try { fs.rmSync(settingsDir, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(webmcpDir, { recursive: true, force: true }); } catch {}
};
const finish = async (code) => {
  await cleanup();
  console.log(failures === 0 ? "\nsmoke-jarvis-brain: ALL PASS" : `\nsmoke-jarvis-brain: ${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : code);
};

// ===========================================================================
// A. C4 context assembly (pure — no DB)
// ===========================================================================
console.log("--- A. context assembly ---");
{
  const page = { route: "/pipeline", title: "Pipeline", summary: "SUM-MARKER visible deals" };
  const full = ctx.buildSystemPrompt({
    personaDocContent: "PERSONA-DOC-MARKER content",
    pageContext: page,
    skillNames: ["SKILL-MARKER"],
  });
  const order = [
    "<identity>",
    "butler", // jarvisPersona record voice
    "PERSONA-DOC-MARKER",
    "SKILL-MARKER",
    "<current_datetime>",
    '<active_page route="/pipeline">',
    "<spoken_mechanics>",
  ];
  const idx = order.map((m) => full.indexOf(m));
  check("full assembly contains every block", idx.every((i) => i >= 0), JSON.stringify(idx));
  check("assembly ORDER identity→persona→doc→skills→datetime→active_page→spoken", idx.every((v, i) => i === 0 || v > idx[i - 1]), JSON.stringify(idx));
  check("assembly carries the §9.4 recalled-memory rule", full.includes('<recalled_memory untrusted="true">'));

  const noDoc = ctx.buildSystemPrompt({ personaDocContent: null, pageContext: page, skillNames: [] });
  check("persona-doc-absent path renders no <user_persona>", !noDoc.includes("<user_persona>"));
  const noPage = ctx.buildSystemPrompt({ personaDocContent: null, pageContext: null, skillNames: [] });
  check("pageContext-absent path renders no <active_page", !noPage.includes("<active_page"));

  const stable = ctx.buildStableSystemPrompt({ personaDocContent: "X", skillNames: [] });
  check("stable prompt (sdk session seed) excludes <active_page", !stable.includes("<active_page") && stable.includes("<identity>"));
  const turn = ctx.buildTurnContextBlock({ pageContext: page });
  check("turn block carries datetime + active_page", turn.includes("<current_datetime>") && turn.includes("SUM-MARKER"));

  check("sanitizePageContext rejects non-/ routes", ctx.sanitizePageContext({ route: "javascript:alert(1)" }) === null);
  const big = ctx.sanitizePageContext({ route: "/x", summary: "y".repeat(5000) });
  check("sanitizePageContext caps summary length", big.summary.length <= 800);
  check("wrapRecalledMemory wraps per §9.4", prompts.wrapRecalledMemory("abc").startsWith('<recalled_memory untrusted="true">'));
}

// ===========================================================================
// B. migration + conversations CRUD
// ===========================================================================
console.log("--- B. migration 031 + conversations ---");
ensureDb();
const db = getDb();
{
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'jarvis_%'").all().map((r) => r.name);
  check("jarvis_conversations + jarvis_messages tables exist", names.includes("jarvis_conversations") && names.includes("jarvis_messages"), names.join(","));

  const c = conv.ensureConversation(undefined, { titleSeed: "hello world this is a title seed", channel: "overlay" });
  check("ensureConversation creates with seeded title", c.id && c.title.startsWith("hello world"));
  conv.appendJarvisMessage({ conversationId: c.id, role: "user", content: "u1" });
  conv.appendJarvisMessage({ conversationId: c.id, role: "assistant", content: "a1", toolCalls: [{ name: "navigate", summary: "/tasks", ok: true }] });
  const msgs = conv.listMessages(c.id);
  check("messages persist in order with tool summaries", msgs.length === 2 && msgs[0].content === "u1" && msgs[1].toolCalls?.[0]?.name === "navigate");
  check("ensureConversation returns the existing row for a known id", conv.ensureConversation(c.id).id === c.id);
  check("unknown conversationId starts a fresh conversation", conv.ensureConversation("nope-" + stamp).id !== "nope-" + stamp);
}

// ===========================================================================
// C. tool handler layer (hub seeded; SDK not involved)
// ===========================================================================
console.log("--- C. tool handlers ---");
ensureCoreActions();
ensureTaskActions();
seedSelfTools();
{
  const events = [];
  const state = tools.newTurnState();
  const handlers = tools.buildJarvisToolHandlers({ emit: (ev) => events.push(ev), state });

  check("built-in tool set present", ["memory_search", "memory_ingest", "get_actions", "execute_action", "navigate"].every((n) => handlers[n]));
  check("hub tools advertised under exact names", !!handlers.tasks_create && !!handlers.tasks_list);
  check("toolsSignature reflects published packages", tools.toolsSignature().includes("agentos"));

  // navigate → stream event translation
  const nav = await handlers.navigate.run({ route: "/tasks" });
  check("navigate returns ok text", nav.isError !== true && nav.content[0].text.includes("/tasks"));
  check("navigate emitted {type:'navigate',route}", events.some((e) => e.type === "navigate" && e.route === "/tasks"));

  // get_actions discovers coding_ask (C6 spawning surface)
  const ga = await handlers.get_actions.run({ intent: "spawn a coding session" });
  check("get_actions surfaces coding_ask", ga.content[0].text.includes("coding_ask"));

  // execute_action passthrough → real task in the SPEC-B store
  const ex = await handlers.execute_action.run({ key: "tasks_create", args: { title: "from-exec-action" } });
  check("execute_action tasks_create succeeds", ex.isError !== true && /tk-\d+/.test(ex.content[0].text), ex.content[0].text);
  check("task row exists (exec path)", listTasks({ limit: 50 }).some((t) => t.title === "from-exec-action"));
  check("execute_action unknown key errors helpfully", (await handlers.execute_action.run({ key: "nope_xyz", args: {} })).isError === true);

  // hub tool direct call
  const hubCall = await handlers.tasks_create.run({ title: "from-hub-tool" });
  check("hub tasks_create succeeds by exact name", hubCall.isError !== true && listTasks({ limit: 50 }).some((t) => t.title === "from-hub-tool"));
  check("tool events streamed (start+done)", events.filter((e) => e.type === "tool" && e.name === "tasks_create").length >= 2);
  check("tool calls recorded for persistence", state.toolCalls.some((t) => t.name === "tasks_create" && t.ok));

  // requires_approval hub tool → refusal
  store.createPackage({ slug: "smoke-appr", name: "Approval smoke" });
  store.addTool("smoke-appr", {
    name: "danger_tool",
    description: "A destructive smoke tool",
    inputSchema: { type: "object", properties: {} },
    handlerKind: "js",
    handlerConfig: { code: "return { did: 'danger' };" },
    requiresApproval: true,
  });
  store.publishPackage("smoke-appr");
  const handlers2 = tools.buildJarvisToolHandlers({ emit: () => {}, state: tools.newTurnState() });
  const refused = await handlers2.danger_tool.run({});
  check("requires_approval hub tool refuses with a clear message", refused.isError === true && /approval/i.test(refused.content[0].text), refused.content[0].text);
  check("refused tool did NOT run", !refused.content[0].text.includes("did"));

  // §9.4 integration taint: recall labels force approval on destructive/spawning
  const intgLabel = await labels.createLabel({ name: "integration:test" });
  const plainLabel = await labels.createLabel({ name: "just-a-topic" });
  const taintState = tools.newTurnState();
  const fakeRecall = (labelId) => ({ episodes: [{ uuid: "e1", content: "x", createdAt: new Date().toISOString(), labelIds: [labelId] }], invalidatedFacts: [], statements: [], entity: null });
  check("recallIntegrationLabels detects integration:*", tools.recallIntegrationLabels(fakeRecall(intgLabel.id)).includes("integration:test"));
  check("recallIntegrationLabels ignores plain labels", tools.recallIntegrationLabels(fakeRecall(plainLabel.id)).length === 0);
  tools.applyRecallTaint(taintState, fakeRecall(plainLabel.id));
  check("plain-label recall does NOT taint", taintState.integrationTainted === false);
  tools.applyRecallTaint(taintState, fakeRecall(intgLabel.id));
  check("integration-label recall taints the session", taintState.integrationTainted === true);

  const taintedHandlers = tools.buildJarvisToolHandlers({ emit: () => {}, state: taintState });
  const taintedCreate = await taintedHandlers.tasks_create.run({ title: "should-not-exist" });
  check("tainted turn: hub tasks_create REFUSED", taintedCreate.isError === true && /integration/i.test(taintedCreate.content[0].text), taintedCreate.content[0].text);
  check("tainted refusal really blocked the write", !listTasks({ limit: 100 }).some((t) => t.title === "should-not-exist"));
  const taintedExec = await taintedHandlers.execute_action.run({ key: "tasks_create", args: { title: "should-not-exist-2" } });
  check("tainted turn: execute_action REFUSED", taintedExec.isError === true && /integration/i.test(taintedExec.content[0].text));
  const taintedNav = await taintedHandlers.navigate.run({ route: "/memory" });
  check("tainted turn: read-only/UI tools still allowed", taintedNav.isError !== true);

  // ── HARDENING-2026-08-27 item 1: episode-less recall must not launder ──────
  // Derived facts (statements/entity/voiceAspects) with an EMPTY episodes list
  // previously carried ZERO taint signal. Provenance now resolves; unresolvable
  // provenance FAILS CLOSED.
  const gdb = getDb();
  const ts = new Date().toISOString();
  const mkEpisode = (uuid) =>
    gdb.prepare(
      `INSERT INTO episodes (uuid, content, original_content, source, session_id, created_at, valid_at)
       VALUES (?, 'seed', 'seed', 'smoke', 'taint-prov', ?, ?)`,
    ).run(uuid, ts, ts);
  const mkStatement = (uuid, epUuid) => {
    gdb.prepare(
      "INSERT INTO statements (uuid, fact, aspect, created_at, valid_at) VALUES (?, 'fact', 'Identity', ?, ?)",
    ).run(uuid, ts, ts);
    if (epUuid) {
      gdb.prepare(
        "INSERT INTO edges (type, from_uuid, to_uuid, created_at) VALUES ('provenance', ?, ?, ?)",
      ).run(epUuid, uuid, ts);
    }
  };
  mkEpisode("ep-intg");
  gdb.prepare("INSERT INTO episode_labels (episode_uuid, label_id) VALUES (?, ?)").run("ep-intg", intgLabel.id);
  mkEpisode("ep-clean");
  gdb.prepare("INSERT INTO episode_labels (episode_uuid, label_id) VALUES (?, ?)").run("ep-clean", plainLabel.id);
  mkStatement("st-intg", "ep-intg");
  mkStatement("st-clean", "ep-clean");
  mkStatement("st-orphan", null); // no provenance at all

  const stmtOnly = (uuid) => ({
    episodes: [], invalidatedFacts: [], entity: null,
    statements: [{ uuid, fact: "fact", validAt: ts, attributes: {}, aspect: "Identity" }],
  });
  check(
    "episode-less recall: integration-provenance statement TAINTS (item 1)",
    tools.recallIntegrationLabels(stmtOnly("st-intg")).includes("integration:test"),
    tools.recallIntegrationLabels(stmtOnly("st-intg")),
  );
  check("episode-less recall: clean-provenance statement stays clean", tools.recallIntegrationLabels(stmtOnly("st-clean")).length === 0);
  check(
    "statement with NO provenance FAILS CLOSED",
    tools.recallIntegrationLabels(stmtOnly("st-orphan")).includes(tools.UNRESOLVED_PROVENANCE_LABEL),
  );
  check(
    "statement missing its uuid FAILS CLOSED",
    tools.recallIntegrationLabels({ episodes: [], statements: [{ fact: "f", validAt: ts, attributes: {}, aspect: null }], entity: null })
      .includes(tools.UNRESOLVED_PROVENANCE_LABEL),
  );

  // Entity lane: entity whose statements have integration provenance taints.
  gdb.prepare("INSERT INTO entities (uuid, name, created_at) VALUES ('ent-intg', 'Mallory', ?)").run(ts);
  gdb.prepare("INSERT INTO edges (type, from_uuid, to_uuid, created_at) VALUES ('subject', 'st-intg', 'ent-intg', ?)").run(ts);
  const entOnly = (uuid) => ({ episodes: [], invalidatedFacts: [], statements: [], entity: { uuid, name: "Mallory", attributes: {} } });
  check("entity-only recall with integration provenance TAINTS", tools.recallIntegrationLabels(entOnly("ent-intg")).includes("integration:test"));
  gdb.prepare("INSERT INTO entities (uuid, name, created_at) VALUES ('ent-empty', 'Ghost', ?)").run(ts);
  check(
    "entity with NO traceable statements FAILS CLOSED",
    tools.recallIntegrationLabels(entOnly("ent-empty")).includes(tools.UNRESOLVED_PROVENANCE_LABEL),
  );

  // Voice-aspect lane: episode_uuids provenance resolves; empty fails closed.
  gdb.prepare(
    "INSERT INTO voice_aspects (uuid, fact, aspect, episode_uuids, created_at, valid_at) VALUES ('va-intg', 'v', 'Style', ?, ?, ?)",
  ).run(JSON.stringify(["ep-intg"]), ts, ts);
  gdb.prepare(
    "INSERT INTO voice_aspects (uuid, fact, aspect, episode_uuids, created_at, valid_at) VALUES ('va-empty', 'v', 'Style', '[]', ?, ?)",
  ).run(ts, ts);
  const vaOnly = (uuid) => ({ episodes: [], invalidatedFacts: [], statements: [], entity: null, voiceAspects: [{ uuid, fact: "v", aspect: "Style" }] });
  check("voice aspect with integration episode TAINTS", tools.recallIntegrationLabels(vaOnly("va-intg")).includes("integration:test"));
  check("voice aspect with empty episode_uuids FAILS CLOSED", tools.recallIntegrationLabels(vaOnly("va-empty")).includes(tools.UNRESOLVED_PROVENANCE_LABEL));

  // applyRecallTaint wires the fail-closed path into the session gate.
  const failClosedState = tools.newTurnState();
  tools.applyRecallTaint(failClosedState, stmtOnly("st-orphan"));
  check("fail-closed provenance taints the session via applyRecallTaint", failClosedState.integrationTainted === true);

  // ── HARDENING item 3: persona provenance filter (same seeded rows) ─────────
  const persona = await import("../../src/lib/v2/memory/persona.ts");
  check("isIntegrationEpisode: labeled episode detected", persona.isIntegrationEpisode("ep-intg") === true);
  check("isIntegrationEpisode: clean episode passes", persona.isIntegrationEpisode("ep-clean") === false);
  const intgFacts = persona.fetchEpisodeFactsForPersona("ep-intg");
  check("persona: integration episode contributes NOTHING", intgFacts.validFacts.length === 0 && intgFacts.invalidatedFacts.length === 0, JSON.stringify(intgFacts));
  const cleanFacts = persona.fetchEpisodeFactsForPersona("ep-clean");
  check("persona: clean episode's facts still flow", cleanFacts.validFacts.some((f) => f.fact === "fact"), JSON.stringify(cleanFacts));
}

// ===========================================================================
// D. cli answer-only lane (mock cliComplete via AGENTOS_MOCK_LLM)
// ===========================================================================
console.log("--- D. cli lane ---");
let cliConvId = null;
{
  const events = [];
  const r1 = await brain.askJarvisV2({ text: "Hello Jarvis. How are you today?" }, (ev) => events.push(ev));
  cliConvId = r1.conversationId;
  const meta = events.find((e) => e.type === "meta");
  check("meta event first with engine 'cli' + answer-only note", events[0]?.type === "meta" && meta?.engine === "cli" && /answer-only/.test(meta?.note ?? ""), JSON.stringify(events[0]));
  check("sentences streamed", events.some((e) => e.type === "sentence" && e.text.length > 0));
  const done = events.find((e) => e.type === "done");
  check("done event carries real durationMs", typeof done?.durationMs === "number" && done.durationMs >= 0);

  const msgs = conv.listMessages(cliConvId);
  check("user + assistant rows persisted", msgs.length === 2 && msgs[0].role === "user" && msgs[1].role === "assistant");
  check("conversation title seeded from first text", conv.getConversation(cliConvId)?.title.startsWith("Hello Jarvis"));

  // second turn threads the same conversation
  const events2 = [];
  await brain.askJarvisV2({ text: "And a second question for the thread?", conversationId: cliConvId }, (ev) => events2.push(ev));
  check("second ask reuses the conversation", events2.find((e) => e.type === "meta")?.conversationId === cliConvId);
  check("4 rows after 2 turns", conv.listMessages(cliConvId).length === 4);

  // status surface
  const st = brain.jarvisAskStatus();
  check("status idle after turns, engine cli", st.busy === false && st.engine === "cli");

  // auto-ingest queue row (fire-and-forget → poll briefly)
  let qrow = null;
  for (let i = 0; i < 20 && !qrow; i++) {
    qrow = db.prepare("SELECT * FROM ingestion_queue WHERE session_id = ? LIMIT 1").get(`jarvis-${cliConvId}`);
    if (!qrow) await sleep(250);
  }
  check("exchange auto-ingested (source 'jarvis', session jarvis-<conv>)", !!qrow && qrow.source === "jarvis", JSON.stringify(qrow ? { source: qrow.source } : null));

  // ── HARDENING-2026-08-27 item 2: tainted exchanges must not launder ────────
  // A turn in a tainted conversation is re-ingested; before the fix its queue
  // row carried only the 'jarvis' label, so future recall of it would NOT
  // re-taint (integration content laundered into trusted memory). The tainted
  // exchange now also carries 'integration:jarvis-relay'.
  {
    const tconv = conv.ensureConversation(undefined, { titleSeed: "taint relay", channel: "overlay" });
    conv.appendJarvisMessage({ conversationId: tconv.id, role: "user", content: "earlier question" });
    conv.appendJarvisMessage({ conversationId: tconv.id, role: "assistant", content: "earlier TAINTED answer", tainted: true });
    await brain.askJarvisV2({ text: "Follow-up in the tainted thread?", conversationId: tconv.id }, () => {});
    let trow = null;
    for (let i = 0; i < 20 && !trow; i++) {
      trow = db.prepare("SELECT * FROM ingestion_queue WHERE session_id = ? ORDER BY created_at DESC LIMIT 1").get(`jarvis-${tconv.id}`);
      if (!trow) await sleep(250);
    }
    const relayLabel = db.prepare("SELECT id FROM labels WHERE name = 'integration:jarvis-relay'").get();
    const tLabels = trow ? JSON.parse(trow.label_ids) : [];
    check("tainted exchange ingested with 'integration:jarvis-relay' label (item 2)", !!trow && !!relayLabel && tLabels.includes(relayLabel.id), JSON.stringify({ trow: !!trow, relayLabel: !!relayLabel, tLabels }));
    // and the earlier CLEAN exchange stays clean
    const cleanRow = db.prepare("SELECT * FROM ingestion_queue WHERE session_id = ? ORDER BY created_at ASC LIMIT 1").get(`jarvis-${cliConvId}`);
    const cleanLabels = cleanRow ? JSON.parse(cleanRow.label_ids) : null;
    check("clean exchange does NOT carry the relay label", !!cleanRow && (!relayLabel || !cleanLabels.includes(relayLabel.id)));
  }

  // error path: injected cli failure → error event + system row, then restore
  brain.setJarvisCliForTests(() => Promise.reject(new Error("smoke-injected cli failure")));
  const errEvents = [];
  const rErr = await brain.askJarvisV2({ text: "This one will fail." }, (ev) => errEvents.push(ev));
  brain.setJarvisCliForTests(null);
  check("cli failure surfaces as error event (fail loudly)", errEvents.some((e) => e.type === "error" && e.message.includes("smoke-injected")));
  check("error persisted as system row", conv.listMessages(rErr.conversationId).some((m) => m.role === "system" && m.content.includes("smoke-injected")));
}

// ===========================================================================
// E. pageContext privacy — NEVER persisted
// ===========================================================================
console.log("--- E. pageContext privacy ---");
{
  const marker = "SMOKETEST-DEAL-ZX81";
  const events = [];
  await brain.askJarvisV2(
    {
      text: "name the entity on this page",
      pageContext: { route: "/pipeline", title: "Pipeline", summary: `deals visible: ${marker}` },
    },
    (ev) => events.push(ev),
  );
  check("mock answer used the composed prompt (cli lane ran)", events.some((e) => e.type === "sentence"));
  await sleep(500); // let the fire-and-forget ingest land its queue row
  const tables = ["jarvis_messages", "jarvis_conversations", "ingestion_queue"];
  let leaked = false;
  for (const t of tables) {
    const rows = db.prepare(`SELECT * FROM ${t}`).all();
    if (JSON.stringify(rows).includes(marker)) { leaked = true; check(`pageContext leaked into ${t}`, false); }
  }
  check("pageContext marker absent from EVERY persisted row", !leaked);
}

// ===========================================================================
// F. ask route direct-import (SSE frames)
// ===========================================================================
console.log("--- F. ask route ---");
{
  const getRes = await askRoute.GET();
  const getJson = await getRes.json();
  check("GET /api/v2/jarvis/ask → {busy,engine}", getJson.busy === false && getJson.engine === "cli", JSON.stringify(getJson));

  const badReq = new Request("http://smoke.local/api/v2/jarvis/ask", { method: "POST", body: "{nope" });
  check("POST bad json → 400", (await askRoute.POST(badReq)).status === 400);
  const emptyReq = new Request("http://smoke.local/api/v2/jarvis/ask", {
    method: "POST",
    body: JSON.stringify({ text: "  " }),
    headers: { "content-type": "application/json" },
  });
  check("POST empty text → 400", (await askRoute.POST(emptyReq)).status === 400);

  const req = new Request("http://smoke.local/api/v2/jarvis/ask", {
    method: "POST",
    body: JSON.stringify({ text: "Route smoke question?", pageContext: { route: "/tasks", title: "Tasks" } }),
    headers: { "content-type": "application/json" },
  });
  const res = await askRoute.POST(req);
  check("POST streams text/event-stream", res.headers.get("Content-Type") === "text/event-stream");
  const raw = await res.text();
  const frames = raw.split("\n\n").filter((f) => f.startsWith("data: ")).map((f) => JSON.parse(f.slice(6)));
  check("SSE frames: meta → sentence(s) → done", frames[0]?.type === "meta" && frames.some((f) => f.type === "sentence") && frames.at(-1)?.type === "done", raw.slice(0, 200));
}

// ===========================================================================
// G. ONLINE half — cross-page recall (CONVENTIONS §11) — needs local Ollama
// ===========================================================================
console.log("--- G. online probe (cross-page recall) ---");
stubServer.close();
delete process.env.OLLAMA_URL;

let ollamaUp = false;
// Harness/CI gate: AGENTIC_SMOKE_OFFLINE=1 skips the model legs even with Ollama up.
// Decided BEFORE the probe: an in-flight probe socket at process.exit trips a
// libuv assertion on Windows (seen 2026-09-02 on smoke-ingest).
if (process.env.AGENTIC_SMOKE_OFFLINE) { console.log("SKIP  online leg: AGENTIC_SMOKE_OFFLINE=1"); }
else try {
  const probe = await fetch("http://127.0.0.1:11434/api/version", { signal: AbortSignal.timeout(3000) });
  ollamaUp = probe.ok;
} catch {}

let onlineRan = false;
if (!ollamaUp) {
  console.log("SKIP  local Ollama not reachable at 127.0.0.1:11434 — cross-page recall leg skipped.");
  console.log("      Start Ollama (`ollama serve`, `ollama pull nomic-embed-text`) and re-run for the full gate.");
} else {
  let provider = null;
  let modelLow = "";
  let modelMedium = "";
  if (process.env.OLLAMA_API_KEY) {
    provider = "ollama-cloud";
    modelLow = process.env.SMOKE_MODEL_LOW || "kimi-k2.6:cloud";
    modelMedium = process.env.SMOKE_MODEL_MEDIUM || "glm-5.2:cloud";
  } else {
    try {
      const tags = await (await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(3000) })).json();
      const chat = (tags.models || []).map((m) => m.name).filter((n) => !/embed|bge|minilm/i.test(n));
      const preferred = chat.find((n) => /glm|kimi|qwen|llama|gemma|mistral|deepseek/i.test(n)) || chat[0];
      if (preferred) { provider = "ollama-local"; modelLow = modelMedium = preferred; }
    } catch {}
  }
  if (!provider) {
    console.log("SKIP  no LLM provider (no OLLAMA_API_KEY, no local chat model) — cross-page recall leg skipped.");
  } else {
    console.log(`      provider=${provider} modelLow=${modelLow} modelMedium=${modelMedium}`);
    try { queue.stopMemoryQueue(); } catch {}
    await sleep(1500); // let any in-flight offline-DB drain settle before the switch
    __closeForTests();
    process.env.AGENTIC_OS_DB = tmpDb2;
    ensureDb();
    writeSettings({
      jarvis: { engine: "cli", cliAgent: "claude" },
      memory: { ingestEnabled: true, provider, modelLow, modelMedium, embedProvider: "ollama-local", embedModel: "nomic-embed-text" },
    });
    let embedsOk = true;
    try {
      const { getEmbedding } = await import("../../src/lib/v2/memory/embed.ts");
      await getEmbedding("smoke probe");
    } catch (e) {
      embedsOk = false;
      console.log(`SKIP  embeddings unavailable (${e.message}) — cross-page recall leg skipped.`);
    }
    if (embedsOk) {
      const db2 = getDb();
      // Proven-recallable fixture shape (mirrors smoke-search's online case) with
      // a distinctive marker the mock cli lane can echo back.
      const fact =
        "Yoshi's coding preferences: he prefers TypeScript strict mode, he prefers pnpm over npm, and his smoke project codename is ZEPHYRFISH-77.";
      const { queueId } = await queue.ingestFromModule({ episodeBody: fact, source: "smoke-jarvis", labelNames: ["Coding Preferences"] });
      void queue.drainMemoryQueueOnce();
      let qrow = null;
      const t0 = Date.now();
      for (;;) {
        qrow = db2.prepare("SELECT status, stage, error FROM ingestion_queue WHERE id = ?").get(queueId);
        if (qrow && (qrow.status === "COMPLETED" || qrow.status === "FAILED")) break;
        if (Date.now() - t0 > 300_000) break;
        await sleep(1000);
      }
      check("online ingest COMPLETED", qrow?.status === "COMPLETED", JSON.stringify(qrow));
      if (qrow?.status === "COMPLETED") {
        onlineRan = true;
        // Diagnostic: the recall must work standalone before blaming the brain.
        const search = await import("../../src/lib/v2/memory/search/index.ts");
        const directMd = await search.searchV2("what are my coding preferences?");
        check("direct searchV2 recalls the fact", /ZEPHYRFISH|typescript|pnpm/i.test(String(directMd)), String(directMd).slice(0, 300));
        // The mock cli answer ECHOES the <recalled_memory> block — the recall
        // itself is the REAL searchV2 pipeline. Same memory, two different pages.
        const ask = async (route, title) => {
          const evs = [];
          await brain.askJarvisV2(
            { text: "what are my coding preferences?", pageContext: { route, title, summary: `${title} page (marker CTX-${route})` } },
            (ev) => evs.push(ev),
          );
          return evs.filter((e) => e.type === "sentence").map((e) => e.text).join(" ");
        };
        const onTasks = await ask("/tasks", "Tasks");
        const onMemory = await ask("/memory", "Memory");
        const recalled = (s) => /ZEPHYRFISH|typescript|pnpm/i.test(s);
        check("cross-page recall: fact recalled with pageContext /tasks", recalled(onTasks), onTasks.slice(0, 200));
        check("cross-page recall: SAME fact recalled with pageContext /memory", recalled(onMemory), onMemory.slice(0, 200));
        const leak = db2.prepare("SELECT COUNT(*) c FROM jarvis_messages WHERE content LIKE '%CTX-/tasks%' OR content LIKE '%CTX-/memory%'").get();
        check("online asks also never persist pageContext", leak.c === 0);
      }
    }
  }
}

// ===========================================================================
// H. SDK LIVE leg — ONE tool-driving ask (SKIPs when the SDK/CLI can't run)
// ===========================================================================
console.log("--- H. sdk live leg ---");
if (process.env.SMOKE_SKIP_SDK === "1") {
  console.log("SKIP  SMOKE_SKIP_SDK=1 — live sdk leg skipped by request.");
} else {
  // Seed the hub in whichever DB is current (the sdk session builds tools from it).
  ensureTaskActions();
  ensureCoreActions();
  try { seedSelfTools(); } catch {}
  const settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  settings.jarvis = { ...(settings.jarvis ?? {}), engine: "sdk" };
  writeSettings(settings);

  const runWithTimeout = async (input, ms) => {
    const evs = [];
    let timedOut = false;
    await Promise.race([
      brain.askJarvisV2(input, (ev) => evs.push(ev)),
      sleep(ms).then(() => { timedOut = true; }),
    ]);
    if (timedOut) await brain.resetJarvisBrain();
    return { evs, timedOut };
  };

  // Probe: trivial 1-turn query.
  const probe = await runWithTimeout({ text: "Reply with the single word pong." }, 120_000);
  const probeText = probe.evs.filter((e) => e.type === "sentence").map((e) => e.text).join(" ");
  const probeOk = !probe.timedOut && /pong/i.test(probeText) && !probe.evs.some((e) => e.type === "error");
  if (!probeOk) {
    const err = probe.evs.find((e) => e.type === "error");
    console.log(`SKIP  claude SDK lane unavailable (${probe.timedOut ? "timeout" : err?.message ?? "no pong"}) — live tool leg skipped.`);
  } else {
    check("sdk probe: sentences streamed + meta engine 'sdk'", probe.evs[0]?.type === "meta" && probe.evs[0]?.engine === "sdk");
    // Second turn in the SAME conversation, on the same warm session. Until
    // 2026-09-08 the read loop ended each turn with a `break` out of `for await`,
    // which calls the query's return() -> cleanup(); turn two then read a closed
    // stream and persisted "(no reply)" in 1 ms. A fresh conversation (like the
    // live tool leg below) never sees that, which is why this check exists.
    const probeConv = probe.evs.find((e) => e.type === "meta")?.conversationId;
    const second = await runWithTimeout({ text: "Now reply with the single word ping.", conversationId: probeConv }, 120_000);
    const secondText = second.evs.filter((e) => e.type === "sentence").map((e) => e.text).join(" ");
    check("sdk turn 2 on the same conversation still answers (session survives a turn)",
      !second.timedOut && /ping/i.test(secondText) && !second.evs.some((e) => e.type === "error"),
      JSON.stringify(second.evs.slice(0, 4)).slice(0, 300));
    const secondDone = second.evs.find((e) => e.type === "done");
    check("sdk turn 2 reused the warm session (turns counter = 2)", secondDone?.turns === 2, `done=${JSON.stringify(secondDone)} durations probe=${probe.evs.find((e) => e.type === "done")?.durationMs}ms`);
    const live = await runWithTimeout(
      { text: "Use your tasks_create tool to create a task titled exactly 'smoke brain test', then tell me its display id." },
      240_000,
    );
    const liveText = live.evs.filter((e) => e.type === "sentence").map((e) => e.text).join(" ");
    const created = listTasks({ limit: 100 }).find((t) => t.title === "smoke brain test");
    check("LIVE: sentences streamed", live.evs.some((e) => e.type === "sentence"), JSON.stringify(live.evs.slice(0, 3)));
    check("LIVE: tool event for the create round trip", live.evs.some((e) => e.type === "tool" && /tasks_create/.test(e.name)), JSON.stringify(live.evs.filter((e) => e.type === "tool")));
    check("LIVE: tk-N task actually created via the tool", !!created, liveText.slice(0, 300));
    check("LIVE: assistant row persisted with tool summaries", (() => {
      const cid = live.evs.find((e) => e.type === "meta")?.conversationId;
      if (!cid) return false;
      const last = conv.listMessages(cid).at(-1);
      return last?.role === "assistant" && (last.toolCalls?.length ?? 0) > 0;
    })());
    await brain.resetJarvisBrain();
  }
}

if (!onlineRan) console.log("NOTE  cross-page recall leg did not run (see SKIP above) — rerun with Ollama up for the §11 gate.");
await finish(1);
