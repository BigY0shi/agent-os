// SPEC-C chunk-4 smoke: D3 builder UI (static file/regex contract) + the new
// /logs cursor route (dynamic leg on a temp DB) + CR.1 repoint checks.
//   - /webmcp page + all builder components exist, 'use client', wired to the
//     live /api/v2/webmcp routes; Sidebar entry present (Self via fallback)
//   - settings.webmcp gear surfaced (rule 16): sandboxTimeoutMs + allowJsHandlers
//   - secrets stay write-only client-side (password input, value cleared, never
//     rendered back)
//   - CR.1: JarvisModule + JarvisView ask lanes point at POST /api/v2/jarvis/ask;
//     no live fetch of /api/jarvis/brain or /api/hermes/jarvis remains; the
//     C2b voice-capture semantics in JarvisView are UNTOUCHED; /api/jarvis/brain
//     is comment-marked deprecated but still serves
//   - dynamic: GET /api/v2/webmcp/packages/[id]/logs pages with `before` cursor
// Run: npx tsx scripts/v2/smoke-webmcp-ui.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// Temp env BEFORE any src imports (dynamic leg) — never the live DB/settings.
const stamp = Date.now();
const tmpDb = path.join(os.tmpdir(), `agentos-smoke-webmcp-ui-${stamp}.db`);
process.env.AGENTIC_OS_DB = tmpDb;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-webmcp-ui-"));
process.env.AGENTIC_OS_SETTINGS = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_WEBMCP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-webmcp-ui-sec-"));

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  if (!cond) failures++;
};

// ── D3 files exist + 'use client' ───────────────────────────────────────────
const componentFiles = [
  "src/components/v2/webmcp/shared.tsx",
  "src/components/v2/webmcp/WebmcpView.tsx",
  "src/components/v2/webmcp/PackageList.tsx",
  "src/components/v2/webmcp/PackageEditor.tsx",
  "src/components/v2/webmcp/SpecForm.tsx",
  "src/components/v2/webmcp/ToolDesigner.tsx",
  "src/components/v2/webmcp/TestRunner.tsx",
  "src/components/v2/webmcp/VersionsPanel.tsx",
  "src/components/v2/webmcp/LogsPanel.tsx",
  "src/components/v2/webmcp/SecretsPanel.tsx",
  "src/components/v2/webmcp/WebmcpSettings.tsx",
];
for (const f of componentFiles) {
  check(`${f} exists`, exists(f));
  if (exists(f)) check(`${f} is 'use client'`, /^"use client";/.test(read(f)));
}
for (const f of componentFiles.slice(1)) {
  if (exists(f)) check(`${f} has a default export`, /export default function \w+/.test(read(f)));
}

// ── page + sidebar ──────────────────────────────────────────────────────────
check("src/app/webmcp/page.tsx exists", exists("src/app/webmcp/page.tsx"));
const page = read("src/app/webmcp/page.tsx");
check("page imports WebmcpView", page.includes('from "@/components/v2/webmcp/WebmcpView"') && page.includes("<WebmcpView />"));
const sidebar = read("src/components/Sidebar.tsx");
check("Sidebar has the /webmcp NAV entry (Hammer, tool-brass accent)", sidebar.includes('href: "/webmcp"') && sidebar.includes("#b7852f"));
{
  const orch = sidebar.match(/ORCHESTRATION_ROUTES = new Set\(\[([^\]]*)\]\)/)?.[1] ?? "";
  const agents = sidebar.match(/AGENT_ROUTES = new Set\(\[([^\]]*)\]\)/)?.[1] ?? "";
  check("/webmcp lands in 'Self' via sectionOf fallback (not in any section Set)", !orch.includes("/webmcp") && !agents.includes("/webmcp"));
}

// ── settings gear (rule 16) ─────────────────────────────────────────────────
const gear = read("src/components/v2/webmcp/WebmcpSettings.tsx");
check("WebmcpSettings surfaces sandboxTimeoutMs + allowJsHandlers", gear.includes("sandboxTimeoutMs") && gear.includes("allowJsHandlers"));
const view = read("src/components/v2/webmcp/WebmcpView.tsx");
check("WebmcpView mounts the gear (ConfigMenu → WebmcpSettings)", view.includes("<ConfigMenu") && view.includes("<WebmcpSettings"));
const settingsSrc = read("src/lib/settings.ts");
check("settings.webmcp defaults present", /webmcp: \{ sandboxTimeoutMs: 5000, allowJsHandlers: true, llmGetActions: true \}/.test(settingsSrc));
check("WebmcpSettings surfaces the D1.5 llmGetActions toggle (rule 16)", gear.includes("llmGetActions"));

