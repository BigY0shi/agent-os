// SPEC-D G2.2 smoke: registry + runtime over the `_test` fixture connector —
// verbatim tool-name pass-through, timezone injection from
// settings.tasks.timezone, redacted call-log rows, soft (isError) vs loud
// (ConnectorConfigError) error split, setup 422 path. No server, no network.
// Run: npx tsx scripts/v2/smoke-int-runtime.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const stamp = Date.now();
const tmpDb = path.join(os.tmpdir(), `agentos-smoke-intrt-${stamp}.db`);
process.env.AGENTIC_OS_DB = tmpDb;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-intrt-"));
const settingsFile = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_SETTINGS = settingsFile;
process.env.AGENTIC_OS_KEY = path.join(settingsDir, "agentos.key");
fs.writeFileSync(
  settingsFile,
  JSON.stringify({ tasks: { timezone: "America/Chicago" }, memory: { ingestEnabled: false } }),
);

const { ensureDb, __closeForTests } = await import("../../src/lib/v2/db.ts");
const registry = await import("../../src/lib/v2/integrations/registry.ts");
const runtime = await import("../../src/lib/v2/integrations/runtime.ts");
const store = await import("../../src/lib/v2/integrations/store.ts");
const { ConnectorConfigError } = await import("../../src/lib/v2/integrations/types.ts");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  if (!cond) failures++;
};

ensureDb();

// ---------------------------------------------------------------------------
// A. Registry
// ---------------------------------------------------------------------------
check("getConnector('_test') resolves", !!registry.getConnector("_test"));
check("default list HIDES '_'-prefixed fixtures", registry.listConnectors().every((c) => !c.spec.slug.startsWith("_")));
check("includeHidden surfaces the fixture", registry.listConnectors({ includeHidden: true }).some((c) => c.spec.slug === "_test"));
const tools = runtime.getTools("_test");
check("getTools returns slug-prefixed names", tools.length === 2 && tools.every((t) => t.name.startsWith("_test")));

// ---------------------------------------------------------------------------
// B. Setup: ok + connector-rejection 422 path
// ---------------------------------------------------------------------------
const account = await runtime.setupAccount("_test", { fields: { token: "tok-1" } });
check("setupAccount upserts an account", account.accountId === "fixture-tok-1" && account.isActive);
let err422 = null;
try {
  await runtime.setupAccount("_test", { fields: { token: "bad-token" } });
} catch (err) {
  err422 = err;
}
check("connector rejection → IntegrationError 422 with connector text", err422?.status === 422 && String(err422?.message).includes("invalid token"));
let err400 = null;
try {
  await runtime.setupAccount("_test", { fields: {} });
} catch (err) {
  err400 = err;
}
check("missing required field → ConnectorConfigError (loud 400)", err400 instanceof ConnectorConfigError);

// ---------------------------------------------------------------------------
// C. callTool: verbatim name + timezone injection + call log
// ---------------------------------------------------------------------------
const echo = await runtime.callTool(account.id, "_test_echo", { text: "roundtrip", apiToken: "SEKRET-1" }, { source: "smoke" });
const parsed = JSON.parse(echo.text);
check("advertised tool name reached the connector UNCHANGED", parsed.tool === "_test_echo");
check("echo carries the args", parsed.echoed === "roundtrip");
check("timezone injected from settings.tasks.timezone", parsed.timezone === "America/Chicago");
check("account config decrypted into ctx", parsed.hasToken === true);

let logs = store.listCallLogs(account.id);
check("call log row written (ok)", logs.length === 1 && logs[0].ok === true && logs[0].toolName === "_test_echo" && logs[0].source === "smoke");
check("call log args redacted (sensitive key masked, benign kept)", logs[0].args.apiToken === "[redacted]" && logs[0].args.text === "roundtrip");
check("secret VALUE nowhere in the log row", !JSON.stringify(logs[0]).includes("SEKRET-1"));
check("durationMs recorded", typeof logs[0].durationMs === "number");

// value-equality masking: pass the account token itself as a benign-named arg
const echo2 = await runtime.callTool(account.id, "_test_echo", { text: "tok-1" }, { source: "smoke" });
logs = store.listCallLogs(account.id);
check(
  "arg VALUE equal to a decrypted secret is masked",
  logs.filter((l) => l.toolName === "_test_echo").some((l) => l.args.text === "[redacted]") &&
    JSON.parse(echo2.text).echoed === "tok-1",
);

// ---------------------------------------------------------------------------
// D. Soft vs loud errors
// ---------------------------------------------------------------------------
const soft = await runtime.callTool(account.id, "_test_fail", {}, { source: "smoke" });
check("thrown API error → SOFT {isError:true, 'Error: ...'}", soft.isError === true && soft.text.startsWith("Error:") && soft.text.includes("exploded"));
logs = store.listCallLogs(account.id);
const softLog = logs.find((l) => l.toolName === "_test_fail");
check("soft failure logged ok=0 with error", softLog?.ok === false && softLog.error.includes("exploded"));

let loud = null;
try {
  await runtime.callTool(account.id, "_test_nope", {}, { source: "smoke" });
} catch (err) {
  loud = err;
}
check("unknown tool → LOUD ConnectorConfigError throw", loud instanceof ConnectorConfigError);
logs = store.listCallLogs(account.id);
// find (not [0]): same-millisecond created_at makes DESC ordering unstable.
const loudLog = logs.find((l) => l.toolName === "_test_nope");
check("loud failure ALSO logged", !!loudLog && loudLog.ok === false);

let notFound = null;
try {
  await runtime.callTool("no-such-account", "_test_echo", {}, {});
} catch (err) {
  notFound = err;
}
check("unknown account → loud 404", notFound?.status === 404);

store.setAccountActive(account.id, false);
let inactive = null;
try {
  await runtime.callTool(account.id, "_test_echo", {}, {});
} catch (err) {
  inactive = err;
}
check("disconnected account → loud 409", inactive?.status === 409);
store.setAccountActive(account.id, true);

// ---------------------------------------------------------------------------
__closeForTests();
for (const f of [tmpDb, tmpDb + "-wal", tmpDb + "-shm"]) {
  try { fs.rmSync(f, { force: true }); } catch {}
}
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
