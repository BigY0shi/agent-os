// S29 Guide smoke, offline.
//   A. coverage: every sidebar module has a doc in docs/modules whose Route matches it
//   B. truth: every doc's Route is a real page; every module doc has its controls table
//      and a "How it works" section; the general sections exist
//   C. voice: no em or en dashes in the docs (they are public on GitHub)
//   D. the page: loadGuide parses titles, routes and intros; the view searches, links each
//      module, keeps the original build-your-own guide; the top bar links to /guide
//   E. the index: docs/modules/README.md lists every doc, and the root README links it
// Run: npx tsx scripts/v2/smoke-guide.mjs
import fs from "node:fs";
import path from "node:path";

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || extra === undefined ? "" : `  [${String(typeof extra === "string" ? extra : JSON.stringify(extra)).slice(0, 400)}]`}`);
  if (!cond) failures++;
};
const read = (f) => fs.readFileSync(f, "utf8");
const MOD = "docs/modules";
const docs = fs.readdirSync(MOD).filter((f) => f.endsWith(".md") && f !== "README.md");
const routeOf = (f) => /^Route:\s*`([^`]+)`/m.exec(read(path.join(MOD, f)))?.[1] ?? null;
const byRoute = new Map(docs.map((f) => [routeOf(f), f]));

// ── A ─────────────────────────────────────────────────────────────────────────
const sidebar = read("src/components/Sidebar.tsx");
const modules = [...sidebar.matchAll(/\{ href: "(\/[^"]*)",\s+label: "([^"]+)"/g)].map((m) => ({ href: m[1], label: m[2] }));
const missing = modules.filter((m) => !byRoute.has(m.href)).map((m) => `${m.label} (${m.href})`);
check(`A1 every sidebar module (${modules.length}) has a doc with its route`, modules.length >= 40 && missing.length === 0, missing);

// ── B ─────────────────────────────────────────────────────────────────────────
const pageFor = (r) => (r === "/" ? "src/app/page.tsx" : `src/app${r.split("?")[0]}/page.tsx`);
const deadRoutes = docs.filter((f) => { const r = routeOf(f); return !r || !fs.existsSync(pageFor(r)); }).map((f) => `${f}: ${routeOf(f)}`);
check("B1 every doc names a route that is a real page", deadRoutes.length === 0, deadRoutes);
const noTable = docs.filter((f) => { const t = read(path.join(MOD, f)); return !/^## Tabs and controls/m.test(t) || !/^\|\s*Control\s*\|\s*What it does\s*\|/m.test(t); });
check("B2 every module doc has a Tabs and controls table", noTable.length === 0, noTable);
const noHow = docs.filter((f) => !/^## How it works/m.test(read(path.join(MOD, f))));
check("B3 every module doc explains how it works", noHow.length === 0, noHow);
check("B4 the general sections exist", ["start-here", "around-every-page", "how-it-works"].every((s) => fs.existsSync(`docs/guide/${s}.md`)));
const jarvis = fs.existsSync(`${MOD}/jarvis.md`) ? read(`${MOD}/jarvis.md`) : "";
const hub = read("src/components/jarvis/JarvisHub.tsx");
const tabLabels = [...hub.matchAll(/\{ key: "[a-z]+", label: "([^"]+)"/g)].map((m) => m[1]);
const undocTabs = tabLabels.filter((l) => !new RegExp(`^###\\s+.*${l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "mi").test(jarvis));
check(`B5 every Jarvis tab (${tabLabels.length}) has its own section in jarvis.md`, tabLabels.length >= 10 && undocTabs.length === 0, undocTabs);

// Windows filenames ignore case, so a module doc named claude.md or agents.md IS a
// CLAUDE.md / AGENTS.md to the agent CLIs: a session working in docs/modules would load
// the doc as instructions (found 2026-09-29; global rule 20 is the same trap).
const INSTRUCTION_NAMES = ["claude.md", "agents.md", "gemini.md", "codex.md.instructions"];
const instr = fs.readdirSync(MOD).concat(fs.readdirSync("docs/guide")).filter((f) => INSTRUCTION_NAMES.includes(f.toLowerCase()));
check("B6 no doc is named like an agent instruction file (CLAUDE.md / AGENTS.md / GEMINI.md)", instr.length === 0, instr);

// ── C ─────────────────────────────────────────────────────────────────────────
const dashy = [...docs.map((f) => path.join(MOD, f)), ...fs.readdirSync("docs/guide").map((f) => path.join("docs/guide", f))]
  // Inline code spans are exempt: a UI label quoted verbatim must match the screen.
  .filter((f) => /[–—]/.test(read(f).replace(/`[^`\n]*`/g, "")));
check("C1 no em or en dashes in the docs' own prose", dashy.length === 0, dashy);

// ── D ─────────────────────────────────────────────────────────────────────────
const G = await import("../../src/lib/guide.ts");
const { general, modules: gm } = G.loadGuide();
check("D1 loadGuide: three general sections in order", general.map((d) => d.slug).join(",") === "start-here,around-every-page,how-it-works");
check("D2 loadGuide: every module doc, Mission Control first, each with a title, a route and an intro", gm.length === docs.length && gm[0].route === "/" && gm.every((d) => d.title && d.route && d.intro));
const p = G.parseDoc("x", "# Title\n\nRoute: `/x` · UI: `a.tsx`\n\nWhat it is for.\n\n## Tabs and controls\n");
check("D3 parseDoc reads title, route and the first real paragraph", p.title === "Title" && p.route === "/x" && p.intro === "What it is for.");
const view = read("src/components/GuideView.tsx");
check("D4 the view searches, links each module, keeps the original guide", view.includes('aria-label="Search the guide"') && view.includes("Open {d.title}") && view.includes('<MarkdownView src="/api/guide" />'));
check("D5 the top bar links to the Guide", read("src/components/TopBar.tsx").includes('href="/guide"'));
check("D6 the page reads docs at request time", read("src/app/guide/page.tsx").includes('export const dynamic = "force-dynamic"'));

// ── E ─────────────────────────────────────────────────────────────────────────
const index = read(`${MOD}/README.md`);
const unlisted = docs.filter((f) => !index.includes(`(${f})`));
check("E1 the module index links every doc", unlisted.length === 0, unlisted);
check("E2 the root README links the module docs", read("README.md").includes("docs/modules/README.md"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
