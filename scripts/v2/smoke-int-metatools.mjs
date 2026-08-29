// SPEC-D G4.1/G4.2 smoke: the three integration meta-tools + F4 handoff.
// Offline — mock transports via the existing __set*MockForTests seams,
// AGENTOS_MOCK_LLM=1 for the shared Phase-4 selector. Covers:
//   get_integrations lists fixture + gmail accounts;
//   get_integration_actions ≤3 schemas incl. gmail_send_email (mock-LLM),
//     selection cap, parse-fail → ALL tools + loud warn, provider error →
//     LOUD failure (never a silent all-tools fallback), settings-off keyword
//     fallback, slug-instead-of-UUID → contract error;
//   execute_integration_action round trip on a non-destructive fixture tool
//     (call log row + source tag);
//   destructive tool interactive → Human-Gate pending record (approve
//     executes via the mocked gmail transport, deny doesn't);
//   strict/non-interactive → hard refuse with NO record;
//   §9.4 taint → refused through the brain's execute_action gate, NO record;
//   F4 registry: getAction/searchActions find the three; handleMcpMessage
//     tools/list advertises them; tools/call get_integrations E2E.
// Run: npx tsx scripts/v2/smoke-int-metatools.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// Temp env BEFORE any src imports — never the live DB/settings/key.
const stamp = Date.now();
const tmpDb = path.join(os.tmpdir(), `agentos-smoke-intmeta-${stamp}.db`);
process.env.AGENTIC_OS_DB = tmpDb;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-intmeta-"));
const settingsFile = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_SETTINGS = settingsFile;
process.env.AGENTIC_OS_KEY = path.join(settingsDir, "agentos.key");
process.env.AGENTIC_OS_WEBMCP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-intmeta-wm-"));
process.env.AGENTOS_MOCK_LLM = "1"; // deterministic selector, no network
process.env.OLLAMA_URL = "http://127.0.0.1:1"; // dead port — embeds fail fast
fs.writeFileSync(
  settingsFile,
  JSON.stringify({ tasks: { timezone: "America/Chicago" }, memory: { ingestEnabled: false } }),
);

const { ensureDb, __closeForTests } = await import("../../src/lib/v2/db.ts");
const runtime = await import("../../src/lib/v2/integrations/runtime.ts");
const store = await import("../../src/lib/v2/integrations/store.ts");
const metaTools = await import("../../src/lib/v2/integrations/metaTools.ts");
const googleClient = await import("../../src/lib/v2/integrations/connectors/googleClient.ts");
const { setActionSelectLlmForTests } = await import("../../src/lib/v2/webmcp/actionSelection.ts");
const registry = await import("../../src/lib/v2/mcp/registry.ts");
const { handleMcpMessage } = await import("../../src/lib/v2/mcp/server.ts");
const approvals = await import("../../src/lib/v2/webmcp/approvals.ts");
const jarvisTools = await import("../../src/lib/v2/jarvis/tools.ts");
const { readSettings, writeSettings } = await import("../../src/lib/settings.ts");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra).slice(0, 300)}` : ""}`);
  if (!cond) failures++;
};

ensureDb();

// Capture console.warn for the loud-fallback asserts (pass-through kept).
const warns = [];
const realWarn = console.warn;
console.warn = (...a) => {
  warns.push(a.map(String).join(" "));
  realWarn(...a);
};

// ---------------------------------------------------------------------------
// A. Accounts: fixture (_test, api-key) + gmail (mocked userinfo/transport)
// ---------------------------------------------------------------------------
let sendCalls = 0;
const mockGmail = {
  users: {
    messages: {
      send: async (params) => {
        sendCalls++;
        return { data: { id: "sent-99", threadId: params?.requestBody?.threadId ?? "t-99" } };
      },
    },
  },
};
googleClient.__setGoogleMockForTests({
  gmail: () => mockGmail,
  userinfo: async () => ({ email: "yoshi@example.com", id: "uid-1" }),
});

const fixtureAccount = await runtime.setupAccount("_test", { fields: { token: "tok-meta" } });
store.patchDefinitionConfig("gmail", { clientId: "cid-1", clientSecret: "csec-1" });
const gmailAccount = await runtime.setupAccount("gmail", {
  oauthResponse: {
    access_token: "AT-META-1",
    refresh_token: "RT-META-1",
    token_type: "Bearer",
    expires_in: 3600,
    scope: "gmail",
  },
  oauthParams: { redirect_uri: "http://localhost:3000/api/v2/integrations/oauth/callback" },
});
check("fixture + gmail accounts connected", fixtureAccount.isActive && gmailAccount.accountId === "yoshi@example.com");

