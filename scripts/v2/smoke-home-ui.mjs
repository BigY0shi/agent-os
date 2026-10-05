// SPEC-D H2.1/H2.2/H1.1/H3.* /H4.2 smoke: the home widget framework UI
// contract (static file/regex checks, house *-ui pattern — the dynamic
// registry/data/attention legs live in smoke-widgets.mjs). Covers: files +
// 'use client' + exports, per-cell error boundary, StatusBand imported from
// the SHARED path with NO local palette copy (CONVENTIONS §6), registry ↔
// component-map parity, HomeGrid defaults fallback, H2.2 edit mode (Customize
// toggle, hand-rolled HTML5 DnD per decision 9, size cycle, remove, picker,
// config form incl. account-select, 800ms debounced settings save,
// Cancel/Done), H1.1 Overview restructure (hero + scratchpad slot + grid
// mounted, Yoshi's pre-existing edit markers PRESERVED, legacy-* wrappers
// importing the dashboard panels unchanged), showScratchpad=false path,
// honest unavailable rendering, and the routes the components call all
// existing.
// Run: npx tsx scripts/v2/smoke-home-ui.mjs
import path from "node:path";
import fs from "node:fs";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  if (!cond) failures++;
};

// ── files exist + 'use client' ──────────────────────────────────────────────
const homeFiles = [
  "src/components/v2/home/HomeGrid.tsx",
  "src/components/v2/home/WidgetShell.tsx",
  "src/components/v2/home/widgetComponents.tsx",
  "src/components/v2/home/AttentionHero.tsx",
  // chunk 2 (H2.2 + H1.1)
  "src/components/v2/home/WidgetPicker.tsx",
  "src/components/v2/home/WidgetConfigForm.tsx",
  "src/components/v2/home/ScratchpadSlot.tsx",
];
for (const f of homeFiles) {
  check(`${f} exists`, exists(f));
  if (exists(f)) check(`${f} is 'use client'`, /^"use client";/.test(read(f)));
}
check("lib files exist (types/registry/data)",
  exists("src/lib/v2/widgets/types.ts") && exists("src/lib/v2/widgets/registry.ts") && exists("src/lib/v2/widgets/data.ts"));
check("HomeGrid has a default export", /export default function HomeGrid/.test(read("src/components/v2/home/HomeGrid.tsx")));
check("WidgetShell has a default export", /export default function WidgetShell/.test(read("src/components/v2/home/WidgetShell.tsx")));
check("AttentionHero has a default export", /export default function AttentionHero/.test(read("src/components/v2/home/AttentionHero.tsx")));

// ── per-cell error boundary (H2.1: one crashing widget = inline panel only) ─
const shell = read("src/components/v2/home/WidgetShell.tsx");
check("WidgetShell carries a real React error boundary (getDerivedStateFromError)",
  shell.includes("getDerivedStateFromError"));
check("boundary logs via componentDidCatch and renders an inline error panel",
  shell.includes("componentDidCatch") && shell.includes('role="alert"'));
const grid = read("src/components/v2/home/HomeGrid.tsx");
check("HomeGrid renders every cell through WidgetShell (so the boundary is per cell)",
  grid.includes("<WidgetShell") && grid.includes("WIDGET_COMPONENTS"));

// ── StatusBand: SHARED import, no palette fork (CONVENTIONS §6) ─────────────
const cmp = read("src/components/v2/home/widgetComponents.tsx");
check("agent-status renders the SHARED StatusBand (@/components/v2/StatusBand)",
  cmp.includes('from "@/components/v2/StatusBand"') && cmp.includes("<StatusBand"));
{
  // The §6 rule is about the five STATUS colors: agent-status rendering must
  // get them through StatusBand, never a local copy. widgetComponents.tsx is
  // the file that renders agent status, so it is the one that must be clean.
  // (WidgetShell's error panel and the hero's severity accents legitimately
  // use error-red/amber — those are severity semantics, same idiom as
  // RuleBuilder's destructive checkbox, not agent status bands.)
  const palette = ["#34d399", "#60a5fa", "#fbbf24", "#f87171", "#9ca3af"];
  const forked = palette.some((hex) => cmp.toLowerCase().includes(hex));
  check("no StatusBand palette copy in widgetComponents (band colors come only via StatusBand)", !forked);
  check("no second STATUS_BAND_COLORS declaration anywhere in home/",
    !homeFiles.some((f) => read(f).includes("STATUS_BAND_COLORS")));
  // The hero must not import or re-declare the band component either.
  const hero = read("src/components/v2/home/AttentionHero.tsx");
  check("AttentionHero does not fork StatusBand", !hero.includes("StatusBand"));
}

