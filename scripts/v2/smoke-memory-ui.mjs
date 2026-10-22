// smoke-memory-ui.mjs — STATIC assertions for the A8 Memory page UI.
// No dev server, no build (rules 12/15): file existence, import hygiene,
// fetch-URL ↔ live-route cross-check, 'use client' discipline, exile proof.
// Run: node scripts/v2/smoke-memory-ui.mjs

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const memDir = path.join(root, "src", "components", "v2", "memory");

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
}

// ── 1. every deliverable component file exists ───────────────────────────────
const COMPONENTS = [
  "MemoryView.tsx",
  "EpisodeBrowser.tsx",
  "EpisodeDetail.tsx",
  "EntityBrowser.tsx",
  "AspectExplorer.tsx",
  "LabelsManager.tsx",
  "IngestLogs.tsx",
  "ManualIngest.tsx",
  "PersonaPanel.tsx",
  "RulesEditor.tsx",
  "MemorySettings.tsx",
  "shared.tsx",
];
const componentPaths = COMPONENTS.map((f) => path.join(memDir, f));
componentPaths.push(path.join(root, "src", "components", "v2", "EventFeed.tsx"));
for (const p of componentPaths) {
  check(`exists: ${path.relative(root, p)}`, existsSync(p));
}

// ── 2. page.tsx renders MemoryView ───────────────────────────────────────────
const pagePath = path.join(root, "src", "app", "memory", "page.tsx");
const pageSrc = existsSync(pagePath) ? readFileSync(pagePath, "utf8") : "";
check(
  "page.tsx imports MemoryView",
  /import\s+MemoryView\s+from\s+"@\/components\/v2\/memory\/MemoryView"/.test(pageSrc) &&
    /<MemoryView\s*\/>/.test(pageSrc),
);

// ── 3. exile copy of the OLD page exists under .exile/ ───────────────────────
const exileRoot = path.join(root, ".exile");
let exiledPageFound = false;
let exiledPanelFound = false;
if (existsSync(exileRoot)) {
  for (const stamp of readdirSync(exileRoot)) {
    const oldPage = path.join(exileRoot, stamp, "src", "app", "memory", "page.tsx");
    const oldPanel = path.join(exileRoot, stamp, "src", "components", "MemoryPanel.tsx");
    if (existsSync(oldPage) && readFileSync(oldPage, "utf8").includes("MemoryPanel")) exiledPageFound = true;
    if (existsSync(oldPanel)) exiledPanelFound = true;
  }
}
// .exile/ is gitignored, so a fresh clone or worktree has none: skip there (said out loud)
// instead of failing the gate (2026-10-01; all three harness worktrees went red on this).
if (existsSync(exileRoot)) {
  check("exile copy of old memory page exists (.exile/*/src/app/memory/page.tsx)", exiledPageFound);
  check("exile copy of old MemoryPanel.tsx exists", exiledPanelFound);
} else {
  console.log("SKIP  exile copies of the old memory page: no .exile/ in this checkout (gitignored)");
}
check(
  "old MemoryPanel removed from src/components (moved, not copied)",
  !existsSync(path.join(root, "src", "components", "MemoryPanel.tsx")),
);

// ── 4. every fetch URL in the components maps to a live route ────────────────
function collectRoutes(dir, prefix = "") {
  const routes = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) routes.push(...collectRoutes(p, `${prefix}/${name}`));
    else if (name === "route.ts") routes.push(prefix); // e.g. /v2/memory/episodes/[id]
  }
  return routes;
}
const apiRoutes = collectRoutes(path.join(root, "src", "app", "api")).map((r) => `/api${r}`);

function routeExists(urlPath) {
  const segs = urlPath.split("/").filter(Boolean);
  return apiRoutes.some((route) => {
    const rsegs = route.split("/").filter(Boolean);
    if (rsegs.length !== segs.length) return false;
    return rsegs.every((rs, i) => rs.startsWith("[") || rs === segs[i]);
  });
}

const FETCH_RE = /fetch\(\s*(?:"([^"]+)"|`([^`]+)`)/g;
let fetchCount = 0;
for (const p of componentPaths) {
  if (!existsSync(p)) continue;
  const src = readFileSync(p, "utf8");
  for (const m of src.matchAll(FETCH_RE)) {
    const raw = (m[1] ?? m[2]).split("?")[0];
    if (!raw.startsWith("/")) continue;
    fetchCount++;
    // template-literal path segments (${id}) count as dynamic [param] segments
    const normalized = raw.replace(/\$\{[^}]+\}/g, "[param]");
    check(`fetch → route: ${raw} (${path.basename(p)})`, routeExists(normalized), normalized);
  }
}
check("found fetch calls to cross-check", fetchCount > 0, `${fetchCount} fetches`);

// ── 5. no component imports server-only modules ──────────────────────────────
const FORBIDDEN = [
  "@/lib/v2/db",
  "@/lib/v2/dbSchema",
  "@/lib/v2/boot",
  "@/lib/v2/events",       // server bus (eventTypes is the client-safe one)
  "@/lib/v2/scheduler",
  "@/lib/v2/memory/graph",
  "@/lib/v2/memory/queue",
  "@/lib/v2/memory/persona",
  "@/lib/v2/memory/exile",
  "@/lib/v2/memory/labels",
  "@/lib/v2/memory/rules",
  "@/lib/v2/memory/vector",
  "@/lib/v2/memory/embed",
  "@/lib/v2/memory/llm",
  "@/lib/settings",        // server fs settings (client uses useSettings/api)
  "better-sqlite3",
  "node:",
];
for (const p of componentPaths) {
  if (!existsSync(p)) continue;
  const src = readFileSync(p, "utf8");
  const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  const bad = imports.filter((imp) =>
    FORBIDDEN.some((f) => (f === "node:" ? imp.startsWith("node:") : imp === f || imp.startsWith(`${f}/`))),
  );
  check(`no server-only imports: ${path.basename(p)}`, bad.length === 0, bad.join(", "));
}

// ── 6. 'use client' present in each component file ───────────────────────────
for (const p of componentPaths) {
  if (!existsSync(p)) continue;
  const first = readFileSync(p, "utf8").trimStart();
  check(`'use client': ${path.basename(p)}`, first.startsWith('"use client"'));
}

// ── report ───────────────────────────────────────────────────────────────────
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok || !r.detail ? "" : `  [${r.detail}]`}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed > 0) process.exit(1);
console.log("ALL PASS");
