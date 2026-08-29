// SPEC-C Phase-4 chunk-1 smoke: D5.1 exporter + spec_json (migration 032).
//   - temp DB/settings/webmcp dir (AGENTIC_OS_WEBMCP_DIR also redirects the
//     export root — the smoke NEVER writes ~/.agentic-os)
//   - package with a js echo tool + an http tool (w/ {{secret:*}} reference) +
//     an internal tool; spec set via store.setPackageSpec; published
//   - exportPackage both modes: files exist; `node index.mjs get-tools --config {}`
//     prints tool JSON; call-tool on the js echo echoes; internal tool throws
//     the stub error; http tool round-trips against a local server with the
//     secret supplied via --config; client mode has ${config:*} and NO
//     {{secret:*}} remnants and NO secret values anywhere in the export tree
//   - spec_json round-trips through PATCH validation (bad spec → 400);
//     export route contract (400 unknown mode, 409 never published)
// Run: npx tsx scripts/v2/smoke-webmcp-export.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import http from "node:http";
import { spawn } from "node:child_process";

// Temp env BEFORE any src imports — never the live DB/settings/home dir.
const stamp = Date.now();
const tmpDb = path.join(os.tmpdir(), `agentos-smoke-export-${stamp}.db`);
process.env.AGENTIC_OS_DB = tmpDb;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-export-set-"));
process.env.AGENTIC_OS_SETTINGS = path.join(settingsDir, "settings.json");
const webmcpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-export-wm-"));
process.env.AGENTIC_OS_WEBMCP_DIR = webmcpDir;

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  if (!cond) failures++;
};

const store = await import("../../src/lib/v2/webmcp/store.ts");
const secrets = await import("../../src/lib/v2/webmcp/secrets.ts");
const exporter = await import("../../src/lib/v2/webmcp/exporter.ts");

const SECRET_VALUE = `sv-${stamp}-hunter2`;
const SLUG = "smoke-export";

// ── seed: package + 3 tool kinds + secret + spec ────────────────────────────
store.createPackage({ slug: SLUG, name: "Smoke Export", description: "D5 exporter probe" });
store.addTool(SLUG, {
  name: "echo",
  description: "echoes text back",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  handlerKind: "js",
  handlerConfig: { code: "return { echoed: args.text };" },
});
store.addTool(SLUG, {
  name: "post_note",
  description: "posts a note to the API",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  handlerKind: "http",
  handlerConfig: {
    url: "http://127.0.0.1:__PORT__/note",
    method: "POST",
    headers: { Authorization: "Bearer {{secret:SMOKE_TOKEN}}" },
    bodyTemplate: { text: "{{arg:text}}" },
  },
});
store.addTool(SLUG, {
  name: "list_tasks",
  description: "lists Agent OS tasks (internal action)",
  inputSchema: { type: "object", properties: {} },
  handlerKind: "internal",
  handlerConfig: { actionKey: "tasks_list" },
});
secrets.setPackageSecret(SLUG, "SMOKE_TOKEN", SECRET_VALUE);

// spec via store (setSpec seam) — configManifest declares one extra field.
const goodSpec = {
  authKind: "api_key",
  schedule: { frequency: "*/15 * * * *" },
  mcpType: "stdio",
  configManifest: [{ name: "BASE_URL", description: "API base", required: false }],
};
const specPkg = store.setPackageSpec(SLUG, goodSpec);
check("setPackageSpec round-trips through the store", JSON.stringify(specPkg.spec) === JSON.stringify(goodSpec));
let badThrew = null;
try {
  store.setPackageSpec(SLUG, { authKind: "carrier-pigeon" });
} catch (e) {
  badThrew = e;
}
check("setPackageSpec rejects a bad spec loudly (WebmcpError 400)", badThrew?.status === 400, badThrew?.message);
check("bad spec did not overwrite the good one", JSON.stringify(store.getPackage(SLUG).spec) === JSON.stringify(goodSpec));