// ── registry ↔ component map parity ─────────────────────────────────────────
{
  const reg = read("src/lib/v2/widgets/registry.ts");
  // Not line-anchored: legacy entries come via the legacyDef({ slug: "…" }) helper.
  const regSlugs = [...reg.matchAll(/slug: "([^"]+)"/g)].map((m) => m[1]).sort();
  const mapBlock = cmp.slice(cmp.indexOf("WIDGET_COMPONENTS"));
  const mapSlugs = [...mapBlock.matchAll(/^\s*"?([a-z][a-z0-9-]*)"?: \w+Widget,/gm)].map((m) => m[1]).sort();
  check("every registry slug has a component and vice versa", JSON.stringify(regSlugs) === JSON.stringify(mapSlugs), { regSlugs, mapSlugs });
  check("chunk-2 slugs registered ONCE each (tasks-upcoming/calendar/newsletter-edition/anynotes-recent + 8 legacy-*)",
    ["tasks-upcoming", "calendar", "newsletter-edition", "anynotes-recent",
     "legacy-mission", "legacy-jarvis", "legacy-telemetry", "legacy-kpi",
     "legacy-todo", "legacy-deals", "legacy-systemmap", "legacy-timeline",
    ].every((s) => regSlugs.filter((r) => r === s).length === 1), regSlugs);
}

// ── HomeGrid: settings layout + defaults fallback ───────────────────────────
check("HomeGrid reads settings.home.cells with the DEFAULT_HOME_CELLS fallback (resolveHomeCells)",
  grid.includes("useSettings") && grid.includes("resolveHomeCells") && grid.includes(".cells"));
check("unknown widget slug renders an inline notice, not a crash", grid.includes("unknown widget"));

// ── H2.2 edit mode: DnD + size cycle + remove + debounced save + Cancel/Done ─
check("Customize toggle arms edit mode (mirrors the Sidebar customize UX)",
  grid.includes("Customize") && grid.includes("enterEdit"));
check("hand-rolled HTML5 DnD (decision 9): draggable + onDragEnter reorder + onDrop persist",
  grid.includes("draggable={edit}") && grid.includes("onDragEnter") && grid.includes("onDragOver") && grid.includes("onDrop"));
check("end drop zone appends (Sidebar '__end__' pattern)", grid.includes("__end__"));
check("size cycle S→M→L→S from SIZE_SPAN sizes", grid.includes("NEXT_SIZE") && /S: "M", M: "L", L: "S"/.test(grid));
check("remove drops the cell from the layout (filter, never a data delete)",
  grid.includes("onRemove") && grid.includes("cur.filter((c) => c.id !== cell.id)"));
// S32: the grid saves under settings.home[cellsKey] ("cells" for Mission
// Control, "todayCells" for the Today page) through the same debounced path.
check("layout saves DEBOUNCED 800ms via useSettings().save({home:{[cellsKey]}})",
  grid.includes("SAVE_DEBOUNCE_MS = 800") && grid.includes("save({ home: { [cellsKey]: next } })") && grid.includes('cellsKey = "cells"'));
check("Done flushes the pending save; Cancel restores the enter-time snapshot",
  grid.includes("const done") && grid.includes("const cancel") && grid.includes("snapshotRef"));
check("WidgetShell exposes the edit controls (gear · size cycle · remove) + drag grip",
  shell.includes("onConfigure") && shell.includes("onSizeCycle") && shell.includes("onRemove") && shell.includes("GripVertical"));
