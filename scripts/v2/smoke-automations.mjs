// SPEC-D G5.1/G5.2/G5.4 smoke: the automations engine + routes + run_tool.
// FULLY OFFLINE — temp DB/settings/key, fixture connector + mocked gmail
// transport, NO LLM anywhere (the engine is deterministic by design). Covers:
//   seed rule on fixture event → ok runs + create_attention item (deduped);
//   create_task action → Ready task with source 'automation';
//   non-matching trigger → NO run row; matching trigger + failing condition →
//     condition_miss rows (recorded ONLY on trigger match);
//   {{payload.*}} substitution incl. missing-path ("" behavior) + the
//     exact-placeholder raw-value passthrough; loop guard (automation-sourced
//     events never re-trigger rules);
//   run_tool non-destructive E2E (call log rows, source 'automation:<ruleId>');
//   run_tool soft failure → action_failed run + attention item;
//   destructive without confirmDestructive → 422 at save AND fire-time refusal
//     when forced into the DB; destructive WITH confirm → executes;
//   /test dry-run never executes; regex condition with a pathological pattern
//     is 422'd at save and fails FAST (complexity guard) when forced in;
//   settings.automations.enabled kill switch.
// Run: npx tsx scripts/v2/smoke-automations.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// Temp env BEFORE any src imports — never the live DB/settings/key.
const stamp = Date.now();
const tmpDb = path.join(os.tmpdir(), `agentos-smoke-auto-${stamp}.db`);
process.env.AGENTIC_OS_DB = tmpDb;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-auto-"));
const settingsFile = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_SETTINGS = settingsFile;
process.env.AGENTIC_OS_KEY = path.join(settingsDir, "agentos.key");
process.env.OLLAMA_URL = "http://127.0.0.1:1"; // dead port — embeds fail fast
fs.writeFileSync(
  settingsFile,
  JSON.stringify({ tasks: { timezone: "America/Chicago" }, memory: { ingestEnabled: false } }),
);

const { ensureDb, __closeForTests } = await import("../../src/lib/v2/db.ts");
const engine = await import("../../src/lib/v2/automations/engine.ts");
const attnStore = await import("../../src/lib/v2/attention/store.ts");
const events = await import("../../src/lib/v2/events.ts");
const runtime = await import("../../src/lib/v2/integrations/runtime.ts");
const intStore = await import("../../src/lib/v2/integrations/store.ts");
const { runAccountSync } = await import("../../src/lib/v2/integrations/sync.ts");
const googleClient = await import("../../src/lib/v2/integrations/connectors/googleClient.ts");
const tasksStore = await import("../../src/lib/v2/tasks/store.ts");
const { readSettings, writeSettings } = await import("../../src/lib/settings.ts");
const rulesRoute = await import("../../src/app/api/v2/automations/route.ts");
const runsRoute = await import("../../src/app/api/v2/automations/runs/route.ts");
const testRoute = await import("../../src/app/api/v2/automations/test/route.ts");
const { NextRequest } = await import("next/server");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra).slice(0, 300)}` : ""}`);
  if (!cond) failures++;
};

ensureDb();
engine.ensureAutomations();

const req = (url, method, body) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const post = (body) => rulesRoute.POST(req("/api/v2/automations", "POST", body));
const patch = (body) => rulesRoute.PATCH(req("/api/v2/automations", "PATCH", body));

// Fresh fixture account per fire (cursor 0 → 3 TEST_EVENT activities).
let acctN = 0;
const freshAccount = () => runtime.setupAccount("_test", { fields: { token: `tok-${++acctN}` } });
const fire = async (account) => {
  const out = await runAccountSync(account.id, "manual");
  await engine.automationsIdle();
  return out;
};
const deactivate = (id) => engine.updateRule(id, { isActive: false });

// Mocked gmail account for the destructive legs (smoke-int-metatools pattern).
let sendCalls = 0;
googleClient.__setGoogleMockForTests({
  gmail: () => ({
    users: {
      messages: { send: async () => { sendCalls++; return { data: { id: "sent-1", threadId: "t-1" } }; } },
    },
  }),
  userinfo: async () => ({ email: "yoshi@example.com", id: "uid-1" }),
});
intStore.patchDefinitionConfig("gmail", { clientId: "cid-1", clientSecret: "csec-1" });
const gmailAccount = await runtime.setupAccount("gmail", {
  oauthResponse: { access_token: "AT-1", refresh_token: "RT-1", token_type: "Bearer", expires_in: 3600 },
  oauthParams: { redirect_uri: "http://localhost:3000/api/v2/integrations/oauth/callback" },
});

