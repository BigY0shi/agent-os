// Phase-4 chunk 2 smoke: D1.5 LLM-filtered getActions.
//   mock-LLM selects a subset (dependency-preserving order);
//   parse-fail → ALL tools + LOUD console.error (never silently narrow);
//   settings.webmcp.llmGetActions=false → keyword scorer;
//   the brain's get_actions routes through the SAME shared selector.
// Run: npx tsx scripts/v2/smoke-getactions.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const stamp = Date.now();
process.env.AGENTIC_OS_DB = path.join(os.tmpdir(), `agentos-smoke-getactions-${stamp}.db`);
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-ga-set-"));
const settingsFile = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_SETTINGS = settingsFile;
process.env.AGENTIC_OS_WEBMCP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-ga-sec-"));
process.env.AGENTOS_MOCK_LLM = "1";

const store = await import("../../src/lib/v2/webmcp/store.ts");
const hub = await import("../../src/lib/v2/webmcp/hub.ts");
const sel = await import("../../src/lib/v2/webmcp/actionSelection.ts");
const tools = await import("../../src/lib/v2/jarvis/tools.ts");
const { writeSettings, readSettings } = await import("../../src/lib/settings.ts");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : extra !== undefined ? `  [${JSON.stringify(extra).slice(0, 300)}]` : ""}`);
  if (!cond) failures++;
};

// Two published packages.
store.createPackage({ slug: "alpha", name: "Alpha" });
for (const [name, desc] of [
  ["send_message", "Send a chat message to a channel"],
  ["list_messages", "List recent chat messages"],
]) {
  store.addTool("alpha", {
    name, description: desc,
    inputSchema: { type: "object", properties: { text: { type: "string" } } },
    handlerKind: "js", handlerConfig: { code: "return 'ok';" },
  });
}
store.publishPackage("alpha");
store.createPackage({ slug: "beta", name: "Beta" });
store.addTool("beta", {
  name: "fetch_weather", description: "Fetch the weather forecast",
  inputSchema: { type: "object", properties: {} },
  handlerKind: "js", handlerConfig: { code: "return 'sunny';" },
});
store.publishPackage("beta");

// ---------------------------------------------------------------------------
// A. Mock-LLM subset selection (default: llmGetActions ON)
// ---------------------------------------------------------------------------
const subset = await hub.getActions("all", "send a message to the channel");
check("mock-LLM selects the relevant subset", subset.length === 1 && subset[0].name === "send_message", subset.map((t) => t.name));

const errors = [];
const origError = console.error;
console.error = (...a) => errors.push(a.map(String).join(" "));

// B. Parse-fail / LLM error → ALL tools + loud console.error.
const allTools = await hub.getActions("all", "MOCK_SELECT_FAIL do something");
console.error = origError;
check("LLM failure returns ALL tools (never silently narrow)", allTools.length === 3, allTools.map((t) => t.name));
check("LLM failure logs LOUDLY via console.error", errors.some((e) => e.includes("returning ALL tools")), errors);

// C. Custom injectable seam (setActionSelectLlmForTests) — dependency ordering kept.
sel.setActionSelectLlmForTests(async () => ["list_messages", "send_message", "hallucinated_tool"]);
const ordered = await hub.getActions("all", "whatever");
check("selector order preserved + hallucinated names dropped", ordered.map((t) => t.name).join(",") === "list_messages,send_message");
sel.setActionSelectLlmForTests(null);

// D. Settings toggle OFF → keyword scorer fallback.
writeSettings({ ...readSettings(), webmcp: { ...(readSettings().webmcp ?? {}), llmGetActions: false } });
check("gate reads OFF", sel.llmGetActionsEnabled() === false);
const kw = await hub.getActions("all", "weather forecast");
check("toggle off → keyword scorer picks fetch_weather", kw[0]?.name === "fetch_weather", kw.map((t) => t.name));
sel.setActionSelectLlmForTests(async () => { throw new Error("MUST NOT BE CALLED when gate is off"); });
const kwStill = await hub.getActions("all", "weather forecast");
check("toggle off never touches the LLM", kwStill[0]?.name === "fetch_weather");
sel.setActionSelectLlmForTests(null);
writeSettings({ ...readSettings(), webmcp: { ...(readSettings().webmcp ?? {}), llmGetActions: true } });

// E. No intent → all tools, no LLM call.
sel.setActionSelectLlmForTests(async () => { throw new Error("MUST NOT BE CALLED without intent"); });
const noIntent = await hub.getActions("all");
check("no intent → all tools without any LLM call", noIntent.length === 3);
sel.setActionSelectLlmForTests(null);

// ---------------------------------------------------------------------------
// F. The brain's get_actions routes through the SAME selector (registry superset)
// ---------------------------------------------------------------------------
const state = tools.newTurnState();
const handlers = tools.buildJarvisToolHandlers({ emit: () => {}, state });
let captured = null;
sel.setActionSelectLlmForTests(async (query, candidates) => {
  captured = { query, names: candidates.map((c) => c.name) };
  return ["alpha/send_message"];
});
const ga = await handlers.get_actions.run({ intent: "send a message" });
check("get_actions used the shared selector", captured?.query === "send a message");
check("selector saw the registry superset (hub keys + core actions)", captured.names.includes("alpha/send_message") && captured.names.includes("exec_command"));
check("get_actions renders exactly the selected action", ga.isError !== true && ga.content[0].text.includes("alpha/send_message") && !ga.content[0].text.includes("fetch_weather"));

// Selector failure → keyword fallback inside get_actions (loud log already covered).
sel.setActionSelectLlmForTests(async () => { throw new Error("boom"); });
const gaFallback = await handlers.get_actions.run({ intent: "send_message" });
check("get_actions LLM failure falls back to keyword scorer", gaFallback.isError !== true && gaFallback.content[0].text.includes("send_message"));
sel.setActionSelectLlmForTests(null);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