check("chromeless legacy wrappers render bare outside edit mode (pixel parity with the old page)",
  shell.includes("chromeless") && read("src/lib/v2/widgets/registry.ts").includes("chromeless: true"));

// ── H2.2 WidgetPicker: honest catalog ───────────────────────────────────────
const picker = read("src/components/v2/home/WidgetPicker.tsx");
check("picker lists the registry from /api/v2/widgets", picker.includes('fetch("/api/v2/widgets"'));
check("picker probes each endpoint widget's data route and GREYS unavailable entries WITH the reason",
  picker.includes("/api/v2/widgets/${def.slug}/data") && picker.includes("not available:") && picker.includes("opacity"));
check("greyed entries stay addable (placeholder widgets render their empty state once placed)",
  picker.includes("onClick={() => onAdd(def)}"));

// ── H2.2 WidgetConfigForm: auto-form from configSchema ──────────────────────
const form = read("src/components/v2/home/WidgetConfigForm.tsx");
check("config form auto-renders the schema field types (input/select/toggle/account-select)",
  form.includes('case "toggle"') && form.includes('case "select"') && form.includes('case "account-select"') &&
  form.includes('type="text"'));
check("account-select fetches connected accounts from /api/v2/integrations (H3.3 dynamic options)",
  form.includes('fetch("/api/v2/integrations"') && form.includes("isActive"));
check("account-select with zero connected accounts shows the honest empty state, never fake options",
  form.includes("no connected"));
check("form saves into cell.config (onSave) and can cancel", form.includes("onSave(values)") && form.includes("onCancel"));

// ── honest unavailable rendering (fake-telemetry P0) ────────────────────────
check("widget components render the honest {available:false} state verbatim",
  cmp.includes("available: false") || (cmp.includes("Unavailable") && cmp.includes("reason")));
check("data fns return {available:false, reason} for missing sources (never fabricate)",
  read("src/lib/v2/widgets/data.ts").includes("available: false"));

// ── AttentionHero (H4.2) ────────────────────────────────────────────────────
const hero = read("src/components/v2/home/AttentionHero.tsx");
check("hero + widget share ONE component (AttentionPanel with hero prop, §6.6)",
  hero.includes("export function AttentionPanel") && cmp.includes('from "./AttentionHero"') && cmp.includes("<AttentionPanel"));
check("hero groups by severity via the shared groupBySeverity helper",
  hero.includes("groupBySeverity"));
check("hero fetches the H4.1 route and PATCHes done/dismiss",
  hero.includes('fetch("/api/v2/attention"') && hero.includes('method: "PATCH"') && hero.includes('"done"') && hero.includes('"dismiss"'));
check("[Go] routes by item.route", hero.includes("item.route") && hero.includes("href={item.route}"));
check("collector-health footnote (honest-metrics rule)", hero.includes("unavailableReason") && hero.includes("CollectorFootnote"));
check("zero open items → thin All-clear band (§6.4)", hero.includes("All clear"));
check("hero live-updates via usePollWhileVisible", hero.includes("usePollWhileVisible"));