// ---------------------------------------------------------------------------
// B. get_integrations — lists BOTH accounts (accountId = row UUID)
// ---------------------------------------------------------------------------
const listText = metaTools.getIntegrationsText();
check("get_integrations lists both connected accounts", listText.includes("Connected Integrations (2)"), listText);
check("gmail entry carries row-id accountId + user identifier + slug", listText.includes(`accountId: ${gmailAccount.id}`) && listText.includes("User identifier: yoshi@example.com") && listText.includes("Slug: gmail"));
check("fixture entry present with its row id", listText.includes(`accountId: ${fixtureAccount.id}`) && listText.includes("Slug: _test"));
check("toolCount rendered per account (gmail advertises 20)", /Tools: 20/.test(listText) && /Tools: 2\b/.test(listText));
// fixture-derived external id (`fixture-<token>`) is the chunk-1 exemption.
check("no decrypted secret in the listing", !listText.replaceAll("fixture-tok-meta", "").includes("tok-meta") && !listText.includes("AT-META-1"));

// ---------------------------------------------------------------------------
// C. get_integration_actions — mock-LLM selection, cap, parse-fail, provider-fail
// ---------------------------------------------------------------------------
// mock selector: a candidate is picked when EVERY word of its name appears in
// the query — 'send an email with gmail' hits exactly gmail_send_email.
const selText = await metaTools.getIntegrationActionsText(gmailAccount.id, "send an email with gmail");
const selected = JSON.parse(selText);
check("mock-LLM selection returns ≤3 schemas", Array.isArray(selected) && selected.length >= 1 && selected.length <= 3, selText.slice(0, 200));
check("selection includes gmail_send_email with its full schema", selected.some((t) => t.name === "gmail_send_email" && t.inputSchema?.properties?.to && t.description));

// Cap leg: an injected selector returning 5 valid names is capped to 3, order kept.
setActionSelectLlmForTests(async () => [
  "gmail_search_emails",
  "gmail_read_email",
  "gmail_send_email",
  "gmail_draft_email",
  "gmail_list_email_labels",
]);
const capped = JSON.parse(await metaTools.getIntegrationActionsText(gmailAccount.id, "anything"));
check("selection hard-capped at 3, LLM order preserved", capped.length === 3 && capped[0].name === "gmail_search_emails" && capped[2].name === "gmail_send_email", capped.map((t) => t.name));
setActionSelectLlmForTests(null);

// Parse failure → ALL tools + loud console.warn (never silently narrow).
warns.length = 0;
const allText = await metaTools.getIntegrationActionsText(gmailAccount.id, "MOCK_SELECT_FAIL whatever");
const allTools = JSON.parse(allText);
check("parse failure → ALL tools returned", Array.isArray(allTools) && allTools.length === 20, allTools.length);
check("parse failure warns LOUDLY", warns.some((w) => /failed to parse|returning ALL/.test(w)), warns);

// Provider failure → LOUD error, NOT an all-tools fallback.
setActionSelectLlmForTests(async () => {
  throw new Error("fetch failed: connect ECONNREFUSED 127.0.0.1:11434");
});
let providerErr = null;
try {
  await metaTools.getIntegrationActionsText(gmailAccount.id, "send an email");
} catch (err) {
  providerErr = err;
}
check("provider error fails LOUD (502, names the provider failure)", providerErr?.status === 502 && /provider call failed/.test(String(providerErr?.message)) && /ECONNREFUSED/.test(String(providerErr?.message)), String(providerErr?.message));
// ...and through the MCP surface it lands as an isError result, never a schema list.
const provRes = await metaTools.callIntegrationMetaTool(
  "get_integration_actions",
  { accountId: gmailAccount.id, query: "send an email" },
  { source: "smoke", strict: true },
);
check("provider error surfaces isError through the MCP dispatcher", provRes.isError === true && /provider call failed/.test(provRes.content[0].text));
setActionSelectLlmForTests(null);

// settings-off → keyword fallback (no LLM), ≤3.
writeSettings({ webmcp: { ...(readSettings().webmcp ?? {}), llmGetActions: false } });
setActionSelectLlmForTests(async () => {
  throw new Error("LLM MUST NOT BE CALLED when llmGetActions is off");
});
const kwTools = JSON.parse(await metaTools.getIntegrationActionsText(gmailAccount.id, "search emails"));
check("settings-off → keyword fallback (LLM untouched), ≤3 with the obvious hit", kwTools.length <= 3 && kwTools.some((t) => t.name === "gmail_search_emails"), kwTools.map?.((t) => t.name));
setActionSelectLlmForTests(null);
writeSettings({ webmcp: { ...(readSettings().webmcp ?? {}), llmGetActions: true } });

