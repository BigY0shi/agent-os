// S16 Jarvis MCP tab smoke (_design/jarvis-v3-plan.md), offline.
//   A. store: validation, servers start OFF, duplicates refused, reserved name refused
//   B. secrets: the public view and every route response carry names only; only
//      sdkServers() (brain only) holds values, and only for ENABLED servers
//   C. lifecycle: enable changes the brain signature; retire keeps the record; restore
//      comes back switched off
//   D. taint wiring in brain.ts: external tools denied on a tainted turn, and any
//      external tool result taints the turn
//   E. route + UI: Claude Code servers masked (headers and URL query); the tab is
//      registered; the built-in tool list matches tools.ts
// Home, the Jarvis dir and ~/.claude.json are all redirected to a temp dir first, so no
// real Hermes, Claude Code or Jarvis config is read.
// Run: npx tsx scripts/v2/smoke-jarvis-mcp.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-jmcp-"));
process.env.HOME = tmp;
process.env.USERPROFILE = tmp;
process.env.AGENTIC_OS_JARVIS_DIR = path.join(tmp, "jarvis");
process.env.AGENTIC_OS_SETTINGS = path.join(tmp, "settings.json");
process.env.AGENTIC_OS_DB = path.join(tmp, "test.db");
process.env.AGENTIC_OS_AGENTMAIL_DIR = path.join(tmp, "agentmail");
process.env.AGENTIC_OS_NEWSLETTER_DIR = path.join(tmp, "newsletter");
process.env.CLAUDE_JSON_PATH = path.join(tmp, "claude.json");
fs.writeFileSync(process.env.CLAUDE_JSON_PATH, JSON.stringify({
  mcpServers: {
    "agent-os": { type: "http", url: "http://127.0.0.1:3737/api/mcp", headers: { "x-agentos-mcp-secret": "CC_HEADER_SECRET" } },
    tool: { type: "http", url: "https://example.invalid/mcp?token=CC_QUERY_SECRET" },
    local: { command: "npx", args: ["x"], env: { API_KEY: "CC_ENV_SECRET" } },
  },
}), "utf8");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || extra === undefined ? "" : `  [${String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 260)}]`}`);
  if (!cond) failures++;
};
const throwsWith = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(String(e?.message ?? e)); } };
const read = (f) => fs.readFileSync(f, "utf8");
const SECRETS = ["JARVIS_HEADER_SECRET", "JARVIS_ENV_SECRET", "CC_HEADER_SECRET", "CC_QUERY_SECRET", "CC_ENV_SECRET"];
const leaks = (s) => SECRETS.filter((x) => s.includes(x));

const m = await import("../../src/lib/v2/jarvis/mcpServers.ts");

// ── A. store ──────────────────────────────────────────────────────────────────
check("A1 empty store lists nothing", m.listServers().length === 0 && m.listRetired().length === 0);
const web = m.addServer({ name: "web-tools", transport: "http", url: "https://mcp.example.invalid/v1", headers: { Authorization: "Bearer JARVIS_HEADER_SECRET" }, description: "search" });
check("A2 http server added switched OFF", web.enabled === false && web.transport === "http");
const loc = m.addServer({ name: "files", transport: "stdio", command: "npx", args: ["-y", "some-server"], env: { FILES_TOKEN: "JARVIS_ENV_SECRET" } });
check("A3 stdio server added switched OFF", loc.enabled === false && loc.args.length === 2);
check("A4 enabled:true on add is honoured only when literally true", m.addServer({ name: "x-on", transport: "http", url: "http://127.0.0.1:1/", enabled: "yes" }).enabled === false);
check("A5 bad name refused", throwsWith(() => m.addServer({ name: "Bad Name", transport: "http", url: "https://a.b" }), /lowercase/));
check("A6 reserved agentos refused", throwsWith(() => m.addServer({ name: "agentos", transport: "http", url: "https://a.b" }), /built-in/));
check("A7 non-http url refused", throwsWith(() => m.addServer({ name: "ftp-one", transport: "http", url: "ftp://a.b" }), /http/));
check("A8 shell line refused as a command", throwsWith(() => m.addServer({ name: "sh-one", transport: "stdio", command: "npx x && curl evil" }), /program/));
check("A9 unknown transport refused", throwsWith(() => m.addServer({ name: "ws-one", transport: "ws", url: "https://a.b" }), /transport/));
check("A10 duplicate refused with 409", (() => { try { m.addServer({ name: "files", transport: "stdio", command: "npx" }); return false; } catch (e) { return e.status === 409; } })());
check("A11 bad header name refused", throwsWith(() => m.addServer({ name: "hdr-one", transport: "http", url: "https://a.b", headers: { "bad header": "v" } }), /header/));

// ── B. secrets ────────────────────────────────────────────────────────────────
const pub = JSON.stringify([m.listServers(), m.listRetired()]);
check("B1 public view carries no secret values", leaks(pub).length === 0, leaks(pub));
check("B2 public view carries the secret NAMES", pub.includes("Authorization") && pub.includes("FILES_TOKEN"));
check("B3 nothing enabled -> sdkServers is empty", Object.keys(m.sdkServers()).length === 0);
check("B4 values are on disk for the brain", read(path.join(process.env.AGENTIC_OS_JARVIS_DIR, "mcp-servers.json")).includes("JARVIS_HEADER_SECRET"));

// ── C. lifecycle ──────────────────────────────────────────────────────────────
const sig0 = m.externalSignature();
m.setEnabled("web-tools", true);
const sdk = m.sdkServers();
check("C1 enabled server reaches the brain with its header", sdk["web-tools"]?.type === "http" && sdk["web-tools"].headers?.Authorization === "Bearer JARVIS_HEADER_SECRET");
check("C2 disabled servers stay out of the brain", !sdk.files && !sdk["x-on"]);
const sig1 = m.externalSignature();
check("C3 enabling changes the signature", sig0 !== sig1);
check("C4 signature never contains a secret", leaks(sig1).length === 0);
m.retireServer("web-tools");
check("C5 retired server leaves the brain and the list", !m.sdkServers()["web-tools"] && !m.listServers().some((s) => s.name === "web-tools"));
check("C6 retired record is kept", m.listRetired().some((s) => s.name === "web-tools" && s.enabled === false));
check("C7 retiring again is a 404", (() => { try { m.retireServer("web-tools"); return false; } catch (e) { return e.status === 404; } })());
const back = m.restoreServer("web-tools");
check("C8 restore comes back switched OFF", back.enabled === false && m.listServers().some((s) => s.name === "web-tools" && !s.enabled));
check("C9 restore removes it from retired", !m.listRetired().some((s) => s.name === "web-tools"));
check("C10 signature back to the no-enabled value", m.externalSignature() === sig0);

// isExternalMcpTool
check("C11 mcp__web-tools__search is external", m.isExternalMcpTool("mcp__web-tools__search"));
check("C12 mcp__agentos__navigate is built-in", !m.isExternalMcpTool("mcp__agentos__navigate"));
check("C13 a plain tool name is not external", !m.isExternalMcpTool("Read") && !m.isExternalMcpTool("mcp_x"));

// corrupt store fails loudly
const storeFile = path.join(process.env.AGENTIC_OS_JARVIS_DIR, "mcp-servers.json");
const good = read(storeFile);
fs.writeFileSync(storeFile, "{not json", "utf8");
check("C14 corrupt store throws a 500, not an empty list", (() => { try { m.listServers(); return false; } catch (e) { return e.status === 500; } })());
fs.writeFileSync(storeFile, good, "utf8");

// ── D. brain wiring ───────────────────────────────────────────────────────────
const brain = read("src/lib/v2/jarvis/brain.ts");
check("D1 brain mounts enabled external servers next to agentos", /mcpServers: \{ agentos: server, \.\.\.external \}/.test(brain));
check("D2 brain allows only the enabled servers' tools", brain.includes("...Object.keys(external).map((n) => `mcp__${n}`)"));
check("D3 PreToolUse denies external tools on a tainted turn", /isExternalMcpTool\(name\) && toolState\.integrationTainted[\s\S]{0,200}permissionDecision: "deny"/.test(brain));
check("D4 PostToolUse taints the turn after any external tool", brain.includes("if (isExternalMcpTool(name)) toolState.integrationTainted = true;"));
const tools = read("src/lib/v2/jarvis/tools.ts");
check("D5 tool signature includes the external signature", tools.includes("externalSignature"));

// ── E. route + UI ─────────────────────────────────────────────────────────────
const route = await import("../../src/app/api/v2/jarvis/mcp/route.ts");
const res = await route.GET(new Request("http://x/api/v2/jarvis/mcp"));
const bodyText = await res.text();
const body = JSON.parse(bodyText);
check("E1 GET overview answers 200", res.status === 200, bodyText);
check("E2 GET carries no secret from Jarvis or Claude Code", leaks(bodyText).length === 0, leaks(bodyText));
check("E3 Claude Code servers listed with names only", body.claudeCode?.length === 3 && body.claudeCode.find((s) => s.name === "local")?.envNames?.[0] === "API_KEY");
check("E4 Claude Code URL query stripped", body.claudeCode.find((s) => s.name === "tool")?.url === "https://example.invalid/mcp");
check("E5 Hermes reads the temp home (nothing installed, no error)", Array.isArray(body.hermes) && body.hermes.length === 0, body.hermesError);
const post = (b) => route.POST(new Request("http://x", { method: "POST", body: JSON.stringify(b) }));
const add = await post({ action: "add", name: "via-route", transport: "http", url: "https://r.invalid/", headers: { "X-Key": "JARVIS_HEADER_SECRET" } });
const addText = await add.text();
check("E6 POST add is 201 and echoes no secret", add.status === 201 && leaks(addText).length === 0, addText);
const en = await post({ action: "enable", name: "via-route" });
check("E7 POST enable switches it on", en.status === 200 && (await en.json()).server.enabled === true);
check("E8 POST unknown action is 400", (await post({ action: "nuke", name: "via-route" })).status === 400);
check("E9 POST enable of a missing server is 404", (await post({ action: "enable", name: "nope" })).status === 404);
check("E10 manifest name is validated", (await route.GET(new Request("http://x/api/v2/jarvis/mcp?manifest=../etc"))).status === 400);
check("E11 route exports only handlers and config", Object.keys(route).every((k) => ["GET", "POST", "runtime", "dynamic"].includes(k)), Object.keys(route));

// built-in tool list in the route matches the handlers in tools.ts
const handlerBlock = tools.slice(tools.indexOf("export function buildJarvisToolHandlers"), tools.indexOf("export function buildJarvisSdkServer"));
const handlerNames = [...handlerBlock.matchAll(/^ {4}([a-z_]+): \{$/gm)].map((x) => x[1]).sort();
const routeSrc = read("src/app/api/v2/jarvis/mcp/route.ts");
const listed = JSON.parse(/const BUILTIN_TOOLS = (\[[^\]]+\])/.exec(routeSrc)[1]).sort();
check("E12 built-in list matches tools.ts handlers", handlerNames.length > 0 && JSON.stringify(handlerNames) === JSON.stringify(listed), { handlerNames, listed });

const hub = read("src/components/jarvis/JarvisHub.tsx");
check("E13 MCP tab registered", /key: "mcp", label: "MCP"[^\n]*<McpTab \/>/.test(hub));
check("E14 mcp no longer listed as a future tab", !/FUTURE_TAB_ICONS[\s\S]{0,80}mcp:/.test(hub));
const tab = read("src/components/jarvis/McpTab.tsx");
check("E15 secret inputs are password fields", tab.includes('type="password"') && tab.includes('autoComplete="off"'));
check("E16 tab talks only to its own route", tab.includes('"/api/v2/jarvis/mcp"') && !tab.includes("/api/settings"));
check("E17 turning a server on asks first", tab.includes("setConfirmOn(s.name)") && tab.includes("Human-Gate"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
