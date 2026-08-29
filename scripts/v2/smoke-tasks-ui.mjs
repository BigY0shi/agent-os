// smoke-tasks-ui.mjs — STATIC assertions for the B4 Tasks page UI.
// No dev server, no build: file existence, 'use client' discipline,
// fetch-URL ↔ live-route cross-check, no server-only imports, StatusBand at
// the exact CONVENTIONS §6 path with the exact 5 hex values, Sidebar entry.
// Run: node scripts/v2/smoke-tasks-ui.mjs

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const tasksDir = path.join(root, "src", "components", "v2", "tasks");

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
}

// ── 1. every deliverable component file exists ───────────────────────────────
const COMPONENTS = [
  "TasksView.tsx",
  "TaskListPanel.tsx",
  "MiniCalendar.tsx",
  "TaskBoard.tsx",
  "AgentsSection.tsx",
  "TaskDetail.tsx",
  "TasksSettings.tsx",
  "shared.tsx",
];
const componentPaths = COMPONENTS.map((f) => path.join(tasksDir, f));
const statusBandPath = path.join(root, "src", "components", "v2", "StatusBand.tsx");
componentPaths.push(statusBandPath);
for (const p of componentPaths) {
  check(`exists: ${path.relative(root, p)}`, existsSync(p));
}

// ── 2. page.tsx renders TasksView ────────────────────────────────────────────
const pagePath = path.join(root, "src", "app", "tasks", "page.tsx");
const pageSrc = existsSync(pagePath) ? readFileSync(pagePath, "utf8") : "";
check(
  "page.tsx imports TasksView",
  /import\s+TasksView\s+from\s+"@\/components\/v2\/tasks\/TasksView"/.test(pageSrc) &&
    /<TasksView\s*\/>/.test(pageSrc),
);

// ── 3. StatusBand: EXACT CONVENTIONS §6 path + palette ───────────────────────
const bandSrc = existsSync(statusBandPath) ? readFileSync(statusBandPath, "utf8") : "";
check("StatusBand at src/components/v2/StatusBand.tsx", existsSync(statusBandPath));
const PALETTE = {
  running: "#34d399",
  idle: "#60a5fa",
  waiting: "#fbbf24",
  error: "#f87171",
  offline: "#9ca3af",
};
for (const [k, hex] of Object.entries(PALETTE)) {
  const re = new RegExp(`${k}:\\s*"${hex}"`);
  check(`StatusBand palette: ${k} ${hex}`, re.test(bandSrc));
}
check("StatusBand exports STATUS_BAND_COLORS", /export const STATUS_BAND_COLORS/.test(bandSrc));

// ── 4. Sidebar has the /tasks NAV entry ──────────────────────────────────────
const sidebarSrc = readFileSync(path.join(root, "src", "components", "Sidebar.tsx"), "utf8");
check("Sidebar NAV has /tasks entry", /href:\s*"\/tasks"/.test(sidebarSrc));
check("Sidebar /tasks is NOT in a section Set (lands in Self)", !/ORCHESTRATION_ROUTES = new Set\([^)]*"\/tasks"/.test(sidebarSrc) && !/AGENT_ROUTES = new Set\([^)]*"\/tasks"/.test(sidebarSrc));
check("Sidebar /kanban entry untouched", /href:\s*"\/kanban"/.test(sidebarSrc));

// ── 5. every fetch URL in the components maps to a live route ────────────────
function collectRoutes(dir, prefix = "") {
  const routes = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) routes.push(...collectRoutes(p, `${prefix}/${name}`));
    else if (name === "route.ts") routes.push(prefix);
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
    const normalized = raw.replace(/\$\{[^}]+\}/g, "[param]");
    check(`fetch → route: ${raw} (${path.basename(p)})`, routeExists(normalized), normalized);
  }
}
check("found fetch calls to cross-check", fetchCount > 0, `${fetchCount} fetches`);

// ── 6. no component imports server-only modules ──────────────────────────────
// (@/lib/v2/tasks/types is CLIENT-SAFE by design — zero node imports.)
const FORBIDDEN = [
  "@/lib/v2/db",
  "@/lib/v2/dbSchema",
  "@/lib/v2/boot",
  "@/lib/v2/events",
  "@/lib/v2/scheduler",
  "@/lib/v2/tasks/store",
  "@/lib/v2/tasks/engine",
  "@/lib/v2/tasks/dispatch",
  "@/lib/v2/tasks/recurrence",
  "@/lib/v2/tasks/seeds",
  "@/lib/agentsStore",
  "@/lib/agentsRuntime",
  "@/lib/settings",
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

// ── 7. 'use client' present in each component file ───────────────────────────
for (const p of componentPaths) {
  if (!existsSync(p)) continue;
  const first = readFileSync(p, "utf8").trimStart();
  check(`'use client': ${path.basename(p)}`, first.startsWith('"use client"'));
}

// ── 8. board mapping sanity (shared.tsx carries the §6 columns) ──────────────
const sharedSrc = readFileSync(path.join(tasksDir, "shared.tsx"), "utf8");
check("board: 4 columns todo/inprogress/waiting/done", ["\"todo\"", "\"inprogress\"", "\"waiting\"", "\"done\""].every((k) => sharedSrc.includes(`key: ${k}`)));
check("board: In Progress = Ready+Working, drop sets Ready", /statuses:\s*\["Ready",\s*"Working"\],\s*dropStatus:\s*"Ready"/.test(sharedSrc));
check("board: Waiting column = Waiting+Review", /statuses:\s*\["Waiting",\s*"Review"\]/.test(sharedSrc));

// ── report ───────────────────────────────────────────────────────────────────
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok || !r.detail ? "" : `  [${r.detail}]`}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed > 0) process.exit(1);
console.log("ALL PASS");