// ── secrets stay write-only client-side ─────────────────────────────────────
const secretsCmp = read("src/components/v2/webmcp/SecretsPanel.tsx");
check("secret value input is type=password", secretsCmp.includes('type="password"'));
check("secret value cleared after save (never lingers)", secretsCmp.includes('setValue("")'));
// `{value}` may appear ONLY as the controlled input binding — never as a
// rendered text node (no ">{value}" echo anywhere).
check(
  "SecretsPanel renders names/'configured' only (no value echo)",
  secretsCmp.includes("configured") &&
    !secretsCmp.includes(">{value}") &&
    (secretsCmp.match(/\{value\}/g) || []).length === 1 &&
    secretsCmp.includes("value={value}"),
);

// ── D3 components ↔ live routes ─────────────────────────────────────────────
const routeMap = [
  ["/api/v2/webmcp/packages", "src/app/api/v2/webmcp/packages/route.ts"],
  ["/tools", "src/app/api/v2/webmcp/packages/[id]/tools/route.ts"],
  ["/test", "src/app/api/v2/webmcp/packages/[id]/test/route.ts"],
  ["/publish", "src/app/api/v2/webmcp/packages/[id]/publish/route.ts"],
  ["/export", "src/app/api/v2/webmcp/packages/[id]/export/route.ts"],
  ["/secrets", "src/app/api/v2/webmcp/packages/[id]/secrets/route.ts"],
  ["/logs", "src/app/api/v2/webmcp/packages/[id]/logs/route.ts"],
];
const allCmp = componentFiles.map((f) => read(f)).join("\n");
for (const [frag, routeFile] of routeMap) {
  check(`route file exists for …${frag}`, exists(routeFile), routeFile);
  check(`a component calls …${frag}`, allCmp.includes(frag));
}
check("package detail fetched by slug", allCmp.includes("/api/v2/webmcp/packages/${slug}"));

// ── Phase-4 chunk 1: Spec tab (D3.2) + exporter UI (D5.1) ───────────────────
const editor = read("src/components/v2/webmcp/PackageEditor.tsx");
check("PackageEditor mounts the Spec tab", editor.includes('key: "spec"') && editor.includes("<SpecForm"));
const specForm = read("src/components/v2/webmcp/SpecForm.tsx");
check(
  "SpecForm edits authKind + schedule + mcpType + config manifest",
  specForm.includes("authKind") && specForm.includes("frequency") && specForm.includes("mcpType") && specForm.includes("configManifest"),
);
check("SpecForm PATCHes { spec } to the package route", specForm.includes('method: "PATCH"') && specForm.includes("spec: next"));
const versionsCmp = read("src/components/v2/webmcp/VersionsPanel.tsx");
check(
  "VersionsPanel has the export UI (mode picker + confirm + POST /export)",
  versionsCmp.includes("/export") && versionsCmp.includes("window.confirm") && /"client"[\s\S]*?"internal"/.test(versionsCmp),
);
check("export UI surfaces the returned path", versionsCmp.includes("exportResult.path"));
const dbSchemaSrc = read("src/lib/v2/dbSchema.ts");
check("migration 032 'webmcp_spec' adds spec_json", /version: 32,\s*\n\s*name: "webmcp_spec"/.test(dbSchemaSrc) && dbSchemaSrc.includes("ADD COLUMN spec_json"));
const typesSrc = read("src/lib/v2/webmcp/types.ts");
check("WebmcpSpecSchema is strict (loud 400 on unknown keys)", typesSrc.includes("WebmcpSpecSchema = z.strictObject"));

