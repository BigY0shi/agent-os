// SPEC-C D1/D2 smoke: WebMCP package store + publish/registry integration +
// execute lanes (internal/http/js) + secrets + redacted call logs + hub seam +
// boot re-registration + agentos seed through the FULL MCP round trip.
// Run: npx tsx scripts/v2/smoke-webmcp.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import http from "node:http";

// Temp env BEFORE any imports — never touch the live DB/settings/secrets.
const stamp = Date.now();
const tmpDb = path.join(os.tmpdir(), `agentos-smoke-webmcp-${stamp}.db`);
process.env.AGENTIC_OS_DB = tmpDb;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-webmcp-set-"));
process.env.AGENTIC_OS_SETTINGS = path.join(settingsDir, "settings.json");
const webmcpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-webmcp-sec-"));
process.env.AGENTIC_OS_WEBMCP_DIR = webmcpDir;

const store = await import("../../src/lib/v2/webmcp/store.ts");
const { executeTool, executeDraftTool } = await import("../../src/lib/v2/webmcp/execute.ts");
const hub = await import("../../src/lib/v2/webmcp/hub.ts");
const { seedSelfTools } = await import("../../src/lib/v2/webmcp/seedSelfTools.ts");
const { getAction, searchActions } = await import("../../src/lib/v2/mcp/registry.ts");
const { handleMcpMessage } = await import("../../src/lib/v2/mcp/server.ts");
const { listTasks } = await import("../../src/lib/v2/tasks/store.ts");
const { recent } = await import("../../src/lib/v2/events.ts");
const { redactArgs } = await import("../../src/lib/v2/redact.ts");

let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
};
const throws = (fn, match) => {
  try {
    fn();
    return false;
  } catch (err) {
    return match ? String(err.message ?? err).includes(match) : true;
  }
};

const mcpCtx = { source: "smoke", strict: true, remoteAddr: "127.0.0.1" };
const mcpCall = (name, args, id = 1) =>
  handleMcpMessage({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }, mcpCtx);

// ---------------------------------------------------------------------------
// A. redactArgs unit
// ---------------------------------------------------------------------------
const red = redactArgs(
  { text: "hi", apiToken: "abc", nested: { password: "p", keep: "yes" }, free: "SECRET-VAL" },
  ["SECRET-VAL"],
);
check("redactArgs masks sensitive keys", red.apiToken === "[redacted]" && red.nested.password === "[redacted]");
check("redactArgs masks values equal to resolved secrets", red.free === "[redacted]");
check("redactArgs keeps benign values", red.text === "hi" && red.nested.keep === "yes");

// ---------------------------------------------------------------------------
// B. Package CRUD
// ---------------------------------------------------------------------------
const pkg = store.createPackage({ slug: "smoke-echo", name: "Smoke Echo" });
check("createPackage returns draft v0", pkg.status === "draft" && pkg.currentVersion === 0);
check("duplicate slug throws 409", throws(() => store.createPackage({ slug: "smoke-echo", name: "x" }), "taken"));
check("invalid slug rejected", throws(() => store.createPackage({ slug: "Bad Slug!", name: "x" }), "invalid slug"));
store.updatePackage("smoke-echo", { description: "echoes things" });
check("updatePackage persists + slug lookup works", store.getPackage("smoke-echo")?.description === "echoes things");
check("listPackages carries toolCount", store.listPackages().find((p) => p.slug === "smoke-echo")?.toolCount === 0);

// ---------------------------------------------------------------------------
// C. Publish validation gates
// ---------------------------------------------------------------------------
check("publish with no tools fails", throws(() => store.publishPackage("smoke-echo"), "no tools"));
store.addTool("smoke-echo", {
  name: "echo",
  description: "Echo text back",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  handlerKind: "js",
  handlerConfig: { code: 'return { echoed: args.text, note: "v1" };' },
});
check("duplicate tool name throws", throws(() => store.addTool("smoke-echo", { name: "echo", handlerKind: "js", handlerConfig: { code: "return 1;" } }), "already exists"));
store.addTool("smoke-echo", { name: "bad", handlerKind: "js", handlerConfig: { code: "return 1;" }, inputSchema: '{"type":"string"}' });
check("publish with non-object schema fails", throws(() => store.publishPackage("smoke-echo"), 'type "object"'));
store.removeTool("smoke-echo", "bad");
check("addTool rejects unparseable schema", throws(() => store.addTool("smoke-echo", { name: "x", handlerKind: "js", handlerConfig: { code: "1" }, inputSchema: "{nope" }), "not valid JSON"));