// ── H1.1: Overview restructure — hero + scratchpad + grid, Yoshi's edits kept ─
{
  const overview = read("src/components/Overview.tsx");
  check("Overview now mounts the H1.1 spine: HeroGreeting → AttentionHero → ScratchpadSlot → HomeGrid",
    overview.includes("<HeroGreeting") && overview.includes("<AttentionHero") &&
    overview.includes("<ScratchpadSlot") && overview.includes("<HomeGrid"));
  // Yoshi's PRE-EXISTING uncommitted edit (JarvisModule centerpiece comment)
  // must SURVIVE the restructure — his distinctive marker line, verbatim.
  check("Yoshi's edit marker preserved ('the warm voice assistant' comment survives the rework)",
    overview.includes("the warm voice assistant") && overview.includes("it replaced the placeholder AssistantPanel"));
  check("Overview no longer composes the panels directly (they render via the legacy-* widgets)",
    !overview.includes("<JarvisModule") && !overview.includes("<TelemetryPanel") && !overview.includes("<KPIGrid"));

  // Legacy wrappers: widgetComponents imports the dashboard panels UNCHANGED.
  for (const [slug, importPath] of [
    ["legacy-jarvis", "@/components/dashboard/JarvisModule"],
    ["legacy-telemetry", "@/components/dashboard/TelemetryPanel"],
    ["legacy-kpi", "@/components/dashboard/KPIGrid"],
    ["legacy-deals", "@/components/dashboard/DealDeskSummary"],
    ["legacy-systemmap", "@/components/dashboard/SystemMap"],
    ["legacy-timeline", "@/components/dashboard/MiniTimeline"],
    ["legacy-mission", "@/components/dashboard/MissionStripe"],
    ["legacy-todo", "@/components/TodoPanel"],
  ]) {
    check(`${slug} wraps the existing panel (imports ${importPath})`,
      cmp.includes(`"${importPath}"`) && cmp.includes(`"${slug}":`));
  }
  // Default layout reproduces the pre-rework page order (nothing visually lost).
  const typesSrc = read("src/lib/v2/widgets/types.ts");
  const defaultOrder = [...typesSrc.matchAll(/widgetSlug: "(legacy-[a-z]+)"/g)].map((m) => m[1]);
  check("DEFAULT_HOME_CELLS reproduces Yoshi's page order (mission→jarvis→telemetry→kpi→todo→deals→systemmap→timeline)",
    JSON.stringify(defaultOrder) === JSON.stringify([
      "legacy-mission", "legacy-jarvis", "legacy-telemetry", "legacy-kpi",
      "legacy-todo", "legacy-deals", "legacy-systemmap", "legacy-timeline",
    ]), defaultOrder);

  // dashboard/* content stays READ-ONLY (imported, never edited): none of the
  // panels themselves reach into the widget framework.
  const dashboardImports = fs
    .readdirSync(path.join(root, "src/components/dashboard"))
    .filter((f) => f.endsWith(".tsx"))
    .some((f) => read(`src/components/dashboard/${f}`).includes("v2/home") || read(`src/components/dashboard/${f}`).includes("v2/widgets"));
  check("dashboard/* untouched: no panel imports the widget framework", !dashboardImports);
}

// ── H1.1 ScratchpadSlot: feature-detect + settings toggle ───────────────────
{
  const slot = read("src/components/v2/home/ScratchpadSlot.tsx");
  check("ScratchpadSlot feature-detects the /today module via dynamic import try/catch (§6.4)",
    slot.includes('import("@/components/v2/pages/ScratchpadView")') && slot.includes(".catch("));
  check("settings.home.showScratchpad === false hides the slot (default stays visible)",
    slot.includes("showScratchpad === false") && slot.includes("return null"));
  check("absent module renders the dashed placeholder, never a crash",
    slot.includes("Today's scratchpad arrives with Tasks V2"));
}

// ── components ↔ live routes ────────────────────────────────────────────────
const routeMap = [
  ["/api/v2/widgets", "src/app/api/v2/widgets/route.ts"],
  ["/api/v2/widgets/${slug}/data", "src/app/api/v2/widgets/[slug]/data/route.ts"],
  ["/api/v2/attention", "src/app/api/v2/attention/route.ts"],
  ["/api/settings", "src/app/api/settings/route.ts"], // useSettings (layout persistence, H2.2 saves)
];
for (const [, file] of routeMap) {
  check(`${file} exists`, exists(file));
}
check("data widgets call /api/v2/widgets/<slug>/data", cmp.includes("/api/v2/widgets/${slug}/data"));
const dataRouteSrc = read("src/app/api/v2/widgets/[slug]/data/route.ts");
check("data route 404s an unknown slug and 400s malformed config",
  dataRouteSrc.includes("status: 404") && dataRouteSrc.includes("status: 400"));
check("settings.ts documents the home subtree (cells + showScratchpad)",
  read("src/lib/settings.ts").includes("home?:") && read("src/lib/settings.ts").includes("showScratchpad"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
