// SPEC-D G1 §6.1–6.2 smoke (chunk 3): the /integrations UI contract (static
// file/regex checks, smoke-webmcp-ui pattern) + the NEW §5.6 tools/call routes
// (dynamic leg on a temp DB against the _test fixture connector), incl. the
// no-secret grep and the destructive-confirm presence check.
// Run: npx tsx scripts/v2/smoke-integrations-ui.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// Temp env BEFORE any src imports (dynamic leg) — never the live DB/settings.
const stamp = Date.now();
const tmpDb = path.join(os.tmpdir(), `agentos-smoke-int-ui-${stamp}.db`);
process.env.AGENTIC_OS_DB = tmpDb;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-int-ui-"));
const settingsFile = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_SETTINGS = settingsFile;
process.env.AGENTIC_OS_KEY = path.join(settingsDir, "agentos.key");
process.env.OLLAMA_URL = "http://127.0.0.1:1";
fs.writeFileSync(settingsFile, JSON.stringify({ memory: { ingestEnabled: false } }));

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  if (!cond) failures++;
};

// ── G1 files exist + 'use client' + default exports ─────────────────────────
const componentFiles = [
  "src/components/v2/integrations/shared.tsx",
  "src/components/v2/integrations/IntegrationsView.tsx",
  "src/components/v2/integrations/ConnectDialog.tsx",
  "src/components/v2/integrations/AccountDetail.tsx",
  "src/components/v2/integrations/ToolsTab.tsx",
  "src/components/v2/integrations/RulesTab.tsx",
  "src/components/v2/integrations/IntegrationsSettings.tsx",
];
for (const f of componentFiles) {
  check(`${f} exists`, exists(f));
  if (exists(f)) check(`${f} is 'use client'`, /^"use client";/.test(read(f)));
}
for (const f of componentFiles.slice(1)) {
  if (exists(f)) check(`${f} has a default export`, /export default function \w+/.test(read(f)));
}

// ── page + sidebar (§6.2) ───────────────────────────────────────────────────
check("src/app/integrations/page.tsx exists", exists("src/app/integrations/page.tsx"));
const page = read("src/app/integrations/page.tsx");
check("page imports IntegrationsView inside Suspense (useSearchParams)", page.includes('from "@/components/v2/integrations/IntegrationsView"') && page.includes("<Suspense") && page.includes("<IntegrationsView />"));
const sidebar = read("src/components/Sidebar.tsx");
check("Sidebar has the /integrations NAV entry (Plug, mint accent)", sidebar.includes('href: "/integrations"') && sidebar.includes("#7dd3a8"));
{
  const workspace = sidebar.match(/WORKSPACE_ROUTES = new Set\(\[([^\]]*)\]\)/)?.[1] ?? "";
  const orch = sidebar.match(/ORCHESTRATION_ROUTES = new Set\(\[([^\]]*)\]\)/)?.[1] ?? "";
  const agents = sidebar.match(/AGENT_ROUTES = new Set\(\[([^\]]*)\]\)/)?.[1] ?? "";
  check("/integrations lands in 'Workspace' via the Set (§6.2 gotcha: membership, not NAV order)", workspace.includes("/integrations") && !orch.includes("/integrations") && !agents.includes("/integrations"));
  check("sectionOf consults WORKSPACE_ROUTES", sidebar.includes("WORKSPACE_ROUTES.has(href)"));
}

// ── settings gear (rule 16) ─────────────────────────────────────────────────
const gear = read("src/components/v2/integrations/IntegrationsSettings.tsx");
check("gear surfaces callbackOrigin + syncEnabled (settings.integrations subtree)", gear.includes("callbackOrigin") && gear.includes("syncEnabled"));
check("gear writes per-definition secrets via /api/v2/integrations/[slug] PATCH", gear.includes("/api/v2/integrations/${defSlug}") && gear.includes('method: "PATCH"'));
check("gear secret inputs are password-type", (gear.match(/type="password"/g) || []).length >= 3);
check("gear secrets are write-only (values cleared after save, only booleans render)", gear.includes('setClientId("")') && gear.includes('setClientSecret("")') && gear.includes('setWebhookSecret("")') && gear.includes("configured ✓"));
const view = read("src/components/v2/integrations/IntegrationsView.tsx");
check("IntegrationsView mounts the gear (ConfigMenu → IntegrationsSettings)", view.includes("<ConfigMenu") && view.includes("<IntegrationsSettings"));
check("IntegrationsView has the master sync toggle chip", view.includes("syncEnabled: !syncEnabled"));