const pub1 = store.publishPackage("smoke-echo");
check("publish bumps to v1 + status published", pub1.version === 1 && pub1.package.status === "published");

// ---------------------------------------------------------------------------
// D. F4 registry integration + full MCP round trip
// ---------------------------------------------------------------------------
check("published tool registered as slug/tool", !!getAction("smoke-echo/echo"));
check("searchActions finds it by intent", searchActions("echo some text back").some((a) => a.key === "smoke-echo/echo"));
const mcpEcho = await mcpCall("execute_action", { key: "smoke-echo/echo", args: { text: "roundtrip" } });
const mcpEchoText = mcpEcho.result?.content?.[0]?.text ?? "";
check("execute_action via handleMcpMessage runs end-to-end", mcpEcho.result?.isError !== true && mcpEchoText.includes("roundtrip") && mcpEchoText.includes("v1"));
const audit = recent({ type: "mcp.execute" })[0];
check("mcp.execute audit carries redacted args (retrofit)", audit?.payload?.args?.text === "roundtrip");

// ---------------------------------------------------------------------------
// E. Draft-vs-published isolation + republish
// ---------------------------------------------------------------------------
store.updateTool("smoke-echo", "echo", { handlerConfig: { code: 'return { echoed: args.text, note: "v2" };' } });
const stillOld = await hub.executeAction("smoke-echo", "echo", { text: "x" }, { source: "smoke" });
check("draft edit does NOT affect published snapshot", stillOld.ok && stillOld.output.includes("v1"));
const pub2 = store.publishPackage("smoke-echo");
const nowNew = await hub.executeAction("smoke-echo", "echo", { text: "x" }, { source: "smoke" });
check("republish (v2) promotes the draft", pub2.version === 2 && nowNew.ok && nowNew.output.includes("v2"));
check("two version rows frozen", store.listVersions(pkg.id).length === 2);
check("v1 snapshot unchanged on disk", store.getSnapshot(pkg.id, 1)?.tools[0]?.handlerConfig.code.includes("v1"));

// arg validation failure is loud + logged
const badArgs = await hub.executeAction("smoke-echo", "echo", { text: 42 }, { source: "smoke" });
check("schema validation rejects wrong arg type", badArgs.ok === false && badArgs.error.includes("invalid args"));

// ---------------------------------------------------------------------------
// F. Archive unregisters
// ---------------------------------------------------------------------------
store.archivePackage("smoke-echo");
check("archive unregisters registry keys", getAction("smoke-echo/echo") === undefined);
const archivedRun = await executeTool("smoke-echo", "echo", { text: "x" }, { source: "smoke" });
check("archived package refuses execution", archivedRun.ok === false && archivedRun.error.includes("no published version"));
check("archived package is read-only", throws(() => store.addTool("smoke-echo", { name: "y", handlerKind: "js", handlerConfig: { code: "1" } }), "read-only"));

// ---------------------------------------------------------------------------
// G. Boot re-registration after registry wipe
// ---------------------------------------------------------------------------
store.createPackage({ slug: "smoke-boot", name: "Boot" });
store.addTool("smoke-boot", { name: "ping", handlerKind: "js", handlerConfig: { code: 'return "pong";' } });
store.publishPackage("smoke-boot");
// Simulate a fresh process: wipe the registry AND the lazy-ensure flags.
globalThis.__agentosActionRegistry = undefined;
globalThis.__agentosCoreActions = undefined;
globalThis.__agentosMemoryActions = undefined;
globalThis.__agentosTaskActions = undefined;
check("registry wiped (simulated restart)", getAction("smoke-boot/ping") === undefined);
const reRegistered = store.loadPublishedIntoRegistry();
check("loadPublishedIntoRegistry re-registers published snapshots", reRegistered >= 1 && !!getAction("smoke-boot/ping"));
check("archived packages are NOT re-registered", getAction("smoke-echo/echo") === undefined);
const bootPing = await hub.executeAction("smoke-boot", "ping", {}, { source: "smoke" });
check("re-registered tool executes", bootPing.ok && bootPing.output.includes("pong"));

