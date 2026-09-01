// SPEC-F L1.3 driver for office.glb. Same shape as bake.mjs: shell Blender,
// then verify the artifact it produced rather than the report it wrote.
//
// Run: npx tsx scripts/v2/hermes3d/bake-office.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readGlbJson } from "./glb.mjs";

const { sanitizeSpawnEnv } = await import("../../../src/lib/spawnEnv.ts");

const ROOT = process.env.HERMES3D_OFFICE_SRC ?? "E:/Game Assets/SyntyStudio/Unreal/SourceFiles";
const FBX = path.join(ROOT, "Office_Demo.fbx");
const TEXTURES = path.join(ROOT, "Textures");
const OUT = path.resolve("public/hermes3d/office.glb");
const SEATS = path.resolve("public/hermes3d/office-seats.json");
// See bake.mjs: no existsSync on the Store launcher — it is an app execution
// alias that stat() cannot see but CreateProcess resolves.
const BLENDER =
  process.env.BLENDER_BIN ??
  path.join(os.homedir(), "AppData/Local/Microsoft/WindowsApps/blender-launcher.exe");

for (const [label, p] of [["FBX", FBX], ["textures dir", TEXTURES]]) {
  if (!fs.existsSync(p)) {
    console.error(`${label} not found: ${p} — set HERMES3D_OFFICE_SRC`);
    process.exit(1);
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hermes3d-office-"));
const reportPath = path.join(tmp, "report.json");

console.log(`baking office from ${FBX}`);
const res = spawnSync(
  BLENDER,
  [
    "--background", "--factory-startup",
    "--python", path.resolve("scripts/v2/hermes3d/bake-office.py"),
    "--",
    "--fbx", FBX,
    "--textures", TEXTURES,
    "--out", OUT,
    "--seats", SEATS,
    "--report", reportPath,
  ],
  { encoding: "utf8", env: sanitizeSpawnEnv(process.env), timeout: 20 * 60_000 },
);
if (res.stdout) process.stdout.write(res.stdout.split("\n").filter((l) => l.startsWith("[office]")).join("\n") + "\n");

if (!fs.existsSync(reportPath)) {
  console.error("blender produced no report — stderr tail:");
  console.error((res.stderr ?? "").slice(-2000));
  process.exit(1);
}
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));

let bad = 0;
const fail = (m) => { console.error(`FAIL  ${m}`); bad++; };

if (!fs.existsSync(OUT)) { fail(`no GLB at ${OUT}`); process.exit(1); }
const gltf = readGlbJson(OUT);
const sizeMb = fs.statSync(OUT).size / 1024 / 1024;
const meshes = gltf.meshes?.length ?? 0;
const images = gltf.images?.length ?? 0;
const materials = gltf.materials?.length ?? 0;

console.log(
  `\n${meshes} mesh(es), ${materials} material(s), ${images} embedded image(s), ${sizeMb.toFixed(2)} MB`,
);
console.log(`seats: ${report.seats} anchors -> ${path.basename(SEATS)}`);

// The whole point of the join: a 4,152-draw-call scene is the failure mode.
if (meshes > 32) fail(`${meshes} meshes — the material join did not collapse the level`);
if (materials === 0) fail("no materials survived export");
// An untextured Synty building is flat grey; the relink is what prevents that.
if (images === 0) fail("no textures embedded — the atlas relink failed");
for (const m of report.textures_missing ?? []) console.error(`  WARN unresolved texture: ${m.image} (${m.was})`);
for (const e of report.join_errors ?? []) fail(`join: ${e}`);
if (!report.seats) fail("no seat anchors captured — SEAT_PREFIXES matched nothing");

const hermes = path.resolve("public/hermes3d/hermes.glb");
if (fs.existsSync(hermes)) {
  const total = (fs.statSync(hermes).size + fs.statSync(OUT).size) / 1024 / 1024;
  console.log(`public/hermes3d total: ${total.toFixed(2)} MB`);
}

console.log(bad === 0 ? "\nALL PASS" : `\n${bad} FAILURE(S)`);
process.exit(bad === 0 ? 0 : 1);