// ── components ↔ live routes ────────────────────────────────────────────────
const allCmp = componentFiles.map((f) => read(f)).join("\n");
const routeMap = [
  ["/api/v2/integrations", "src/app/api/v2/integrations/route.ts"],
  ["/connect", "src/app/api/v2/integrations/[slug]/connect/route.ts"],
  ["/api/v2/integrations/oauth/start", "src/app/api/v2/integrations/oauth/start/route.ts"],
  ["/sync", "src/app/api/v2/integrations/accounts/[id]/sync/route.ts"],
  ["/activity", "src/app/api/v2/integrations/accounts/[id]/activity/route.ts"],
  ["/logs", "src/app/api/v2/integrations/accounts/[id]/logs/route.ts"],
  ["/rules", "src/app/api/v2/integrations/accounts/[id]/rules/route.ts"],
  ["/tools", "src/app/api/v2/integrations/accounts/[id]/tools/route.ts"],
  ["/call", "src/app/api/v2/integrations/accounts/[id]/call/route.ts"],
];
for (const [frag, routeFile] of routeMap) {
  check(`route file exists for …${frag}`, exists(routeFile), routeFile);
  check(`a component calls …${frag}`, allCmp.includes(frag));
}
const detail = read("src/components/v2/integrations/AccountDetail.tsx");
check("AccountDetail PATCH/DELETEs the account route", detail.includes('method: "PATCH"') && detail.includes('method: "DELETE"'));
check("AccountDetail disconnect is confirm-gated + deactivate-only copy", detail.includes("window.confirm") && /reconnecting reactivates/i.test(detail));
check("AccountDetail has the brief's tab set (overview/tools/activity/sync/rules/logs)", /\["overview", "tools", "activity", "sync", "rules", "logs"\]/.test(detail));

// ── ConnectDialog contract ──────────────────────────────────────────────────
const dialog = read("src/components/v2/integrations/ConnectDialog.tsx");
check("ConnectDialog renders spec.uiHint", dialog.includes("connector.uiHint"));
check("ConnectDialog shows the redirectUri with a copy affordance", dialog.includes("redirectUri") && dialog.includes("clipboard.writeText"));
check("ConnectDialog api-key fields auto-render from spec.auth.apiKey.fields", dialog.includes("connector.authFields.map"));
check("ConnectDialog credential inputs are password-type + cleared after use", dialog.includes('type="password"') && dialog.includes('setClientId("")') && dialog.includes("setFields({})"));
check("ConnectDialog OAuth lane hits /oauth/start then redirects", dialog.includes("/api/v2/integrations/oauth/start") && dialog.includes("window.location.href"));

// ── destructive-confirm gate (chunk-3 brief; the G4.3 seam) ─────────────────
const toolsTab = read("src/components/v2/integrations/ToolsTab.tsx");
check("[Try] gates destructive tools behind an inline confirm (pendingConfirm staged, no call until Confirm)", toolsTab.includes("destructiveHint === true") && toolsTab.includes("setPendingConfirm(args)") && toolsTab.includes("invoke(pendingConfirm)"));
check("destructive confirm shows the warning copy + Cancel", /destructive — confirm to run/.test(toolsTab) && toolsTab.includes("setPendingConfirm(null)"));
check("non-destructive tools invoke directly", /if \(destructive\) \{[\s\S]*?return;\s*\}\s*void invoke\(args\);/.test(toolsTab));
check("ToolsTab notes the G4.3 DestructiveToolGate seam", toolsTab.includes("G4.3"));

// ── dynamic leg: §5.6 tools + call routes on a temp DB ──────────────────────
const { ensureDb, __closeForTests } = await import("../../src/lib/v2/db.ts");
const { NextRequest } = await import("next/server");
const store = await import("../../src/lib/v2/integrations/store.ts");
const connectRoute = await import("../../src/app/api/v2/integrations/[slug]/connect/route.ts");
const listRoute = await import("../../src/app/api/v2/integrations/route.ts");
const toolsRoute = await import("../../src/app/api/v2/integrations/accounts/[id]/tools/route.ts");
const callRoute = await import("../../src/app/api/v2/integrations/accounts/[id]/call/route.ts");

ensureDb();

const jreq = (url, method = "GET", body) =>
  new NextRequest(url, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
  });
const idCtx = (id) => ({ params: Promise.resolve({ id }) });

const API_KEY = "ui-smoke-secret-token";
let res = await connectRoute.POST(
  jreq("http://localhost/api/v2/integrations/_test/connect", "POST", { fields: { token: API_KEY } }),
  { params: Promise.resolve({ slug: "_test" }) },
);
let body = await res.json();
check("fixture connect 200", res.status === 200 && body.ok === true);
const accountId = body.account.id;
const collected = [["connect", JSON.stringify(body)]];

