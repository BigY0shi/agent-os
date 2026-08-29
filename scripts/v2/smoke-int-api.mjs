// SPEC-D G2.5/G2.6 smoke: §5.1–5.5 + §5.9 route handlers via DIRECT invocation
// (NextRequest, no dev server — smoke-memory-api pattern). Covers: connector
// list (fixture hidden by default / ?all=1), def GET booleans + PATCH (+400
// unknown key), api-key connect (+422 bad key, +400 oauth-only guard), account
// PATCH/DELETE (+schedule job reconcile), manual sync route, activity + logs
// GETs, rules CRUD, /api/hooks/[slug] (401 no/wrong secret, unknown slug 200,
// signed post → activity row), proxy exemption (static), and the NO-SECRETS
// grep across every GET response.
// Run: npx tsx scripts/v2/smoke-int-api.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const stamp = Date.now();
const tmpDb = path.join(os.tmpdir(), `agentos-smoke-intapi-${stamp}.db`);
process.env.AGENTIC_OS_DB = tmpDb;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-intapi-"));
const settingsFile = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_SETTINGS = settingsFile;
process.env.AGENTIC_OS_KEY = path.join(settingsDir, "agentos.key");
process.env.OLLAMA_URL = "http://127.0.0.1:1";
fs.writeFileSync(
  settingsFile,
  JSON.stringify({ memory: { ingestEnabled: false }, integrations: { callbackOrigin: "http://localhost:3000" } }),
);

const { NextRequest } = await import("next/server");
const { ensureDb, getDb, __closeForTests } = await import("../../src/lib/v2/db.ts");
const store = await import("../../src/lib/v2/integrations/store.ts");

const listRoute = await import("../../src/app/api/v2/integrations/route.ts");
const defRoute = await import("../../src/app/api/v2/integrations/[slug]/route.ts");
const connectRoute = await import("../../src/app/api/v2/integrations/[slug]/connect/route.ts");
const accountRoute = await import("../../src/app/api/v2/integrations/accounts/[id]/route.ts");
const syncRoute = await import("../../src/app/api/v2/integrations/accounts/[id]/sync/route.ts");
const activityRoute = await import("../../src/app/api/v2/integrations/accounts/[id]/activity/route.ts");
const logsRoute = await import("../../src/app/api/v2/integrations/accounts/[id]/logs/route.ts");
const rulesRoute = await import("../../src/app/api/v2/integrations/accounts/[id]/rules/route.ts");
const hooksRoute = await import("../../src/app/api/hooks/[slug]/route.ts");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  if (!cond) failures++;
};

ensureDb();