// Slug instead of UUID → the contract error from the verbatim description.
let slugErr = null;
try {
  await metaTools.getIntegrationActionsText("gmail", "send an email with gmail");
} catch (err) {
  slugErr = err;
}
check("passing the slug instead of the UUID → loud 404 naming the contract", slugErr?.status === 404 && /not the slug/.test(String(slugErr?.message)));

// ---------------------------------------------------------------------------
// D. execute_integration_action — non-destructive round trip + source tag
// ---------------------------------------------------------------------------
const mcpCtx = { source: "smoke-mcp", strict: true };
const echoRes = await handleMcpMessage(
  {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "execute_integration_action",
      arguments: { accountId: fixtureAccount.id, action: "_test_echo", parameters: { text: "meta-trip" } },
    },
  },
  mcpCtx,
);
const echoText = echoRes.result.content[0].text;
check("non-destructive execute round trip (verbatim tool name)", !echoRes.result.isError && JSON.parse(echoText).tool === "_test_echo" && JSON.parse(echoText).echoed === "meta-trip", echoText);
{
  const log = store.listCallLogs(fixtureAccount.id).find((l) => l.toolName === "_test_echo");
  check("call log row written with the ?source= tag (G4.2)", log?.ok === true && log.source === "smoke-mcp", log);
}

// Same action through the F4 registry's execute_action (registry lane).
const regEcho = await handleMcpMessage(
  {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "execute_action",
      arguments: {
        key: "execute_integration_action",
        args: { accountId: fixtureAccount.id, action: "_test_echo", parameters: { text: "via-registry" } },
      },
    },
  },
  { source: "smoke-reg", strict: true },
);
check("execute_action('execute_integration_action') works through the registry", !regEcho.result.isError && regEcho.result.content[0].text.includes("via-registry"));
check("registry-path call logged with its own source tag", store.listCallLogs(fixtureAccount.id).some((l) => l.source === "smoke-reg" && l.ok));

// Soft connector failure stays a soft error result.
const failRes = await metaTools.callIntegrationMetaTool(
  "execute_integration_action",
  { accountId: fixtureAccount.id, action: "_test_fail" },
  mcpCtx,
);
check("soft API failure → isError result with the Error: text", failRes.isError === true && failRes.content[0].text.startsWith("Error:"));
// Unknown action → loud message + verbatim-name hint (attempt audited).
const nopeRes = await metaTools.callIntegrationMetaTool(
  "execute_integration_action",
  { accountId: fixtureAccount.id, action: "_test_nope" },
  mcpCtx,
);
check("unknown action → error naming the verbatim-name contract", nopeRes.isError === true && /unknown tool/i.test(nopeRes.content[0].text) && /verbatim/.test(nopeRes.content[0].text));

// ---------------------------------------------------------------------------
// E. F4 registry + /api/mcp surfaces
// ---------------------------------------------------------------------------
check("the three meta-actions are registered in the F4 registry", ["get_integrations", "get_integration_actions", "execute_integration_action"].every((k) => !!registry.getAction(k)));
check("searchActions finds get_integrations by intent", registry.searchActions("list connected integrations").some((a) => a.key === "get_integrations"));
check("searchActions finds execute_integration_action by intent", registry.searchActions("execute an integration action").some((a) => a.key === "execute_integration_action"));

const toolsList = await handleMcpMessage({ jsonrpc: "2.0", id: 3, method: "tools/list" }, mcpCtx);
const advertised = toolsList.result.tools.map((t) => t.name);
check("tools/list advertises the three meta-tools", ["get_integrations", "get_integration_actions", "execute_integration_action"].every((n) => advertised.includes(n)), advertised);
{
  const def = toolsList.result.tools.find((t) => t.name === "get_integration_actions");
  check("AOC-verbatim accountId-not-slug warning in the advertised schema", /Do NOT pass the integration slug/.test(def.inputSchema.properties.accountId.description));
  const exec = toolsList.result.tools.find((t) => t.name === "execute_integration_action");
  check("execute_integration_action advertises destructiveHint (AOC annotations)", exec.annotations.destructiveHint === true);
}

