// S6 (2026-09-02) — smoke-hermes3d-ui: the Hermes 3D MOUNT.
//
// The asset + data-layer smoke (smoke-hermes3d.mjs) was green for two days
// while the module was "nowhere": baked GLBs, a clip catalog, and no page,
// no NAV entry, no component. This smoke pins the part that was missing.
//
// §A-§D are STATIC contract checks (house *-ui pattern): the page and its
// client components exist and the ssr:false boundary sits in a client file;
// the sidebar NAV *and* the Artist's Corner Set; the pageMeta row; the
// missing-assets path names the pipeline doc and the scene probes before it
// touches WebGL. §E parses office-seats.json when the gitignored dir is baked
// and SKIPS with a printed reason when it is not. §F checks the gear and the
// settings default. No network, no dev server, no browser.
//
// Run: npx tsx scripts/v2/smoke-hermes3d-ui.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// settings.ts reads ~/.agentic-os/settings.json on import (rule 19): redirect first.
process.env.AGENTIC_OS_SETTINGS = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "agentos-hermes3d-ui-")), "settings.json");

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra).slice(0, 240)}` : ""}`);
  if (!cond) failures++;
};

// ── §A files + the ssr boundary ─────────────────────────────────────────────
console.log("\n§A files");
const PAGE = "src/app/hermes3d/page.tsx";
const VIEW = "src/components/v2/hermes3d/Hermes3DView.tsx";
const SCENE = "src/components/v2/hermes3d/HermesOffice.tsx";
const GEAR = "src/components/v2/hermes3d/Hermes3DSettings.tsx";
check("A1 the route file exists", exists(PAGE));
for (const f of [VIEW, SCENE, GEAR]) {
  check(`A2 ${path.basename(f)} exists and is a client component`, exists(f) && read(f).startsWith('"use client"'));
}
check("A3 the page is a server shell that renders the view", exists(PAGE) && read(PAGE).includes("Hermes3DView") && !read(PAGE).includes("ssr: false"));
check("A4 the ssr:false boundary lives in the client view (Next 16 rejects it in a server file)",
  exists(VIEW) && /dynamic\(\(\) => import\("\.\/HermesOffice"\),\s*\{\s*ssr: false/.test(read(VIEW)));
check("A5 the scene is plain three.js, not an r3f dependency that was never installed",
  exists(SCENE) && read(SCENE).includes('from "three"') && !/@react-three/.test(read(SCENE)));

// ── §B sidebar ──────────────────────────────────────────────────────────────
console.log("\n§B sidebar");
const sidebar = read("src/components/Sidebar.tsx");
check("B1 NAV carries /hermes3d", /href:\s*"\/hermes3d"/.test(sidebar));
const artistLine = sidebar.match(/const ARTIST_ROUTES = new Set\((\[[^\]]*\])\);/);
check("B2 ARTIST_ROUTES Set literal is parseable", !!artistLine);
let artist = [];
if (artistLine) { artist = JSON.parse(artistLine[1]); }
check("B3 /hermes3d is in Artist's Corner (a NAV route in no Set lands in 'Self')", artist.includes("/hermes3d"), artist);
check("B4 the Armchair icon is imported, not a name typed from memory", /\bArmchair\b/.test(sidebar.split("\n").find((l) => l.includes('from "lucide-react"')) ?? ""));

// ── §C pageMeta ─────────────────────────────────────────────────────────────
console.log("\n§C pageMeta");
const { TITLES, metaFor } = await import("../../src/lib/pageMeta.ts");
check("C1 TITLES has a /hermes3d row with a title", !!TITLES["/hermes3d"]?.title?.trim(), TITLES["/hermes3d"]);
check("C2 the TopBar does not fall back to Mission Control for it", metaFor("/hermes3d").title !== TITLES["/"].title);
check("C3 the standfirst does not promise agents that are not wired", !/agents (in|at) (their|the) (seats|desks) (are|is) live/i.test(TITLES["/hermes3d"]?.sub ?? ""));

// ── §D missing-assets contract ──────────────────────────────────────────────
console.log("\n§D missing assets");
const { HERMES3D_ASSETS, MISSING_ASSETS_MESSAGE, SEATED_IDLE_CLIPS, pickSeats, isSeatAnchor } = await import("../../src/lib/v2/hermes3d/scene.ts");
check("D1 the message says 'not baked' and names the pipeline doc",
  /not baked/i.test(MISSING_ASSETS_MESSAGE) && MISSING_ASSETS_MESSAGE.includes("_design/hermes3d/PIPELINE.md"));
check("D2 the pipeline doc it names exists", exists("_design/hermes3d/PIPELINE.md"));
const scene = read(SCENE);
check("D3 the scene renders MISSING_ASSETS_MESSAGE (not a bare console.warn)", /\{MISSING_ASSETS_MESSAGE\}/.test(scene));
check("D4 the scene probes office.glb with HEAD before creating a WebGLRenderer",
  scene.indexOf('method: "HEAD"') > -1 && scene.indexOf('method: "HEAD"') < scene.indexOf("new THREE.WebGLRenderer"));
check("D5 every status has a visible branch (never a blank canvas)",
  ['status.kind === "missing"', 'status.kind === "error"', 'status.kind === "probing"', 'status.kind === "ready"'].every((s) => scene.includes(s)));
check("D6 a zero-mesh office is an error, not a dark void", /officeMeshes === 0/.test(scene) && /holds zero meshes/.test(scene));
check("D7 asset URLs are rooted under /hermes3d/ (public/, gitignored)",
  Object.values(HERMES3D_ASSETS).every((u) => u.startsWith("/hermes3d/")));
check("D8 the HUD says the seated bodies are not agents", /Not agents: run state is not wired/.test(scene));
const { CLIP_SOURCES } = await import("../../src/lib/v2/hermes3d/clips.ts");
check("D9 the seated idle clips are catalog slugs flagged seated",
  SEATED_IDLE_CLIPS.every((s) => CLIP_SOURCES.some((c) => c.slug === s && c.seated === true)), SEATED_IDLE_CLIPS);

// ── §E seat anchors (baked artifact; SKIP when the gitignored dir is absent) ─
console.log("\n§E seat anchors");
const SEATS = path.join(root, "public/hermes3d/office-seats.json");
if (!fs.existsSync(SEATS)) {
  console.log("SKIP  public/hermes3d/office-seats.json absent (gitignored; bake per _design/hermes3d/PIPELINE.md) — E1-E4 not run");
} else {
  const rows = JSON.parse(fs.readFileSync(SEATS, "utf8"));
  check("E1 office-seats.json is an array of >= 100 anchors", Array.isArray(rows) && rows.length >= 100, rows?.length);
  const bad = rows.filter((r) => !isSeatAnchor(r));
  check("E2 every anchor has name/kind/pos[3]/rotY", bad.length === 0, bad.slice(0, 2));
  const chairs = rows.filter((r) => r.kind === "chair");
  check("E3 there are chairs to seat bodies on", chairs.length >= 4, chairs.length);
  const picked = pickSeats(rows, 4);
  check("E4 pickSeats returns 4 distinct chairs, deterministically",
    picked.length === 4 && new Set(picked.map((p) => p.name)).size === 4 && picked.every((p) => p.kind === "chair")
      && JSON.stringify(pickSeats(rows, 4)) === JSON.stringify(picked),
    picked.map((p) => p.name));
  check("E5 pickSeats(…, 0) seats nobody (the office-alone setting)", pickSeats(rows, 0).length === 0);
}

// ── §F gear + settings default ──────────────────────────────────────────────
console.log("\n§F gear");
const gear = read(GEAR);
for (const key of ["quality", "shadows", "showFps", "seatedCount"]) {
  check(`F1 the gear edits hermes3d.${key}`, gear.includes(key));
}
check("F2 the gear saves through the shared settings hook (PATCH /api/settings)", /save\(\{ hermes3d:/.test(gear) && gear.includes("useSettings"));
check("F3 talkingHoldMs is not a dead switch in the gear (nothing consumes it yet)", !/talkingHoldMs.*onChange/.test(gear));
const { DEFAULT_SETTINGS } = await import("../../src/lib/settings.ts");
check("F4 DEFAULT_SETTINGS.hermes3d.seatedCount defaults to 4", DEFAULT_SETTINGS.hermes3d?.seatedCount === 4, DEFAULT_SETTINGS.hermes3d);
check("F5 no client file reads process.env or a key", [VIEW, SCENE, GEAR].every((f) => !/process\.env|apiKey|API_KEY/.test(read(f))));

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
