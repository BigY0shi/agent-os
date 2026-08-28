// SPEC-D H2.1/H3.1/H4.2 smoke: the home widget framework UI contract (static
// file/regex checks, house *-ui pattern — the dynamic registry/data/attention
// legs live in smoke-widgets.mjs). Covers: files + 'use client' + exports,
// per-cell error boundary, StatusBand imported from the SHARED path with NO
// local palette copy (CONVENTIONS §6), registry ↔ component-map parity,
// HomeGrid defaults fallback, NO DnD yet (chunk 2), hero built standalone and
// NOT mounted in Overview (H1.1 is chunk 2 — Overview/dashboard are Yoshi's
// dirty files and this chunk must not touch them), honest unavailable
// rendering, and the routes the components call all existing.
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
  const regSlugs = [...reg.matchAll(/^\s*slug: "([^"]+)"/gm)].map((m) => m[1]).sort();
  const mapBlock = cmp.slice(cmp.indexOf("WIDGET_COMPONENTS"));
  const mapSlugs = [...mapBlock.matchAll(/^\s*"?([a-z][a-z0-9-]*)"?: \w+Widget,/gm)].map((m) => m[1]).sort();
  check("every registry slug has a component and vice versa", JSON.stringify(regSlugs) === JSON.stringify(mapSlugs), { regSlugs, mapSlugs });
}

// ── HomeGrid: settings layout + defaults fallback, no DnD yet ───────────────
check("HomeGrid reads settings.home.cells with the DEFAULT_HOME_CELLS fallback (resolveHomeCells)",
  grid.includes("useSettings") && grid.includes("resolveHomeCells") && grid.includes(".cells"));
check("no DnD in chunk 1 (H2.2 lands drag/resize — §8 risk 8 mouse-first later)",
  !grid.includes("draggable") && !shell.includes("draggable") && !grid.includes("onDrop"));
check("unknown widget slug renders an inline notice, not a crash", grid.includes("unknown widget"));

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

// ── H1.1 guard: hero/grid NOT mounted in Overview yet (chunk 2) ─────────────
{
  const overview = read("src/components/Overview.tsx");
  check("Overview.tsx untouched by this chunk: no AttentionHero/HomeGrid mount (H1.1 is chunk 2)",
    !overview.includes("AttentionHero") && !overview.includes("HomeGrid") && !overview.includes("v2/home"));
  const dashboardImports = fs
    .readdirSync(path.join(root, "src/components/dashboard"))
    .filter((f) => f.endsWith(".tsx"))
    .some((f) => read(`src/components/dashboard/${f}`).includes("v2/home") || read(`src/components/dashboard/${f}`).includes("v2/widgets"));
  check("dashboard/* untouched: nothing there imports the widget framework", !dashboardImports);
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