// ---------------------------------------------------------------------------
// A. Route validation — op/kind whitelists, regex guard, destructive save gate
// ---------------------------------------------------------------------------
check("POST without name → 422", (await post({ triggerEvent: "X", actions: [{ kind: "notify" }] })).status === 422);
check("POST without triggerEvent → 422", (await post({ name: "r", actions: [{ kind: "notify" }] })).status === 422);
check("POST with empty actions → 422", (await post({ name: "r", triggerEvent: "X", actions: [] })).status === 422);
check("POST with a non-whitelisted op → 422",
  (await post({ name: "r", triggerEvent: "X", conditions: [{ field: "text", op: "evil_eval", value: "x" }], actions: [{ kind: "notify" }] })).status === 422);
check("POST with a non-whitelisted action kind → 422",
  (await post({ name: "r", triggerEvent: "X", actions: [{ kind: "exec_shell" }] })).status === 422);
{
  const res = await post({
    name: "r", triggerEvent: "X",
    conditions: [{ field: "text", op: "regex", value: "(a+)+$" }],
    actions: [{ kind: "notify" }],
  });
  const j = await res.json();
  check("POST with a pathological regex → 422 naming the complexity guard",
    res.status === 422 && /catastroph/i.test(j.error ?? ""), j);
}
{
  const res = await post({
    name: "danger", triggerEvent: "TEST_EVENT", triggerSlug: "_test",
    actions: [{ kind: "run_tool", accountId: gmailAccount.id, tool: "gmail_send_email", argsTemplate: { to: ["a@b.c"], subject: "s", body: "b" } }],
  });
  const j = await res.json();
  check("run_tool on a destructive tool WITHOUT confirmDestructive → 422 (save gate)",
    res.status === 422 && /confirmDestructive/.test(j.error ?? ""), j);
}
check("run_tool with an unknown account → 422",
  (await post({ name: "r", triggerEvent: "X", actions: [{ kind: "run_tool", accountId: "nope", tool: "t" }] })).status === 422);
check("run_tool with a tool the connector doesn't advertise → 422",
  (await post({ name: "r", triggerEvent: "X", actions: [{ kind: "run_tool", accountId: gmailAccount.id, tool: "gmail_nope" }] })).status === 422);

// ---------------------------------------------------------------------------
// B. Matched fire → ok runs + create_attention (deduped) + create_task
// ---------------------------------------------------------------------------
const r1Res = await post({
  name: "flag fixtures",
  triggerSlug: "_test",
  triggerEvent: "TEST_EVENT",
  conditions: [{ field: "text", op: "contains", value: "fixture" }],
  actions: [
    { kind: "create_attention", severity: "urgent", titleTemplate: "Fixture #{{payload.n}}: {{text}}" },
    { kind: "create_task", titleTemplate: "Handle {{text}}" },
  ],
});
check("valid rule saves (201)", r1Res.status === 201);
const rule1 = (await r1Res.json()).rule;

const acctA = await freshAccount();
await fire(acctA);
{
  const runs = engine.listRuns({ ruleId: rule1.id });
  check("3 fixture activities → 3 ok runs (trigger + conditions matched)",
    runs.length === 3 && runs.every((r) => r.status === "ok"), runs.map((r) => r.status));
  check("run rows carry the trigger snapshot + activity id",
    runs.every((r) => typeof r.activityId === "string") && runs.some((r) => r.trigger.n === 1));
  const item = attnStore.getByDedupeKey(`automation:${rule1.id}`);
  check("create_attention landed ONE deduped item with substituted title",
    item?.status === "open" && item.severity === "urgent" && /^Fixture #\d: fixture/.test(item.title) &&
    attnStore.listItems({ kind: "automation", limit: 500 }).filter((i) => i.dedupeKey === `automation:${rule1.id}`).length === 1, item);
  const auto = tasksStore.listTasks({ source: "automation" });
  check("create_task made Ready tasks with source 'automation' + substituted title",
    auto.length === 3 && auto.every((t) => t.status === "Ready") && auto.some((t) => /Handle fixture activity one/.test(t.title)), auto.map?.((t) => t.title));
  const updated = engine.getRule(rule1.id);
  check("fire_count bumped + last_fired_at stamped", updated.fireCount === 3 && typeof updated.lastFiredAt === "string");
}
deactivate(rule1.id);