// ── CR.1: ask lanes repointed, voice semantics preserved ────────────────────
const jm = read("src/components/dashboard/JarvisModule.tsx");
check("JarvisModule POSTs /api/v2/jarvis/ask", jm.includes('fetch("/api/v2/jarvis/ask"') && jm.includes("{ text: utterance"));
check("JarvisModule no longer fetches /api/jarvis/brain", !/fetch\("\/api\/jarvis\/brain"/.test(jm));
check("JarvisModule threads conversationId from meta", jm.includes("conversationIdRef") && jm.includes('ev.type === "meta"'));
check("JarvisModule handles/ignores tool + navigate events", jm.includes('ev.type === "tool"') && jm.includes('ev.type === "navigate"'));
check("JarvisModule mic still review-first (transcript → input, no auto-send)", jm.includes("setInput((finalText") && !/onresult[^\n]*sendUtterance/.test(jm));

const jv = read("src/components/JarvisView.tsx");
check("JarvisView chat lane POSTs /api/v2/jarvis/ask", jv.includes('fetch("/api/v2/jarvis/ask"'));
check("JarvisView no longer fetches /api/hermes/jarvis (old ask lane)", !/fetch\("\/api\/hermes\/jarvis"/.test(jv));
check("JarvisView parses sentence/done-superset SSE", jv.includes('ev.type === "sentence"') && jv.includes('ev.type === "meta"') && jv.includes('ev.type === "error"'));
// C2b invariants — IDENTICAL checks to smoke-jarvis-ui (must keep passing):
{
  const onresultCallsAsk = /onresult\s*=\s*\(e\)\s*=>\s*\{[^\n]*\bask\(/.test(jv);
  check("JarvisView rec.onresult still never calls ask() inline", !onresultCallsAsk);
  check("JarvisView still routes transcripts through deliverTranscript", (jv.match(/deliverTranscript\(/g) || []).length >= 3);
  check("deliverTranscript still gates ask() behind voiceAutoSendRef", /voiceAutoSendRef\.current\)\s*\{\s*setStatus[^\n]*ask\(/.test(jv));
}

const brainRoute = read("src/app/api/jarvis/brain/route.ts");
check("/api/jarvis/brain marked DEPRECATED but still serving", brainRoute.includes("DEPRECATED") && brainRoute.includes("export async function POST"));
{
  // No LIVE fetch of the deprecated lane anywhere in src (comments don't count).
  const needle = 'fetch("/api/jarvis/brain"';
  const hits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(tsx?|jsx?|mjs)$/.test(entry.name) && fs.readFileSync(p, "utf8").includes(needle)) hits.push(p);
    }
  };
  walk(path.join(root, "src"));
  check("no live fetch of /api/jarvis/brain remains in src/", hits.length === 0, hits);
}

// ── dynamic leg: /logs cursor route on a temp DB ────────────────────────────
const store = await import("../../src/lib/v2/webmcp/store.ts");
const { NextRequest } = await import("next/server");
const logsRoute = await import("../../src/app/api/v2/webmcp/packages/[id]/logs/route.ts");

store.createPackage({ slug: "ui-logs", name: "UI logs probe" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 5; i++) {
  store.writeCallLog({
    packageSlug: "ui-logs",
    toolName: i % 2 === 0 ? "alpha" : "beta",
    source: "test",
    redactedArgs: { i },
    ok: i !== 3,
    error: i === 3 ? "boom" : undefined,
    durationMs: 5 + i,
  });
  await sleep(5); // distinct created_at per row (ms-precision cursor)
}

const call = async (qs) => {
  const res = await logsRoute.GET(new NextRequest(`http://127.0.0.1/api/v2/webmcp/packages/ui-logs/logs${qs}`), {
    params: Promise.resolve({ id: "ui-logs" }),
  });
  return { status: res.status, json: await res.json() };
};

const p1 = await call("?limit=2");
check("logs route page 1: 2 rows + nextCursor", p1.status === 200 && p1.json.logs.length === 2 && typeof p1.json.nextCursor === "string");
check("logs route orders newest-first", p1.json.logs[0].createdAt >= p1.json.logs[1].createdAt);
const p2 = await call(`?limit=2&before=${encodeURIComponent(p1.json.nextCursor)}`);
check("logs route page 2 via before cursor (no overlap)", p2.json.logs.length === 2 && !p2.json.logs.some((l) => p1.json.logs.some((x) => x.id === l.id)));
const p3 = await call(`?limit=2&before=${encodeURIComponent(p2.json.nextCursor)}`);
check("logs route final short page ends the cursor", p3.json.logs.length === 1 && p3.json.nextCursor === null);
const filtered = await call("?tool=alpha&limit=50");
check("logs route ?tool= filter", filtered.json.logs.length === 3 && filtered.json.logs.every((l) => l.toolName === "alpha"));
check("error rows carry ok=false + error text", filtered.json.logs.concat(p2.json.logs, p1.json.logs).some((l) => l.ok === false && l.error === "boom"));
const missing = await logsRoute.GET(new NextRequest("http://127.0.0.1/x"), { params: Promise.resolve({ id: "nope" }) });
check("logs route 404s on unknown package", missing.status === 404);

// ── dynamic leg: export route contract (Phase-4 chunk 1) ────────────────────
const exportRoute = await import("../../src/app/api/v2/webmcp/packages/[id]/export/route.ts");
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
check("export route: unknown mode → 400", (await callExport("ui-logs", { mode: "tarball" })).status === 400);
check("export route: missing mode → 400", (await callExport("ui-logs", {})).status === 400);
const neverPub = await callExport("ui-logs", { mode: "client" });
check("export route: never published → 409 with a loud message", neverPub.status === 409 && /never been published/.test(neverPub.json.error ?? ""), neverPub.json);
check("export route: unknown package → 404", (await callExport("no-such", { mode: "client" })).status === 404);

// ---------------------------------------------------------------------------
const { __closeForTests } = await import("../../src/lib/v2/db.ts");
__closeForTests();
try {
  fs.rmSync(tmpDb, { force: true });
  fs.rmSync(tmpDb + "-wal", { force: true });
  fs.rmSync(tmpDb + "-shm", { force: true });
  fs.rmSync(settingsDir, { recursive: true, force: true });
  fs.rmSync(process.env.AGENTIC_OS_WEBMCP_DIR, { recursive: true, force: true });
} catch {}

console.log(failures === 0 ? "\nsmoke-webmcp-ui: ALL PASS" : `\nsmoke-webmcp-ui: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