// ── export before publish → loud 409 ────────────────────────────────────────
let neverPublished = null;
try {
  exporter.exportPackage(SLUG, { mode: "client" });
} catch (e) {
  neverPublished = e;
}
check(
  "export before publish → 409 'never been published'",
  neverPublished?.status === 409 && /never been published/.test(neverPublished?.message ?? ""),
  neverPublished?.message,
);
let badMode = null;
try {
  exporter.exportPackage(SLUG, { mode: "wat" });
} catch (e) {
  badMode = e;
}
check("unknown export mode → 400", badMode?.status === 400, badMode?.message);

// ── publish + export both modes ─────────────────────────────────────────────
const { version } = store.publishPackage(SLUG);
check("published v1", version === 1);
check("published snapshot carries the frozen spec", JSON.stringify(store.getPublishedSnapshot(SLUG).package.spec) === JSON.stringify(goodSpec));

const internalRes = exporter.exportPackage(SLUG, { mode: "internal" });
check("internal export lands under the (overridden) export root", internalRes.path.startsWith(webmcpDir), internalRes.path);
for (const f of ["index.mjs", "package.json", "README.md"]) {
  check(`internal export has ${f}`, fs.existsSync(path.join(internalRes.path, f)));
}
const pkgJson = JSON.parse(fs.readFileSync(path.join(internalRes.path, "package.json"), "utf8"));
check("package.json shape (webmcp-<slug>, module, vN semver)", pkgJson.name === `webmcp-${SLUG}` && pkgJson.type === "module" && pkgJson.version === "1.0.0");

// client mode into a SEPARATE root via the explicit exportRoot arg (both override paths exercised).
const clientRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-export-client-"));
const clientRes = exporter.exportPackage(SLUG, { mode: "client", exportRoot: clientRoot });
check("client export honors the exportRoot arg", clientRes.path.startsWith(clientRoot), clientRes.path);
check("internal tool reported as stubbed", clientRes.stubbedTools.length === 1 && clientRes.stubbedTools[0] === "list_tasks");
check(
  "config manifest = spec fields + referenced secret names",
  JSON.stringify(clientRes.configNames) === JSON.stringify(["BASE_URL", "SMOKE_TOKEN"]),
  clientRes.configNames,
);

// re-export exiles the previous dir (never deletes)
const reRes = exporter.exportPackage(SLUG, { mode: "client", exportRoot: clientRoot });
check("re-export exiles the previous export dir", typeof reRes.exiledPrevious === "string" && fs.existsSync(reRes.exiledPrevious));