const e2e = await handleMcpMessage(
  { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_integrations", arguments: {} } },
  mcpCtx,
);
check("tools/call get_integrations E2E through handleMcpMessage", !e2e.result.isError && e2e.result.content[0].text.includes(`accountId: ${gmailAccount.id}`));

// ---------------------------------------------------------------------------
// F. Destructive + interactive (jarvis) → Human-Gate pending; approve executes
// ---------------------------------------------------------------------------
const events = [];
const turnState = jarvisTools.newTurnState();
const handlers = jarvisTools.buildJarvisToolHandlers({ emit: (ev) => events.push(ev), state: turnState });

const sendArgs = { accountId: gmailAccount.id, action: "gmail_send_email", parameters: { to: ["a@b.example"], subject: "Meta smoke", body: "Hello from the gate" } };
const gateRes = await handlers.execute_action.run({ key: "execute_integration_action", args: sendArgs });
check("interactive destructive invoke does NOT execute", gateRes.isError === true && sendCalls === 0);
const apprEv = events.find((e) => e.type === "approval");
check("'approval' stream event emitted for the overlay card", !!apprEv && apprEv.tool === "execute_integration_action" && apprEv.slug === "registry");
check("model-facing text names the approval id + no-retry", gateRes.content[0].text.includes(apprEv?.id ?? "@@") && /Do NOT retry/i.test(gateRes.content[0].text));

const pending = approvals.getApproval(apprEv.id);
check("pending Human-Gate record (registry lane) with raw args kept", pending?.status === "pending" && pending.slug === "registry" && pending.tool === "execute_integration_action" && pending.args.action === "gmail_send_email" && pending.args.parameters.subject === "Meta smoke");
check("no gmail_send_email call log before approval", !store.listCallLogs(gmailAccount.id).some((l) => l.toolName === "gmail_send_email"));

const approved = await approvals.resolveApproval(apprEv.id, "approve");
check("approve EXECUTES via the mocked gmail transport", approved.result?.ok === true && sendCalls === 1 && approved.result.output.includes("sent-99"), approved.result);
check("record approved with the result stored", approvals.getApproval(apprEv.id).status === "approved");
{
  const log = store.listCallLogs(gmailAccount.id).find((l) => l.toolName === "gmail_send_email");
  check("approved execution call-logged under source 'human-gate'", log?.ok === true && log.source === "human-gate", log);
}

// ---------------------------------------------------------------------------
// G. Deny → NO execution (call-log absence is the proof)
// ---------------------------------------------------------------------------
const gateRes2 = await handlers.execute_action.run({ key: "execute_integration_action", args: sendArgs });
const apprEv2 = events.filter((e) => e.type === "approval").at(-1);
check("second destructive invoke → a NEW pending record", apprEv2 && apprEv2.id !== apprEv.id && gateRes2.isError === true);
const denied = await approvals.resolveApproval(apprEv2.id, "deny");
check("deny resolves without execution", denied.approval.status === "denied" && denied.result === null && sendCalls === 1);
check("deny leaves the call log untouched", store.listCallLogs(gmailAccount.id).filter((l) => l.toolName === "gmail_send_email").length === 1);

// ---------------------------------------------------------------------------
// H. Strict / non-interactive → HARD REFUSE, no record
// ---------------------------------------------------------------------------
const countBefore = approvals.listApprovals({ limit: 200 }).length;
const strictRes = await handleMcpMessage(
  {
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "execute_integration_action", arguments: sendArgs },
  },
  { source: "smoke-strict", strict: true },
);
check("strict destructive call → hard refuse naming approval", strictRes.result.isError === true && /requires human approval/.test(strictRes.result.content[0].text) && /refused/.test(strictRes.result.content[0].text));
const strictReg = await handleMcpMessage(
  {
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: { name: "execute_action", arguments: { key: "execute_integration_action", args: sendArgs } },
  },
  { source: "smoke-strict", strict: true },
);
check("strict registry-path destructive call → hard refuse too", strictReg.result.isError === true && /requires human approval/.test(strictReg.result.content[0].text));
check("strict refusals created NO approval records and sent NOTHING", approvals.listApprovals({ limit: 200 }).length === countBefore && sendCalls === 1);

// ---------------------------------------------------------------------------
// I. §9.4 taint — the brain's gate refuses BEFORE the meta handler runs
// ---------------------------------------------------------------------------
const taintEvents = [];
const taintedState = jarvisTools.newTurnState();
taintedState.integrationTainted = true;
const taintedHandlers = jarvisTools.buildJarvisToolHandlers({ emit: (ev) => taintEvents.push(ev), state: taintedState });
const taintRes = await taintedHandlers.execute_action.run({ key: "execute_integration_action", args: sendArgs });
check("tainted session → §9.4 refusal (no approval path)", taintRes.isError === true && /§9\.4|CONVENTIONS/.test(taintRes.content[0].text));
check("taint refusal created NO record, emitted NO approval event, sent NOTHING", approvals.listApprovals({ limit: 200 }).length === countBefore && !taintEvents.some((e) => e.type === "approval") && sendCalls === 1);

// ---------------------------------------------------------------------------
googleClient.__setGoogleMockForTests(null);
console.warn = realWarn;
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
console.log(failures === 0 ? "\nsmoke-int-metatools: ALL PASS" : `\nsmoke-int-metatools: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