// ---------------------------------------------------------------------------
// C. Non-matching trigger → NO run row · D. condition miss → condition_miss
// ---------------------------------------------------------------------------
const rule2 = engine.createRule({ name: "never fires", triggerSlug: "_test", triggerEvent: "NOPE_EVENT", actions: [{ kind: "notify" }] });
const rule3 = engine.createRule({
  name: "misses conditions",
  triggerSlug: "_test",
  triggerEvent: "TEST_EVENT",
  conditions: [{ field: "text", op: "contains", value: "zzz-not-present" }],
  actions: [{ kind: "notify" }],
});
const acctB = await freshAccount();
await fire(acctB);
check("non-matching trigger event → ZERO run rows", engine.listRuns({ ruleId: rule2.id }).length === 0);
{
  const runs = engine.listRuns({ ruleId: rule3.id });
  check("matching trigger + failing condition → condition_miss rows (only then)",
    runs.length === 3 && runs.every((r) => r.status === "condition_miss"), runs.map((r) => r.status));
  check("condition_miss detail names the failing condition",
    runs[0].detail?.conditions?.[0]?.pass === false && runs[0].detail.conditions[0].value === "zzz-not-present");
  check("condition_miss does NOT bump fire_count", engine.getRule(rule3.id).fireCount === 0);
}
deactivate(rule2.id);
deactivate(rule3.id);

// ---------------------------------------------------------------------------
// E. notify: {{payload.*}} substitution + missing path + loop guard
// ---------------------------------------------------------------------------
const notifyPayloads = [];
const offNotify = events.on("automation.notify", (ev) => notifyPayloads.push(ev.payload));
const rule4 = engine.createRule({
  name: "notifier",
  triggerSlug: "*",
  triggerEvent: "TEST_EVENT",
  actions: [{ kind: "notify", messageTemplate: "n={{payload.n}}|missing={{payload.nope}}|slug={{account.slug}}" }],
});
const rule5 = engine.createRule({
  name: "chain attempt",
  triggerSlug: "system",
  triggerEvent: "automation.notify",
  actions: [{ kind: "create_attention", titleTemplate: "chained!" }],
});
const acctC = await freshAccount();
await fire(acctC);
check("notify fired with substituted template (missing path → empty string)",
  notifyPayloads.some((p) => p.message === "n=1|missing=|slug=_test"), notifyPayloads.map((p) => p.message));
check("loop guard: automation-sourced events never re-trigger rules",
  engine.listRuns({ ruleId: rule5.id }).length === 0 && attnStore.listItems({ limit: 500 }).every((i) => i.title !== "chained!"));
offNotify();
deactivate(rule4.id);
deactivate(rule5.id);

// ---------------------------------------------------------------------------
// F. run_tool non-destructive E2E (source tag + raw-value passthrough)
// ---------------------------------------------------------------------------
const acctD = await freshAccount();
const rule6 = engine.createRule({
  name: "echo runner",
  triggerSlug: "_test",
  triggerEvent: "TEST_EVENT",
  conditions: [{ field: "payload.n", op: "eq", value: "1" }],
  actions: [{ kind: "run_tool", accountId: acctD.id, tool: "_test_echo", argsTemplate: { text: "{{payload.n}}-{{account.slug}}", n: "{{payload.n}}" } }],
});
await fire(acctD);
{
  const runs = engine.listRuns({ ruleId: rule6.id });
  const ok = runs.filter((r) => r.status === "ok");
  check("run_tool fired once (condition scoped to n=1) and succeeded E2E",
    ok.length === 1 && runs.length === 3 /* 1 ok + 2 condition_miss for n=2,3 */, runs.map((r) => r.status));
  check("run_tool result detail carries the echoed substitution",
    ok[0]?.detail?.actions?.[0]?.detail?.includes('"echoed":"1-_test"'), ok[0]?.detail);
  const log = intStore.listCallLogs(acctD.id).find((l) => l.toolName === "_test_echo");
  check("call log row written with source 'automation:<ruleId>' (G5.4 tag)",
    log?.ok === true && log.source === `automation:${rule6.id}`, log);
  check("exact-placeholder passthrough keeps the RAW value type (n stays a number)",
    log?.args?.n === 1, log?.args);
}
deactivate(rule6.id);