// ── secret hygiene: values NEVER in the export tree (either mode) ───────────
const treeText = (dir) => {
  let out = "";
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    out += entry.isDirectory() ? treeText(p) : fs.readFileSync(p, "utf8");
  }
  return out;
};
const internalText = treeText(internalRes.path);
const clientText = treeText(clientRes.path);
check("internal export contains NO secret value", !internalText.includes(SECRET_VALUE));
check("client export contains NO secret value", !clientText.includes(SECRET_VALUE));
check("internal export keeps {{secret:*}} refs", internalText.includes("{{secret:SMOKE_TOKEN}}"));
const clientIndex = fs.readFileSync(path.join(clientRes.path, "index.mjs"), "utf8");
check("client export has ${config:*} placeholders", clientIndex.includes("${config:SMOKE_TOKEN}"));
{
  const toolsSrc = clientIndex.match(/const TOOLS = ([\s\S]*?);\r?\nconst MODE/)?.[1];
  check("client export TOOLS have NO {{secret:*}} remnants", typeof toolsSrc === "string" && !/\{\{\s*secret:/.test(toolsSrc));
}
check("client README lists the config manifest", fs.readFileSync(path.join(clientRes.path, "README.md"), "utf8").includes("`SMOKE_TOKEN`"));
check("README lists the internal stub", fs.readFileSync(path.join(clientRes.path, "README.md"), "utf8").includes("internal actions are not exportable"));

// ── run the generated CLI (node index.mjs …) ────────────────────────────────
// ASYNC spawn (not spawnSync): the http E2E leg runs a local server in THIS
// process — a sync spawn would block the event loop and the server could
// never accept the child's request.
const runCli = (dir, args) =>
  new Promise((resolve) => {
    const env = { ...process.env };
    delete env.PORT; // sanitizeSpawnEnv discipline (SPEC-C §8.6): child must not inherit the dev port
    const child = spawn(process.execPath, [path.join(dir, "index.mjs"), ...args], { cwd: dir, env, timeout: 30000 });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (status) => {
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      let messages = [];
      try {
        messages = lines.map((l) => JSON.parse(l));
      } catch {
        /* asserted below */
      }
      resolve({ status, stdout, stderr, messages });
    });
  });

for (const [label, dir] of [["internal", internalRes.path], ["client", clientRes.path]]) {
  const tools = await runCli(dir, ["get-tools", "--config", "{}"]);
  check(
    `[${label}] get-tools prints the tool JSON (NDJSON Message)`,
    tools.status === 0 &&
      tools.messages.length === 1 &&
      tools.messages[0].type === "tools" &&
      tools.messages[0].data.length === 3 &&
      tools.messages[0].data.some((t) => t.name === "echo" && t.inputSchema?.properties?.text),
    tools.stdout.slice(0, 300) + tools.stderr.slice(0, 300),
  );

  const echo = await runCli(dir, ["call-tool", "--config", "{}", "--tool-name", "echo", "--tool-arguments", '{"text":"roundtrip"}']);
  const echoData = echo.messages[0]?.data;
  check(
    `[${label}] call-tool js echo echoes`,
    echo.status === 0 &&
      echo.messages[0]?.type === "tool_result" &&
      echoData?.isError === false &&
      JSON.parse(echoData.content[0].text).echoed === "roundtrip",
    echo.stdout.slice(0, 300) + echo.stderr.slice(0, 300),
  );

  const stub = await runCli(dir, ["call-tool", "--config", "{}", "--tool-name", "list_tasks", "--tool-arguments", "{}"]);
  check(
    `[${label}] internal tool throws the stub error (exit≠0)`,
    stub.status !== 0 && stub.messages[0]?.type === "error" && /internal actions are not exportable/.test(stub.messages[0].data.message),
    stub.stdout.slice(0, 300),
  );

  const spec = await runCli(dir, ["spec"]);
  check(
    `[${label}] spec subcommand emits the Spec (authKind/manifest/mode)`,
    spec.status === 0 &&
      spec.messages[0]?.type === "spec" &&
      spec.messages[0].data.authKind === "api_key" &&
      spec.messages[0].data.mode === label &&
      spec.messages[0].data.configManifest.some((f) => f.name === "SMOKE_TOKEN"),
    spec.stdout.slice(0, 300),
  );
}

// missing config value → loud error naming the key (client mode, http tool)
const missingCfg = await runCli(clientRes.path, ["call-tool", "--config", "{}", "--tool-name", "post_note", "--tool-arguments", '{"text":"x"}']);
check(
  "client http tool without config → loud missing-'SMOKE_TOKEN' error",
  missingCfg.status !== 0 && /SMOKE_TOKEN/.test(missingCfg.messages[0]?.data?.message ?? ""),
  missingCfg.stdout.slice(0, 300),
);

// ── http tool E2E against a local server (secret via --config at runtime) ───
const received = [];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    received.push({ auth: req.headers.authorization, body });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, got: JSON.parse(body || "{}").text }));
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
// The seeded url carries a __PORT__ placeholder — rewrite BOTH exports' index.mjs
// (test-only source patch; the template machinery itself is untouched).
for (const dir of [internalRes.path, clientRes.path]) {
  const p = path.join(dir, "index.mjs");
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replaceAll("__PORT__", String(port)), "utf8");
}
const cfg = JSON.stringify({ SMOKE_TOKEN: SECRET_VALUE });
const httpInternal = await runCli(internalRes.path, ["call-tool", "--config", cfg, "--tool-name", "post_note", "--tool-arguments", '{"text":"from-internal"}']);
check(
  "[internal] http tool round-trips ({{secret:*}} resolved from --config)",
  httpInternal.status === 0 && JSON.parse(httpInternal.messages[0].data.content[0].text).got === "from-internal",
  httpInternal.stdout.slice(0, 300) + httpInternal.stderr.slice(0, 300),
);
const httpClient = await runCli(clientRes.path, ["call-tool", "--config", cfg, "--tool-name", "post_note", "--tool-arguments", '{"text":"from-client"}']);
check(
  "[client] http tool round-trips (${config:*} resolved from --config)",
  httpClient.status === 0 && JSON.parse(httpClient.messages[0].data.content[0].text).got === "from-client",
  httpClient.stdout.slice(0, 300) + httpClient.stderr.slice(0, 300),
);
check(
  "server saw the Bearer secret from --config (runtime resolution, not embedding)",
  received.length === 2 && received.every((r) => r.auth === `Bearer ${SECRET_VALUE}`),
  received,
);
server.close();