// ---------------------------------------------------------------------------
// H. http handler + {{secret}} resolution + redacted call log
// ---------------------------------------------------------------------------
const SECRET_VALUE = `sk-smoke-${stamp}`;
let seenReq = null;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    seenReq = { url: req.url, auth: req.headers.authorization, body };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ got: body, ok: true }));
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

store.createPackage({ slug: "smoke-http", name: "HTTP" });

// Drive the secrets ROUTE (PUT) — value must never be echoed.
const { NextRequest } = await import("next/server");
const secretsRoute = await import("../../src/app/api/v2/webmcp/packages/[id]/secrets/route.ts");
const putRes = await secretsRoute.PUT(
  new NextRequest("http://127.0.0.1/api/v2/webmcp/packages/smoke-http/secrets", {
    method: "PUT",
    body: JSON.stringify({ name: "SMOKETOKEN", value: SECRET_VALUE }),
  }),
  { params: Promise.resolve({ id: "smoke-http" }) },
);
const putJson = await putRes.json();
check("secrets PUT returns names only, never the value", putRes.status === 200 && JSON.stringify(putJson).includes("SMOKETOKEN") && !JSON.stringify(putJson).includes(SECRET_VALUE));
check("secrets file written under AGENTIC_OS_WEBMCP_DIR", fs.existsSync(path.join(webmcpDir, "smoke-http.secrets.json")));
const getRes = await secretsRoute.GET(new NextRequest("http://127.0.0.1/x"), { params: Promise.resolve({ id: "smoke-http" }) });
const getJson = await getRes.json();
check("secrets GET shows configured ✓ names only", getJson.secrets?.[0]?.name === "SMOKETOKEN" && getJson.secrets[0].configured === true && !JSON.stringify(getJson).includes(SECRET_VALUE));

store.addTool("smoke-http", {
  name: "post",
  description: "post to local echo",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  handlerKind: "http",
  handlerConfig: {
    url: `http://127.0.0.1:${port}/echo?q={{args.text}}`,
    method: "POST",
    headers: { authorization: "Bearer {{secret:SMOKETOKEN}}" },
    bodyTemplate: { msg: "{{args.text}}" },
  },
});
store.publishPackage("smoke-http");
const httpRun = await hub.executeAction(
  "smoke-http",
  "post",
  { text: "hello", token: "tok-arg", freeform: SECRET_VALUE },
  { source: "jarvis" },
);
check("http handler runs against local echo", httpRun.ok && httpRun.output.includes('"ok":true'));
check("{{secret:*}} resolved server-side into the request", seenReq?.auth === `Bearer ${SECRET_VALUE}`);
check("{{args.*}} substitution in url + body", seenReq?.url === "/echo?q=hello" && seenReq?.body.includes('"msg":"hello"'));
const httpLog = store.listCallLogs({ packageSlug: "smoke-http" })[0];
check("call log row written (source jarvis, ok)", httpLog?.ok === true && httpLog.source === "jarvis" && httpLog.toolName === "post");
check("secret value NEVER in call log (value-equality redaction)", !httpLog.argsJson.includes(SECRET_VALUE));
check("secret-looking arg key redacted in call log", httpLog.argsJson.includes('"token":"[redacted]"') && httpLog.argsJson.includes('"text":"hello"'));
server.close();

// missing secret fails loudly
store.addTool("smoke-http", { name: "nosecret", handlerKind: "http", handlerConfig: { url: `http://127.0.0.1:${port}/x`, headers: { a: "{{secret:MISSING}}" } } });
store.publishPackage("smoke-http");
const noSecret = await hub.executeAction("smoke-http", "nosecret", {}, { source: "smoke" });
check("unconfigured secret fails loudly", noSecret.ok === false && noSecret.error.includes("MISSING"));

