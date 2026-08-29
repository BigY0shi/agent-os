// F4 smoke: full JSON-RPC round trip through handleMcpMessage + registry +
// strict-gate behavior + schema round-trip (CONVENTIONS §10 zod assert).
// Run: npx tsx scripts/v2/smoke-mcp.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmp = path.join(os.tmpdir(), `agentos-smoke-f4-${Date.now()}.db`);
process.env.AGENTIC_OS_DB = tmp;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-f4-"));
process.env.AGENTIC_OS_SETTINGS = path.join(settingsDir, "settings.json");

const { handleMcpMessage } = await import("../../src/lib/v2/mcp/server.ts");
const { writeSettings } = await import("../../src/lib/settings.ts");
const { recent } = await import("../../src/lib/v2/events.ts");

let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
};

const ctx = { source: "smoke", strict: true, remoteAddr: "127.0.0.1" };
const call = (method, params, id = 1) => handleMcpMessage({ jsonrpc: "2.0", id, method, params }, ctx);

// initialize
const init = await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } });
check("initialize returns protocolVersion", init.result?.protocolVersion === "2025-06-18");
check("initialize advertises tools capability", !!init.result?.capabilities?.tools);

// notification → null (202)
const note = await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, ctx);
check("notification returns null", note === null);

// tools/list
const list = await call("tools/list", {});
const toolNames = list.result?.tools?.map((t) => t.name) ?? [];
check("tools/list has get_actions + execute_action", toolNames.includes("get_actions") && toolNames.includes("execute_action"));
check("memory tools present (not-ready)", toolNames.includes("memory_search") && toolNames.includes("memory_ingest"));

// get_actions discovery + schema round-trip
const ga = await call("tools/call", { name: "get_actions", arguments: { intent: "run a shell command" } });
const gaText = ga.result?.content?.[0]?.text ?? "";
check("get_actions finds exec_command first", JSON.parse(gaText)[0]?.key === "exec_command");
const schema = JSON.parse(gaText)[0]?.inputSchema;
check("inputSchema round-trips to JSON Schema (zod4 assert)", schema?.type === "object" && !!schema?.properties?.command);

// execute_action: strict gate = deny-all exec with empty allowlist
writeSettings({ capability: { folders: [], execAllow: [], execDeny: [], browserEnabled: false } });
const denied = await call("tools/call", { name: "execute_action", arguments: { key: "exec_command", args: { command: "node -v" } } });
check("strict exec denied with empty allowlist", denied.result?.isError === true && denied.result.content[0].text.includes("deny-all"));

// opt the command in → allowed
writeSettings({ capability: { folders: [], execAllow: ["Bash(node *)"], execDeny: [], browserEnabled: false } });
const allowed = await call("tools/call", { name: "execute_action", arguments: { key: "exec_command", args: { command: "node -v" } } });
check("opted-in exec runs through full MCP round trip", allowed.result?.isError !== true && allowed.result?.content?.[0]?.text?.trim().startsWith("v"));

// audit event logged with source + remote addr
const audits = recent({ type: "mcp.execute" });
check("mcp.execute audited with source+addr", audits.length >= 2 && audits[0].payload.source === "smoke" && audits[0].payload.remoteAddr === "127.0.0.1");

// invalid args rejected by schema
const badArgs = await call("tools/call", { name: "execute_action", arguments: { key: "exec_command", args: {} } });
check("schema validation rejects missing command", badArgs.result?.isError === true);

// unknown key + unknown tool + unknown method
const unknownKey = await call("tools/call", { name: "execute_action", arguments: { key: "nope" } });
check("unknown action key isError", unknownKey.result?.isError === true);
const unknownTool = await call("tools/call", { name: "wat", arguments: {} });
check("unknown tool -> -32602", unknownTool.error?.code === -32602);
const unknownMethod = await call("resources/list", {});
check("unknown method -> -32601", unknownMethod.error?.code === -32601);

// memory tools fail loudly (not silently)
const mem = await call("tools/call", { name: "memory_search", arguments: { intent: "x" } });
check("memory_search fails loudly (NOT_READY)", mem.result?.isError === true && mem.result.content[0].text.includes("not yet available"));

// files action through MCP respects strict folder deny
const fdeny = await call("tools/call", { name: "execute_action", arguments: { key: "read_file", args: { path: "C:/anything.txt" } } });
check("strict files denied with zero folders", fdeny.result?.isError === true);

const { __closeForTests } = await import("../../src/lib/v2/db.ts");
__closeForTests();
try { fs.rmSync(tmp, { force: true }); fs.rmSync(tmp + "-wal", { force: true }); fs.rmSync(tmp + "-shm", { force: true }); fs.rmSync(settingsDir, { recursive: true, force: true }); } catch {}

console.log(failures === 0 ? "\nsmoke-mcp: ALL PASS" : `\nsmoke-mcp: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