// ---------------------------------------------------------------------------
// G. run_tool soft failure → action_failed + attention item
// ---------------------------------------------------------------------------
const acctE = await freshAccount();
const rule7 = engine.createRule({
  name: "doomed runner",
  triggerSlug: "_test",
  triggerEvent: "TEST_EVENT",
  conditions: [{ field: "payload.n", op: "eq", value: "1" }],
  actions: [{ kind: "run_tool", accountId: acctE.id, tool: "_test_fail", argsTemplate: {} }],
});
await fire(acctE);
{
  const failedRuns = engine.listRuns({ ruleId: rule7.id }).filter((r) => r.status === "action_failed");
  check("soft tool failure → action_failed run with the Error text",
    failedRuns.length === 1 && /fixture API exploded/.test(failedRuns[0].error ?? ""), failedRuns);
  const item = attnStore.getByDedupeKey(`automation-failed:${rule7.id}`);
  check("action failure flagged on the attention hero", item?.status === "open" && /doomed runner/.test(item.title), item);
}
deactivate(rule7.id);

// ---------------------------------------------------------------------------
// H. Destructive: forced-in unconfirmed → fire-time refusal · confirmed → runs
// ---------------------------------------------------------------------------
const rule8 = engine.createRule({
  // Forced PAST the route (dumb store insert) — the engine must still refuse.
  name: "forced destructive",
  triggerSlug: "*",
  triggerEvent: "TEST_EVENT",
  conditions: [{ field: "payload.n", op: "eq", value: "1" }],
  actions: [{ kind: "run_tool", accountId: gmailAccount.id, tool: "gmail_send_email", argsTemplate: { to: ["a@b.c"], subject: "s", body: "b" } }],
});
const acctF = await freshAccount();
await fire(acctF);
{
  const failed = engine.listRuns({ ruleId: rule8.id }).filter((r) => r.status === "action_failed");
  check("unconfirmed destructive rule forced into the DB → fire-time REFUSAL (nothing sent)",
    failed.length === 1 && /refused at fire time/.test(failed[0].error ?? "") && sendCalls === 0, failed);
}
deactivate(rule8.id);

const r9Res = await post({
  name: "confirmed destructive",
  triggerSlug: "*",
  triggerEvent: "TEST_EVENT",
  conditions: [{ field: "payload.n", op: "eq", value: "1" }],
  actions: [{ kind: "run_tool", accountId: gmailAccount.id, tool: "gmail_send_email", argsTemplate: { to: ["a@b.c"], subject: "s {{payload.n}}", body: "b" }, confirmDestructive: true }],
});
check("destructive WITH confirmDestructive saves (201)", r9Res.status === 201);
const rule9 = (await r9Res.json()).rule;
const acctG = await freshAccount();
await fire(acctG);
{
  const ok = engine.listRuns({ ruleId: rule9.id }).filter((r) => r.status === "ok");
  check("confirmed destructive rule EXECUTES directly (no Human-Gate)", ok.length === 1 && sendCalls === 1, { sendCalls });
  const log = intStore.listCallLogs(gmailAccount.id).find((l) => l.toolName === "gmail_send_email");
  check("gmail call logged under source 'automation:<ruleId>'", log?.ok === true && log.source === `automation:${rule9.id}`, log);
}
deactivate(rule9.id);

// ---------------------------------------------------------------------------
// I. /test dry-run — evaluates, NEVER executes
// ---------------------------------------------------------------------------
const runsBefore = engine.listRuns({ limit: 500 }).length;
const logsBefore = intStore.listCallLogs(gmailAccount.id).length;
const testRes = await testRoute.POST(req("/api/v2/automations/test", "POST", {
  rule: {
    name: "dry", triggerSlug: "*", triggerEvent: "TEST_EVENT",
    conditions: [{ field: "text", op: "contains", value: "invoice" }],
    actions: [{ kind: "run_tool", accountId: gmailAccount.id, tool: "gmail_send_email", argsTemplate: {} }],
  },
  samplePayload: { text: "an invoice arrived" },
}));
const testJson = await testRes.json();
check("/test reports matched + wouldRun with per-condition results",
  testRes.status === 200 && testJson.matched === true && testJson.wouldRun[0]?.tool === "gmail_send_email" && testJson.conditions[0]?.pass === true, testJson);
const testMiss = await (await testRoute.POST(req("/api/v2/automations/test", "POST", {
  ruleId: rule9.id,
  samplePayload: { n: 7 },
}))).json();
check("/test by ruleId reports a condition miss with actuals", testMiss.matched === false && testMiss.conditions[0].actual === "7" && testMiss.wouldRun.length === 0, testMiss);
check("/test NEVER executes (no run rows, no call logs, nothing sent)",
  engine.listRuns({ limit: 500 }).length === runsBefore && intStore.listCallLogs(gmailAccount.id).length === logsBefore && sendCalls === 1);