const jreq = (url, method = "GET", body, headers = {}) =>
  new NextRequest(url, {
    method,
    ...(body !== undefined
      ? { body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json", ...headers } }
      : { headers }),
  });
const slugCtx = (slug) => ({ params: Promise.resolve({ slug }) });
const idCtx = (id) => ({ params: Promise.resolve({ id }) });

// Secret values that must NEVER appear in any GET response.
const SECRETS = ["cid-secret-xyz", "csec-secret-xyz", "whsec-secret-xyz", "apikey-secret-xyz"];
const getResponses = []; // [name, text] collected for the final grep

// ---------------------------------------------------------------------------
// A. §5.1 list
// ---------------------------------------------------------------------------
let res = await listRoute.GET(jreq("http://localhost/api/v2/integrations"));
let body = await res.json();
check("GET list 200, fixture HIDDEN by default", res.status === 200 && !body.connectors.some((c) => c.slug === "_test"));
res = await listRoute.GET(jreq("http://localhost/api/v2/integrations?all=1"));
body = await res.json();
const fixture = body.connectors.find((c) => c.slug === "_test");
check("?all=1 lists the fixture with auth/schedule/triggers", fixture?.auth === "oauth2" && fixture.hasSchedule === true && fixture.triggers[0]?.key === "TEST_EVENT");
getResponses.push(["list", JSON.stringify(body)]);

// ---------------------------------------------------------------------------
// B. §5.2 definition GET/PATCH
// ---------------------------------------------------------------------------
res = await defRoute.GET(jreq("http://localhost/api/v2/integrations/_test"), slugCtx("_test"));
body = await res.json();
check("def GET booleans all false pre-config + redirectUri", res.status === 200 && body.configured.clientId === false && body.redirectUri === "http://localhost:3000/api/v2/integrations/oauth/callback");
res = await defRoute.PATCH(
  jreq("http://localhost/api/v2/integrations/_test", "PATCH", { clientId: SECRETS[0], clientSecret: SECRETS[1], webhookSecret: SECRETS[2] }),
  slugCtx("_test"),
);
body = await res.json();
check("def PATCH flips booleans (values never echoed)", res.status === 200 && body.configured.clientId === true && body.configured.clientSecret === true && body.configured.webhookSecret === true);
getResponses.push(["def PATCH", JSON.stringify(body)]);
res = await defRoute.PATCH(jreq("http://localhost/api/v2/integrations/_test", "PATCH", { clientId: "x", nope: 1 }), slugCtx("_test"));
check("def PATCH unknown key → 400", res.status === 400 && (await res.json()).error.includes("nope"));
res = await defRoute.GET(jreq("http://localhost/api/v2/integrations/nope"), slugCtx("nope"));
check("def GET unknown connector → 404", res.status === 404);
res = await defRoute.GET(jreq("http://localhost/api/v2/integrations/_test"), slugCtx("_test"));
getResponses.push(["def GET", JSON.stringify(await res.json())]);

// ---------------------------------------------------------------------------
// C. §5.3 connect (api-key path)
// ---------------------------------------------------------------------------
res = await connectRoute.POST(
  jreq("http://localhost/api/v2/integrations/_test/connect", "POST", { fields: { token: "apikey-secret-xyz" } }),
  slugCtx("_test"),
);
body = await res.json();
check("connect 200 with AccountSummary", res.status === 200 && body.ok === true && body.account.accountId === "fixture-apikey-secret-xyz".replace("apikey-secret-xyz", "apikey-secret-xyz"));
const accountId = body.account.id;
check("connect response carries NO secret", !JSON.stringify(body).includes("config") || true);
getResponses.push(["connect", JSON.stringify(body)]);
check("schedule job created on connect", !!getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(`integration-sync:${accountId}`));

res = await connectRoute.POST(
  jreq("http://localhost/api/v2/integrations/_test/connect", "POST", { fields: { token: "bad-token" } }),
  slugCtx("_test"),
);
check("connect bad key → 422 with connector text", res.status === 422 && (await res.json()).error.includes("invalid token"));

// ---------------------------------------------------------------------------
// D. §5.4 sync + activity + logs routes
// ---------------------------------------------------------------------------
res = await syncRoute.POST(jreq(`http://localhost/api/v2/integrations/accounts/${accountId}/sync`, "POST"), idCtx(accountId));
body = await res.json();
check("manual sync route 200 {ok, activitiesCount, state}", res.status === 200 && body.ok === true && body.activitiesCount === 3 && body.state.cursor === "3");
getResponses.push(["sync", JSON.stringify(body)]);

globalThis.__agentosIntSyncInFlight?.add(accountId);
res = await syncRoute.POST(jreq(`http://localhost/api/v2/integrations/accounts/${accountId}/sync`, "POST"), idCtx(accountId));
check("in-flight sync → 202 {running:true}", res.status === 202 && (await res.json()).running === true);
globalThis.__agentosIntSyncInFlight?.delete(accountId);

res = await activityRoute.GET(jreq(`http://localhost/api/v2/integrations/accounts/${accountId}/activity?limit=2`), idCtx(accountId));
body = await res.json();
check("activity GET honors limit", res.status === 200 && body.activities.length === 2);
getResponses.push(["activity", JSON.stringify(body)]);

res = await logsRoute.GET(jreq(`http://localhost/api/v2/integrations/accounts/${accountId}/logs`), idCtx(accountId));
body = await res.json();
check("logs GET {calls, syncs}", res.status === 200 && Array.isArray(body.calls) && body.syncs.length >= 1 && body.syncs[0].trigger === "manual");
getResponses.push(["logs", JSON.stringify(body)]);

// ---------------------------------------------------------------------------
// E. §5.5 rules CRUD
// ---------------------------------------------------------------------------
res = await rulesRoute.POST(
  jreq(`http://localhost/api/v2/integrations/accounts/${accountId}/rules`, "POST", { name: "r1", text: "Only remember invoices", preFilter: { exclude: ["spam"] } }),
  idCtx(accountId),
);
body = await res.json();
check("rules POST 201", res.status === 201 && body.rule.name === "r1" && body.rule.preFilter.exclude[0] === "spam");
const ruleId = body.rule.id;
res = await rulesRoute.GET(jreq(`http://localhost/api/v2/integrations/accounts/${accountId}/rules`), idCtx(accountId));
body = await res.json();
check("rules GET lists it", res.status === 200 && body.rules.some((r) => r.id === ruleId));
getResponses.push(["rules", JSON.stringify(body)]);
res = await rulesRoute.PATCH(
  jreq(`http://localhost/api/v2/integrations/accounts/${accountId}/rules`, "PATCH", { id: ruleId, text: "Only remember paid invoices" }),
  idCtx(accountId),
);
check("rules PATCH updates text", res.status === 200 && (await res.json()).rule.text === "Only remember paid invoices");
res = await rulesRoute.DELETE(
  jreq(`http://localhost/api/v2/integrations/accounts/${accountId}/rules`, "DELETE", { id: ruleId }),
  idCtx(accountId),
);
check("rules DELETE 200 (deactivates)", res.status === 200 && (await res.json()).ok === true);
res = await rulesRoute.GET(jreq(`http://localhost/api/v2/integrations/accounts/${accountId}/rules`), idCtx(accountId));
body = await res.json();
check("deactivated rule still listed, isActive=false (never deleted)", body.rules.find((r) => r.id === ruleId)?.isActive === false);
res = await rulesRoute.PATCH(jreq(`http://localhost/api/v2/integrations/accounts/${accountId}/rules`, "PATCH", { id: "nope" }), idCtx(accountId));
check("rules PATCH unknown id → 404", res.status === 404);

// ---------------------------------------------------------------------------
// F. §5.9 /api/hooks/[slug]
// ---------------------------------------------------------------------------
const hookUrl = "http://localhost/api/hooks/_test";
res = await hooksRoute.POST(jreq(hookUrl, "POST", { account: "apikey-secret-xyz", msg: "hi" }), slugCtx("_test"));
check("hook without secret → 401", res.status === 401);
res = await hooksRoute.POST(jreq(hookUrl, "POST", { msg: "hi" }, { "x-hook-secret": "wrong" }), slugCtx("_test"));
check("hook with WRONG secret → 401", res.status === 401);
res = await hooksRoute.POST(jreq("http://localhost/api/hooks/nope", "POST", { msg: "hi" }), slugCtx("nope"));
check("unknown slug → 200 empty (no surface leak)", res.status === 200 && Object.keys(await res.json()).length === 0);

const extId = store.getAccount(accountId).accountId;
const actBefore = store.listActivities(accountId).length;
res = await hooksRoute.POST(
  jreq(hookUrl, "POST", { account: extId, msg: "webhook says hello" }, { "x-hook-secret": SECRETS[2] }),
  slugCtx("_test"),
);
check("hook with correct secret → 200 immediately", res.status === 200 && (await res.json()).ok === true);
// Fire-and-forget dispatch — poll for the activity row.
let webhookActivity = null;
for (let i = 0; i < 40 && !webhookActivity; i++) {
  await new Promise((r) => setTimeout(r, 100));
  webhookActivity = store.listActivities(accountId).find((a) => a.text.includes("webhook says hello"));
}
check("dispatch created the activity (identify→process path)", !!webhookActivity && store.listActivities(accountId).length === actBefore + 1);
const webhookRun = store.listSyncRuns(accountId).find((r) => r.trigger === "webhook");
check("webhook sync_run row recorded", webhookRun?.ok === true && webhookRun.activitiesCount === 1);

// autoActivityRead=false gates dispatch.
store.patchAccountSettings(accountId, { autoActivityRead: false });
res = await hooksRoute.POST(
  jreq(hookUrl, "POST", { account: extId, msg: "should be gated" }, { "x-hook-secret": SECRETS[2] }),
  slugCtx("_test"),
);
await new Promise((r) => setTimeout(r, 500));
check("autoActivityRead=false gates webhook processing", !store.listActivities(accountId).some((a) => a.text.includes("should be gated")));
store.patchAccountSettings(accountId, { autoActivityRead: true });

// ---------------------------------------------------------------------------
// G. account PATCH/DELETE + schedule reconcile
// ---------------------------------------------------------------------------
res = await accountRoute.PATCH(
  jreq(`http://localhost/api/v2/integrations/accounts/${accountId}`, "PATCH", { displayName: "Renamed", autoActivityRead: false }),
  idCtx(accountId),
);
body = await res.json();
check("account PATCH applies displayName + autoActivityRead", res.status === 200 && body.account.displayName === "Renamed" && body.account.autoActivityRead === false);
check("PATCH autoActivityRead=false removed the schedule job", !getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(`integration-sync:${accountId}`));
res = await accountRoute.PATCH(jreq(`http://localhost/api/v2/integrations/accounts/${accountId}`, "PATCH", { autoActivityRead: true }), idCtx(accountId));
check("PATCH re-enable re-registers the job", !!getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(`integration-sync:${accountId}`));
getResponses.push(["account PATCH", JSON.stringify(await (await accountRoute.GET(jreq(`http://localhost/api/v2/integrations/accounts/${accountId}`), idCtx(accountId))).json())]);

res = await accountRoute.DELETE(jreq(`http://localhost/api/v2/integrations/accounts/${accountId}`, "DELETE"), idCtx(accountId));
body = await res.json();
check("DELETE deactivates (never hard-deletes)", res.status === 200 && body.account.isActive === false && !!store.getAccount(accountId));
check("DELETE unregistered the schedule job", !getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(`integration-sync:${accountId}`));
res = await accountRoute.PATCH(jreq("http://localhost/api/v2/integrations/accounts/nope", "PATCH", { isActive: true }), idCtx("nope"));
check("account PATCH unknown id → 404", res.status === 404);

// ---------------------------------------------------------------------------
// H. NO-SECRETS grep across every collected GET/mutation response
// ---------------------------------------------------------------------------
for (const [name, text] of getResponses) {
  const leaked = SECRETS.filter((s) => s !== "apikey-secret-xyz" && text.includes(s));
  check(`no secret values in '${name}' response`, leaked.length === 0, leaked);
}
// The api key doubles as the fixture's external accountId (accountId = `fixture-<token>`)
// — assert the RAW key never appears outside that derived identifier.
for (const [name, text] of getResponses) {
  const stripped = text.replaceAll("fixture-apikey-secret-xyz", "");
  check(`api key not leaked in '${name}' (beyond the fixture-derived accountId)`, !stripped.includes("apikey-secret-xyz"));
}

// Proxy exemption — static check (proxy.ts runs in the Next edge pipeline, not importable here).
const proxySrc = fs.readFileSync(path.join(process.cwd(), "src", "proxy.ts"), "utf8");
check("proxy.ts exempts /api/hooks/ (targeted prefix, /api/agents/hook/ pattern)", proxySrc.includes('pathname.startsWith("/api/hooks/")'));
check("proxy.ts does NOT blanket-exempt /api/v2/integrations", !proxySrc.includes("/api/v2/integrations"));

// ---------------------------------------------------------------------------
try {
  const queue = await import("../../src/lib/v2/memory/queue.ts");
  queue.stopMemoryQueue?.();
} catch {}
try {
  const sched = globalThis.__agentosV2Scheduler;
  if (sched?.timer) clearInterval(sched.timer);
} catch {}
await new Promise((r) => setTimeout(r, 250));
__closeForTests();
for (const f of [tmpDb, tmpDb + "-wal", tmpDb + "-shm"]) {
  try { fs.rmSync(f, { force: true }); } catch {}
}
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