// ---------------------------------------------------------------------------
// I. js sandbox: console capture, timeout, no fetch/process
// ---------------------------------------------------------------------------
store.addTool("smoke-boot", {
  name: "sandbox_probe",
  handlerKind: "js",
  handlerConfig: { code: 'console.log("hi", 1); return { hasFetch: typeof fetch !== "undefined", hasProcess: typeof process !== "undefined", hasRequire: typeof require !== "undefined" };' },
});
const probe = await executeDraftTool("smoke-boot", "sandbox_probe", {}, "test");
const probeOut = JSON.parse(probe.output);
check("js sandbox: fetch/process/require disabled", probe.ok && probeOut.hasFetch === false && probeOut.hasProcess === false && probeOut.hasRequire === false);
check("js sandbox: console captured", probe.logs?.some((l) => l.includes("hi 1")));

store.addTool("smoke-boot", { name: "spin", handlerKind: "js", handlerConfig: { code: "while(true){}", timeoutMs: 300 } });
const spinStart = Date.now();
const spin = await executeDraftTool("smoke-boot", "spin", {}, "test");
check("js infinite loop times out", spin.ok === false && spin.error.includes("timed out"));
check("timeout honored (~300ms)", Date.now() - spinStart >= 250 && Date.now() - spinStart < 5000);

// ---------------------------------------------------------------------------
// J. Test lane runs the DRAFT (unpublished package) via the route
// ---------------------------------------------------------------------------
store.createPackage({ slug: "smoke-draft", name: "Draft only" });
store.addTool("smoke-draft", { name: "hello", handlerKind: "js", handlerConfig: { code: 'return "draft-ran";' } });
const testRoute = await import("../../src/app/api/v2/webmcp/packages/[id]/test/route.ts");
const testRes = await testRoute.POST(
  new NextRequest("http://127.0.0.1/api/v2/webmcp/packages/smoke-draft/test", {
    method: "POST",
    body: JSON.stringify({ toolName: "hello", args: {} }),
  }),
  { params: Promise.resolve({ id: "smoke-draft" }) },
);
const testJson = await testRes.json();
check("test route executes DRAFT of unpublished package", testJson.ok === true && testJson.output.includes("draft-ran") && testJson.durationMs >= 0);
const draftLog = store.listCallLogs({ packageSlug: "smoke-draft" })[0];
check("test lane logged with source 'test'", draftLog?.source === "test" && draftLog.ok === true);
const draftPublishedRun = await executeTool("smoke-draft", "hello", {}, { source: "smoke" });
check("published lane refuses unpublished package", draftPublishedRun.ok === false && draftPublishedRun.error.includes("no published version"));

// validation failures are logged too
await hub.executeAction("smoke-http", "post", {}, { source: "smoke" });
const failLog = store.listCallLogs({ packageSlug: "smoke-http" }).find((l) => !l.ok && (l.error ?? "").includes("invalid args"));
check("validation failure writes a call log row", !!failLog);

// ---------------------------------------------------------------------------
// K. agentos seed (D4 full set): idempotent ×2, SEED_VERSION bump path,
//    requires_approval flags + full MCP round trips over the new tools
// ---------------------------------------------------------------------------
const SEED_NAMES = [
  "events_recent", "jobs_list", "navigate", "pages_append",
  "tasks_create", "tasks_get", "tasks_list", "tasks_update_status",
];
const s1 = seedSelfTools();
const s2 = seedSelfTools();
const agentos = store.getPackage("agentos");
check("seedSelfTools publishes agentos v1", agentos?.status === "published" && agentos.currentVersion === 1 && s1.version === 1);
check("seedSelfTools idempotent ×2 (one version row)", s2.seeded === false && store.listVersions(agentos.id).length === 1);
check("all D4 seed tools registered as agentos/<tool>", SEED_NAMES.every((n) => !!getAction(`agentos/${n}`)));

