// SPEC-F L1.3 driver: shell Blender headlessly, then VERIFY the GLB it produced.
//
// Run: npx tsx scripts/v2/hermes3d/bake.mjs
//
// The verification is the point. The bake makes claims (26 clips, named, bound);
// this reads the exported GLB's own JSON chunk back and checks them, so a
// silently-empty animation list fails here rather than in the browser.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clipNames } from "./glb.mjs";

const { CLIP_SOURCES, MESH_DONOR_FILE, DEFAULT_CLIP_POOLS } =
  await import("../../../src/lib/v2/hermes3d/clips.ts");
const { sanitizeSpawnEnv } = await import("../../../src/lib/spawnEnv.ts");

const SRC = process.env.HERMES3D_SRC ?? "E:/Game Assets/SyntyStudio/Office Animations";
const OUT = path.resolve("public/hermes3d/hermes-clips.glb");
const BLENDER =
  process.env.BLENDER_BIN ??
  path.join(os.homedir(), "AppData/Local/Microsoft/WindowsApps/blender-launcher.exe");

// NOTE: no existsSync check on BLENDER. The Microsoft Store install exposes
// itself as an app execution ALIAS under WindowsApps — a zero-byte reparse
// point that stat() reports as missing but that CreateProcess resolves fine.
// Checking for it here rejected a working Blender. Let the spawn be the test.
if (!fs.existsSync(SRC)) {
  console.error(`animation source dir not found: ${SRC} — set HERMES3D_SRC`);
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hermes3d-bake-"));
const catalogPath = path.join(tmp, "catalog.json");
const reportPath = path.join(tmp, "report.json");
fs.writeFileSync(catalogPath, JSON.stringify(CLIP_SOURCES.map(({ slug, file }) => ({ slug, file }))));

console.log(`baking ${CLIP_SOURCES.length} clips from ${SRC}`);
const res = spawnSync(
  BLENDER,
  [
    "--background", "--factory-startup",
    "--python", path.resolve("scripts/v2/hermes3d/bake-hermes.py"),
    "--",
    "--src", SRC,
    "--catalog", catalogPath,
    "--donor", MESH_DONOR_FILE,
    "--out", OUT,
    "--report", reportPath,
  ],
  { encoding: "utf8", env: sanitizeSpawnEnv(process.env), timeout: 15 * 60_000 },
);
if (res.stdout) process.stdout.write(res.stdout.split("\n").filter((l) => l.startsWith("[bake]")).join("\n") + "\n");

if (!fs.existsSync(reportPath)) {
  console.error("blender produced no report — stderr follows:");
  console.error((res.stderr ?? "").slice(-2000));
  process.exit(1);
}
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
for (const e of report.errors ?? []) console.error(`  ERROR ${e}`);
for (const s of report.skipped ?? []) console.error(`  MISSING SOURCE ${s}`);

// ── verify against the artifact, not the report ──────────────────────────────
let bad = 0;
const fail = (m) => { console.error(`FAIL  ${m}`); bad++; };

if (!fs.existsSync(OUT)) { fail(`no GLB at ${OUT}`); process.exit(1); }
const baked = clipNames(OUT);
const expected = CLIP_SOURCES.map((c) => c.slug);
const sizeMb = fs.statSync(OUT).size / 1024 / 1024;

console.log(`\n${baked.length}/${expected.length} clips in ${OUT} (${sizeMb.toFixed(2)} MB)`);
for (const slug of expected) if (!baked.includes(slug)) fail(`clip not baked: ${slug}`);
for (const name of baked) if (!expected.includes(name)) fail(`unexpected clip in GLB: ${name}`);

// Every clip a default pool references must exist, or the scene silently
// falls back and nobody notices which state lost its animation.
for (const [state, pool] of Object.entries(DEFAULT_CLIP_POOLS))
  for (const slug of pool)
    if (!baked.includes(slug)) fail(`pool "${state}" references unbaked clip ${slug}`);

for (const c of report.clips ?? []) {
  if (!c.bound) fail(`${c.slug}: no action slot bound (exports as an empty clip)`);
  if (!c.curves) fail(`${c.slug}: zero animation curves`);
}
if (sizeMb > 15) fail(`GLB is ${sizeMb.toFixed(2)} MB — over the 15 MB budget for public/hermes3d`);

console.log(bad === 0 ? "\nALL PASS" : `\n${bad} FAILURE(S)`);
process.exit(bad === 0 ? 0 : 1);