// ---------------------------------------------------------------------------
// J. Pathological regex forced into the DB → fast false, never a hang
// ---------------------------------------------------------------------------
const rule10 = engine.createRule({
  name: "regex bomb",
  triggerSlug: "*",
  triggerEvent: "TEST_EVENT",
  conditions: [{ field: "text", op: "regex", value: "(a+)+$" }],
  actions: [{ kind: "notify" }],
});
const acctH = await freshAccount();
const t0 = Date.now();
await fire(acctH);
const elapsed = Date.now() - t0;
{
  const runs = engine.listRuns({ ruleId: rule10.id });
  check("forced-in pathological regex evaluates FAST (complexity guard, no hang)",
    elapsed < 3000 && runs.length === 3 && runs.every((r) => r.status === "condition_miss"), { elapsed, statuses: runs.map((r) => r.status) });
  check("the rejected pattern is named on the condition result",
    /catastroph/i.test(runs[0].detail?.conditions?.[0]?.error ?? ""), runs[0].detail);
}
deactivate(rule10.id);

// A sane regex still works end-to-end.
const rule11 = engine.createRule({
  name: "sane regex",
  triggerSlug: "*",
  triggerEvent: "TEST_EVENT",
  conditions: [{ field: "text", op: "regex", value: "^fixture activity (one|two)$" }],
  actions: [{ kind: "notify" }],
});
const acctI = await freshAccount();
await fire(acctI);
check("sane regex matches 2 of 3 fixture activities",
  engine.listRuns({ ruleId: rule11.id }).filter((r) => r.status === "ok").length === 2);
deactivate(rule11.id);

// ---------------------------------------------------------------------------
// K. Kill switch — settings.automations.enabled=false stops all firing
// ---------------------------------------------------------------------------
const rule12 = engine.createRule({ name: "killed", triggerSlug: "*", triggerEvent: "TEST_EVENT", actions: [{ kind: "notify" }] });
writeSettings({ automations: { ...(readSettings().automations ?? {}), enabled: false } });
const acctJ = await freshAccount();
await fire(acctJ);
check("kill switch OFF → no runs recorded", engine.listRuns({ ruleId: rule12.id }).length === 0);
writeSettings({ automations: { ...(readSettings().automations ?? {}), enabled: true } });
const acctK = await freshAccount();
await fire(acctK);
check("kill switch back ON → rules fire again", engine.listRuns({ ruleId: rule12.id }).length === 3);
deactivate(rule12.id);

// ---------------------------------------------------------------------------
// L. Rules routes: GET metadata + PATCH revalidation + DELETE deactivates
// ---------------------------------------------------------------------------
const listJson = await (await rulesRoute.GET()).json();
check("GET returns rules + builder metadata (triggers/actionKinds/conditionOps)",
  Array.isArray(listJson.rules) && listJson.rules.length >= 10 &&
  // '_'-prefixed fixture connectors are hidden from the trigger picker by
  // design — real connector triggers + the system events are what it offers.
  listJson.available.triggers.some((t) => t.event === "GMAIL_MESSAGE_RECEIVED" && t.slug === "gmail") &&
  listJson.available.triggers.some((t) => t.event === "sync.failed" && t.slug === "system") &&
  !listJson.available.triggers.some((t) => t.slug === "_test") &&
  listJson.available.actionKinds.includes("run_tool") &&
  listJson.available.conditionOps.includes("regex"));
{
  const res = await patch({ id: rule9.id, actions: [{ kind: "run_tool", accountId: gmailAccount.id, tool: "gmail_send_email", argsTemplate: {} }] });
  check("PATCH stripping confirmDestructive off a destructive rule → 422 (no sneak-past)", res.status === 422);
}
{
  const res = await rulesRoute.DELETE(req("/api/v2/automations", "DELETE", { id: rule1.id }));
  const j = await res.json();
  check("DELETE deactivates (row retained)", res.status === 200 && j.rule.isActive === false && engine.getRule(rule1.id) !== null);
}
{
  const runsJson = await (await runsRoute.GET(new NextRequest(`http://localhost/api/v2/automations/runs?ruleId=${rule1.id}&limit=5`))).json();
  check("GET /runs?ruleId= scopes + limits", runsJson.runs.length === 3 && runsJson.runs.every((r) => r.ruleId === rule1.id));
}

// ---------------------------------------------------------------------------
googleClient.__setGoogleMockForTests(null);
engine.stopAutomationsForTests();
try {
  const attn = await import("../../src/lib/v2/attention/index.ts");
  attn.stopAttentionForTests();
} catch {}
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
try { fs.rmSync(settingsDir, { recursive: true, force: true }); } catch {}
console.log(failures === 0 ? "\nsmoke-automations: ALL PASS" : `\nsmoke-automations: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