const seedSnap = store.getPublishedSnapshot("agentos");
check("published snapshot carries the full D4 tool set", (seedSnap?.tools ?? []).map((t) => t.name).sort().join(",") === SEED_NAMES.join(","));
const approvalMap = Object.fromEntries((seedSnap?.tools ?? []).map((t) => [t.name, t.requiresApproval]));
check("requires_approval=1 on state-changing seeds ONLY",
  approvalMap.tasks_update_status === true && approvalMap.pages_append === true &&
  ["navigate", "tasks_create", "tasks_list", "tasks_get", "events_recent", "jobs_list"].every((n) => approvalMap[n] === false));

// SEED_VERSION bump path: simulate an already-seeded install running NEWER seed
// code — stale meta + a drifted tool def → exactly ONE republish, then no-op.
const { getDb } = await import("../../src/lib/v2/db.ts");
getDb().prepare("UPDATE meta SET value = '0' WHERE key = 'webmcp_agentos_seed_version'").run();
store.updateTool("agentos", "tasks_get", { description: "stale pre-bump description" });
const bump1 = seedSelfTools();
const bump2 = seedSelfTools();
const agentosAfter = store.getPackage("agentos");
check("SEED_VERSION bump re-publishes exactly once", bump1.seeded === true && bump1.version === 2 && bump2.seeded === false && agentosAfter.currentVersion === 2 && store.listVersions(agentos.id).length === 2);
check("bump re-syncs drifted seed tool defs", store.getPublishedSnapshot("agentos")?.tools.find((t) => t.name === "tasks_get")?.description !== "stale pre-bump description");
// meta intact + tools unchanged → a further boot never burns a version.
const bump3 = seedSelfTools();
check("post-bump boots are no-ops", bump3.seeded === false && store.getPackage("agentos").currentVersion === 2);

const created = await mcpCall("execute_action", { key: "agentos/tasks_create", args: { title: "Smoke seeded task", spec: "do the thing" } }, 2);
const createdText = created.result?.content?.[0]?.text ?? "";
check("tasks_create via FULL mcp round trip", created.result?.isError !== true && /tk-\d+/.test(createdText));
const tkId = createdText.match(/tk-\d+/)?.[0];
const task = listTasks({}).find((t) => t.displayId === tkId);
check("tk-N task exists in the SPEC-B store", !!task && task.title === "Smoke seeded task" && task.specMd === "do the thing" && task.source === "agent");

const listed = await mcpCall("execute_action", { key: "agentos/tasks_list", args: { status: "Todo" } }, 3);
check("tasks_list surfaces the created task", (listed.result?.content?.[0]?.text ?? "").includes(tkId ?? "@@"));

const got = await mcpCall("execute_action", { key: "agentos/tasks_get", args: { id: tkId } }, 5);
const gotText = got.result?.content?.[0]?.text ?? "";
check("tasks_get reads the task by display id", got.result?.isError !== true && gotText.includes(tkId) && gotText.includes("do the thing"));

const nav = await mcpCall("execute_action", { key: "agentos/navigate", args: { route: "/pipeline" } }, 4);
check("navigate returns ok", nav.result?.isError !== true && (nav.result?.content?.[0]?.text ?? "").includes("/pipeline"));
const navEvent = recent({ type: "ui.navigate" })[0];
check("ui.navigate event emitted for the overlay", navEvent?.payload?.route === "/pipeline");

const evs = await mcpCall("execute_action", { key: "agentos/events_recent", args: { type: "ui.navigate", limit: 5 } }, 6);
check("events_recent reads the bus", evs.result?.isError !== true && (evs.result?.content?.[0]?.text ?? "").includes("/pipeline"));

const jobs = await mcpCall("execute_action", { key: "agentos/jobs_list", args: {} }, 7);
check("jobs_list surfaces scheduler jobs", jobs.result?.isError !== true && (jobs.result?.content?.[0]?.text ?? "").includes("core:db-backup"));

