// smoke-pages-ui.mjs — STATIC assertions for the B5 Scratchpad (/today) UI.
// No dev server, no build: file existence, 'use client' discipline, fetch-URL
// ↔ live-route cross-check, no server-only imports, TipTap assembly (StarterKit
// + TaskList/TaskItem + custom attrs), Sidebar /today entry, autosave + 409
// handling markers, Widgets placeholder.
// Run: node scripts/v2/smoke-pages-ui.mjs

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const pagesDir = path.join(root, "src", "components", "v2", "pages");

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
}

// ── 1. every deliverable component file exists ───────────────────────────────
const COMPONENTS = [
  "ScratchpadView.tsx",
  "Editor.tsx",
  "CommentBubble.tsx",
  "PageHeader.tsx",
  "ScratchpadSettings.tsx",
  "shared.tsx",
];
const componentPaths = COMPONENTS.map((f) => path.join(pagesDir, f));
for (const p of componentPaths) {
  check(`exists: ${path.relative(root, p)}`, existsSync(p));
}

// ── 2. /today page renders ScratchpadView ────────────────────────────────────
const pagePath = path.join(root, "src", "app", "today", "page.tsx");
const pageSrc = existsSync(pagePath) ? readFileSync(pagePath, "utf8") : "";
check("app/today/page.tsx exists", existsSync(pagePath));
check(
  "page.tsx imports ScratchpadView",
  /import\s+ScratchpadView\s+from\s+"@\/components\/v2\/pages\/ScratchpadView"/.test(pageSrc) &&
    /<ScratchpadView\s*\/>/.test(pageSrc),
);

// ── 3. Sidebar has the /today NAV entry, /tasks untouched ────────────────────
const sidebarSrc = readFileSync(path.join(root, "src", "components", "Sidebar.tsx"), "utf8");
check("Sidebar NAV has /today entry", /href:\s*"\/today"/.test(sidebarSrc));
check("Sidebar /today uses NotebookPen icon", /"\/today",\s*label:\s*"Today",\s*icon:\s*<NotebookPen/.test(sidebarSrc));
check(
  "Sidebar /today is NOT in a section Set (lands in Self)",
  !/ORCHESTRATION_ROUTES = new Set\([^)]*"\/today"/.test(sidebarSrc) &&
    !/AGENT_ROUTES = new Set\([^)]*"\/today"/.test(sidebarSrc),
);
check("Sidebar /tasks entry untouched", /href:\s*"\/tasks"/.test(sidebarSrc));

// ── 4. every fetch URL in the components maps to a live route ────────────────
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
check("found fetch calls to cross-check", fetchCount >= 5, `${fetchCount} fetches`);

// ── 5. no component imports server-only modules ──────────────────────────────
const FORBIDDEN = [
  "@/lib/v2/db",
  "@/lib/v2/dbSchema",
  "@/lib/v2/boot",
  "@/lib/v2/events",
  "@/lib/v2/scheduler",
  "@/lib/v2/pages/store",
  "@/lib/v2/pages/butler",
  "@/lib/v2/tasks/store",
  "@/lib/v2/tasks/engine",
  "@/lib/v2/memory/queue",
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

// ── 6. 'use client' present in each component file ───────────────────────────
for (const p of componentPaths) {
  if (!existsSync(p)) continue;
  const first = readFileSync(p, "utf8").trimStart();
  check(`'use client': ${path.basename(p)}`, first.startsWith('"use client"'));
}

// ── 7. TipTap assembly (sanctioned minimum dep set) ──────────────────────────
const editorSrc = existsSync(path.join(pagesDir, "Editor.tsx"))
  ? readFileSync(path.join(pagesDir, "Editor.tsx"), "utf8")
  : "";
check("Editor: @tiptap/react (useEditor + EditorContent)", /from\s+"@tiptap\/react"/.test(editorSrc) && /useEditor/.test(editorSrc) && /EditorContent/.test(editorSrc));
check("Editor: StarterKit", /from\s+"@tiptap\/starter-kit"/.test(editorSrc));
check("Editor: TaskList + TaskItem extensions", /from\s+"@tiptap\/extension-task-list"/.test(editorSrc) && /from\s+"@tiptap\/extension-task-item"/.test(editorSrc));
check("Editor: NO Yjs packages (deferred per SPEC-B §1.1)", !/yjs|hocuspocus|y-prosemirror/i.test(editorSrc));
check("Editor: custom attrs taskUuid/displayId on taskItem", /taskUuid/.test(editorSrc) && /displayId/.test(editorSrc));
check("Editor: paragraph nodeId/mentionHandled attrs", /nodeId/.test(editorSrc) && /mentionHandled/.test(editorSrc));
check("Editor: SSR-safe (immediatelyRender: false)", /immediatelyRender:\s*false/.test(editorSrc));
check("Editor: ~1.5 s debounced autosave", /1500/.test(editorSrc));
check("Editor: rev CAS 409 handling (refetch/replace)", /409/.test(editorSrc) && /current/.test(editorSrc));
check("Editor: displayId chip deep-links /tasks?focus=", /\/tasks\?focus=/.test(editorSrc));

// ── 8. view wiring: bubbles, header nav, widgets placeholder, gear ───────────
const viewSrc = readFileSync(path.join(pagesDir, "ScratchpadView.tsx"), "utf8");
check("View: comment bubbles mounted", /CommentBubbles?/.test(viewSrc));
check("View: conflict toast on 409 replace", /conflict/.test(viewSrc) && /reloaded|Reloaded/i.test(viewSrc));
check("View: polls task statuses for live badges", /source=daily/.test(viewSrc));
const headerSrc = readFileSync(path.join(pagesDir, "PageHeader.tsx"), "utf8");
check("Header: prev/next/today navigation", /onPrev/.test(headerSrc) && /onNext/.test(headerSrc) && /onToday/.test(headerSrc));
check("Header: Widgets placeholder (disabled, H phase)", /Widgets/.test(headerSrc) && /disabled/.test(headerSrc));
check("Header: gear mounts ScratchpadSettings in ConfigMenu", /ConfigMenu/.test(headerSrc) && /ScratchpadSettings/.test(headerSrc));
const settingsSrc = readFileSync(path.join(pagesDir, "ScratchpadSettings.tsx"), "utf8");
check("Settings: exposes scratchpad.mentionDebounceSec (rule 16)", /mentionDebounceSec/.test(settingsSrc));

// ── report ───────────────────────────────────────────────────────────────────
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok || !r.detail ? "" : `  [${r.detail}]`}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed > 0) process.exit(1);
console.log("ALL PASS");