// list route additions (authFields + uiHint) for the ConnectDialog.
res = await listRoute.GET(jreq("http://localhost/api/v2/integrations?all=1"));
body = await res.json();
const fixture = body.connectors.find((c) => c.slug === "_test");
check("list route carries authFields + uiHint + hasApiKey (G1 additive)", Array.isArray(fixture?.authFields) && fixture.authFields[0]?.name === "token" && typeof fixture.uiHint === "string" && fixture.hasApiKey === true, fixture);
const notionRow = body.connectors.find((c) => c.slug === "notion");
check("notion lists as oauth2 WITH the api-key lane + uiHint", notionRow?.auth === "oauth2" && notionRow.hasApiKey === true && notionRow.uiHint.length > 0);
collected.push(["list", JSON.stringify(body)]);

// GET /tools
res = await toolsRoute.GET(jreq(`http://localhost/api/v2/integrations/accounts/${accountId}/tools`), idCtx(accountId));
body = await res.json();
check("tools route lists the fixture tools (slug-prefixed)", res.status === 200 && body.tools.some((t) => t.name === "_test_echo") && body.tools.some((t) => t.name === "_test_fail"));
collected.push(["tools", JSON.stringify(body)]);
res = await toolsRoute.GET(jreq("http://localhost/api/v2/integrations/accounts/nope/tools"), idCtx("nope"));
check("tools route unknown account → 404", res.status === 404);

// POST /call — echo round trip, source tagging, call-log row.
res = await callRoute.POST(
  jreq(`http://localhost/api/v2/integrations/accounts/${accountId}/call`, "POST", { tool: "_test_echo", args: { text: "hi from ui" } }),
  idCtx(accountId),
);
body = await res.json();
check("call route echo round trip {result, durationMs}", res.status === 200 && !body.result.isError && body.result.text.includes("hi from ui") && typeof body.durationMs === "number", body);
check("call route result proves verbatim tool-name pass-through", JSON.parse(body.result.text).tool === "_test_echo");
collected.push(["call", JSON.stringify(body)]);
{
  const log = store.listCallLogs(accountId).find((l) => l.toolName === "_test_echo");
  check("call logged with source 'ui' + redacted-args row", log?.source === "ui" && log.ok === true && log.args.text === "hi from ui");
}

// soft error → 200 {isError:true}; loud contract error → HTTP 400.
res = await callRoute.POST(
  jreq(`http://localhost/api/v2/integrations/accounts/${accountId}/call`, "POST", { tool: "_test_fail" }),
  idCtx(accountId),
);
body = await res.json();
check("soft API failure → 200 with result.isError", res.status === 200 && body.result.isError === true && body.result.text.startsWith("Error:"));
res = await callRoute.POST(
  jreq(`http://localhost/api/v2/integrations/accounts/${accountId}/call`, "POST", { tool: "_test_nope" }),
  idCtx(accountId),
);
check("unknown tool (contract violation) → LOUD 400", res.status === 400 && (await res.json()).error.includes("unknown tool"));
res = await callRoute.POST(
  jreq(`http://localhost/api/v2/integrations/accounts/${accountId}/call`, "POST", { args: {} }),
  idCtx(accountId),
);
check("missing tool → 400", res.status === 400);
res = await callRoute.POST(
  jreq(`http://localhost/api/v2/integrations/accounts/${accountId}/call`, "POST", { tool: "_test_echo", args: [1] }),
  idCtx(accountId),
);
check("non-object args → 400", res.status === 400);
res = await callRoute.POST(jreq("http://localhost/api/v2/integrations/accounts/nope/call", "POST", { tool: "x" }), idCtx("nope"));
check("call route unknown account → 404", res.status === 404);

// NO-SECRETS grep: the raw api key never appears beyond the fixture-derived
// external id (accountId = `fixture-<token>` — chunk-1 exemption).
for (const [name, text] of collected) {
  const stripped = text.replaceAll(`fixture-${API_KEY}`, "").replaceAll(`…${API_KEY.slice(-4)}`, "");
  check(`no secret value in '${name}' response (beyond the fixture-derived id)`, !stripped.includes(API_KEY));
}

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
try { fs.rmSync(settingsDir, { recursive: true, force: true }); } catch {}
console.log(failures === 0 ? "\nsmoke-integrations-ui: ALL PASS" : `\nsmoke-integrations-ui: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