// Approval gates — the verified refusal paths:
//  (a) published hub lane refuses requires_approval tools in BOTH modes;
const upubRefused = await hub.executeAction("agentos", "tasks_update_status", { id: tkId, status: "Waiting" }, { source: "smoke", interactive: true });
check("tasks_update_status refuses on the published lane (approval)", upubRefused.ok === false && (upubRefused.error ?? "").includes("approval"));
const pagesRefused = await hub.executeAction("agentos", "pages_append", { text: "should not land" }, { source: "smoke" });
check("pages_append refuses on the published lane (approval)", pagesRefused.ok === false && (pagesRefused.error ?? "").includes("approval"));
//  (b) plain registry keys refuse strict/MCP callers inside the handler;
const strictRefused = await mcpCall("execute_action", { key: "tasks_update_status", args: { id: tkId, status: "Waiting" } }, 8);
check("bare tasks_update_status action refuses strict MCP callers", (strictRefused.result?.content?.[0]?.text ?? "").includes("approval"));
check("strict refusal did not move the task", listTasks({}).find((t) => t.displayId === tkId)?.status === "Todo");
//  (c) the Test-tab draft lane bypasses (you are the human) and the action works.
const draftUpdate = await executeDraftTool("agentos", "tasks_update_status", { id: tkId, status: "Waiting" }, "test");
check("draft/test lane runs tasks_update_status (agent → Waiting)", draftUpdate.ok === true && listTasks({}).find((t) => t.displayId === tkId)?.status === "Waiting");
const draftAppend = await executeDraftTool("agentos", "pages_append", { text: "smoke appended line\nsecond paragraph" }, "test");
const pagesStore = await import("../../src/lib/v2/pages/store.ts");
const todayPage = pagesStore.getPageByDate(pagesStore.localDateStr());
const todayText = JSON.stringify(todayPage?.doc ?? {});
check("pages_append lands paragraphs on today's page", draftAppend.ok === true && todayText.includes("smoke appended line") && todayText.includes("second paragraph"));

// hub seam + hub surface
check("globalThis.__agentosMcpHub seam installed", typeof globalThis.__agentosMcpHub?.executeAction === "function" && typeof globalThis.__agentosMcpHub?.getActions === "function" && typeof globalThis.__agentosMcpHub?.listPublishedPackages === "function");
const hubPkgs = hub.listPublishedPackages();
check("hub lists published packages only", hubPkgs.some((p) => p.slug === "agentos") && !hubPkgs.some((p) => p.slug === "smoke-echo"));
const hubActions = hub.getActions("all", "create a task");
check("hub getActions intent filter ranks tasks_create", hubActions[0]?.name === "tasks_create" && hubActions[0].package === "agentos");
check("hub getActions('agentos') returns exact advertised names", hub.getActions("agentos").map((t) => t.name).sort().join(",") === SEED_NAMES.join(","));

// ---------------------------------------------------------------------------
// L. Packages route smoke (create via route + 409)
// ---------------------------------------------------------------------------
const pkgsRoute = await import("../../src/app/api/v2/webmcp/packages/route.ts");
const createRes = await pkgsRoute.POST(
  new NextRequest("http://127.0.0.1/api/v2/webmcp/packages", { method: "POST", body: JSON.stringify({ slug: "smoke-route", name: "Route pkg" }) }),
);
check("packages POST route creates (201)", createRes.status === 201 && (await createRes.json()).package?.slug === "smoke-route");
const dupRes = await pkgsRoute.POST(
  new NextRequest("http://127.0.0.1/api/v2/webmcp/packages", { method: "POST", body: JSON.stringify({ slug: "smoke-route", name: "Route pkg" }) }),
);
check("packages POST route 409 on dup slug", dupRes.status === 409);
const listRes = await pkgsRoute.GET();
check("packages GET route lists", (await listRes.json()).packages.some((p) => p.slug === "smoke-route"));

// ---------------------------------------------------------------------------
const { __closeForTests } = await import("../../src/lib/v2/db.ts");
__closeForTests();
try {
  fs.rmSync(tmpDb, { force: true });
  fs.rmSync(tmpDb + "-wal", { force: true });
  fs.rmSync(tmpDb + "-shm", { force: true });
  fs.rmSync(settingsDir, { recursive: true, force: true });
  fs.rmSync(webmcpDir, { recursive: true, force: true });
} catch {}

console.log(failures === 0 ? "\nsmoke-webmcp: ALL PASS" : `\nsmoke-webmcp: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