// ── spec PATCH route round-trip (loud 400 on mismatch) ──────────────────────
const { NextRequest } = await import("next/server");
const pkgRoute = await import("../../src/app/api/v2/webmcp/packages/[id]/route.ts");
const exportRoute = await import("../../src/app/api/v2/webmcp/packages/[id]/export/route.ts");
const patchSpec = async (spec) => {
  const res = await pkgRoute.PATCH(
    new NextRequest(`http://127.0.0.1/api/v2/webmcp/packages/${SLUG}`, {
      method: "PATCH",
      body: JSON.stringify({ spec }),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id: SLUG }) },
  );
  return { status: res.status, json: await res.json() };
};

const patched = await patchSpec({ authKind: "oauth2", mcpType: "http", configManifest: [{ name: "CLIENT_ID", required: true }] });
check("PATCH {spec} persists (200)", patched.status === 200 && patched.json.package.spec.authKind === "oauth2");
const roundTrip = await pkgRoute.GET(new NextRequest("http://127.0.0.1/x"), { params: Promise.resolve({ id: SLUG }) });
const rtJson = await roundTrip.json();
check("GET returns the patched spec (reload shows values)", rtJson.package.spec.mcpType === "http" && rtJson.package.spec.configManifest[0].name === "CLIENT_ID");

const badKeys = await patchSpec({ authKind: "oauth2", bogusField: true });
check("PATCH bad spec (unknown key) → 400", badKeys.status === 400, badKeys.json);
const badType = await patchSpec({ configManifest: [{ name: "1-bad-name" }] });
check("PATCH bad spec (invalid config name) → 400", badType.status === 400, badType.json);
const badShape = await patchSpec("not-an-object");
check("PATCH spec non-object → 400", badShape.status === 400, badShape.json);
const cleared = await patchSpec(null);
check("PATCH spec:null clears it", cleared.status === 200 && cleared.json.package.spec === null);

// ── export route contract ───────────────────────────────────────────────────
const callExport = async (id, body) => {
  const res = await exportRoute.POST(
    new NextRequest(`http://127.0.0.1/api/v2/webmcp/packages/${id}/export`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, json: await res.json() };
};
const routeBadMode = await callExport(SLUG, { mode: "zip" });
check("export route: unknown mode → 400", routeBadMode.status === 400);
store.createPackage({ slug: "never-pub", name: "Never Published" });
store.addTool("never-pub", { name: "noop", handlerKind: "js", handlerConfig: { code: "return 1;" } });
const routeNeverPub = await callExport("never-pub", { mode: "internal" });
check("export route: never published → 409", routeNeverPub.status === 409, routeNeverPub.json);
const routeOk = await callExport(SLUG, { mode: "internal" });
check("export route: happy path → { path }", routeOk.status === 200 && typeof routeOk.json.path === "string" && fs.existsSync(path.join(routeOk.json.path, "index.mjs")));
const routeMissing = await callExport("no-such-pkg", { mode: "internal" });
check("export route: unknown package → 404", routeMissing.status === 404);

// ---------------------------------------------------------------------------
const { __closeForTests } = await import("../../src/lib/v2/db.ts");
__closeForTests();
try {
  fs.rmSync(tmpDb, { force: true });
  fs.rmSync(tmpDb + "-wal", { force: true });
  fs.rmSync(tmpDb + "-shm", { force: true });
  fs.rmSync(settingsDir, { recursive: true, force: true });
  fs.rmSync(webmcpDir, { recursive: true, force: true });
  fs.rmSync(clientRoot, { recursive: true, force: true });
} catch {}

console.log(failures === 0 ? "\nsmoke-webmcp-export: ALL PASS" : `\nsmoke-webmcp-export: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
