// SPEC-F L1.3 driver: one mesh-only GLB per Synty character + the shared atlas.
// Run: npx tsx scripts/v2/hermes3d/bake-characters.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readGlbJson } from "./glb.mjs";

const { sanitizeSpawnEnv } = await import("../../../src/lib/spawnEnv.ts");

const ROOT = process.env.HERMES3D_OFFICE_SRC ?? "E:/Game Assets/SyntyStudio/Unreal/SourceFiles";
const SRC = path.join(ROOT, "Characters");
const TEXTURES = path.join(ROOT, "Textures");
const OUTDIR = path.resolve("public/hermes3d/characters");
const ATLAS = "PolygonOffice_Texture_01_A.png";
const BLENDER =
  process.env.BLENDER_BIN ??
  path.join(os.homedir(), "AppData/Local/Microsoft/WindowsApps/blender-launcher.exe");

if (!fs.existsSync(SRC)) { console.error(`characters dir not found: ${SRC}`); process.exit(1); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hermes3d-chars-"));
const reportPath = path.join(tmp, "report.json");

console.log(`baking characters from ${SRC}`);
const res = spawnSync(BLENDER, [
  "--background", "--factory-startup",
  "--python", path.resolve("scripts/v2/hermes3d/bake-characters.py"),
  "--", "--src", SRC, "--textures", TEXTURES, "--outdir", OUTDIR, "--report", reportPath,
], { encoding: "utf8", env: sanitizeSpawnEnv(process.env), timeout: 20 * 60_000 });
if (res.stdout) process.stdout.write(res.stdout.split("\n").filter((l) => l.startsWith("[chars]")).join("\n") + "\n");

if (!fs.existsSync(reportPath)) {
  console.error("blender produced no report — stderr tail:");
  console.error((res.stderr ?? "").slice(-2000));
  process.exit(1);
}
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));

// The atlas every character shares, copied out once rather than embedded 18x.
const atlasSrc = path.join(TEXTURES, ATLAS);
const atlasOut = path.join(OUTDIR, ATLAS);
if (fs.existsSync(atlasSrc)) fs.copyFileSync(atlasSrc, atlasOut);

let bad = 0;
const fail = (m) => { console.error(`FAIL  ${m}`); bad++; };
for (const e of report.errors ?? []) fail(e);

// Clips animate a 47-bone subset; a character must be a SUPERSET or binding
// silently drops tracks and limbs freeze mid-pose.
const clipsFile = path.resolve("public/hermes3d/hermes-clips.glb");
const legacy = path.resolve("public/hermes3d/hermes.glb");
const clipSrc = fs.existsSync(clipsFile) ? clipsFile : (fs.existsSync(legacy) ? legacy : null);
let clipJoints = null;
if (clipSrc) {
  const g = readGlbJson(clipSrc);
  clipJoints = new Set((g.skins ?? []).flatMap((s) => s.joints.map((j) => g.nodes[j]?.name)));
}

let total = 0;
for (const c of report.characters ?? []) {
  const f = path.join(OUTDIR, `${c.slug}.glb`);
  if (!fs.existsSync(f)) { fail(`${c.slug}: no GLB written`); continue; }
  total += fs.statSync(f).size;
  const g = readGlbJson(f);
  if ((g.animations ?? []).length) fail(`${c.slug}: animations embedded — clips must live in ONE file`);
  if ((g.images ?? []).length) fail(`${c.slug}: texture embedded — the atlas is meant to be shared`);
  if (!c.atlas) fail(`${c.slug}: atlas never relinked`);
  if (clipJoints) {
    const joints = new Set((g.skins ?? []).flatMap((s) => s.joints.map((j) => g.nodes[j]?.name)));
    const missing = [...clipJoints].filter((j) => !joints.has(j));
    if (missing.length) fail(`${c.slug}: missing ${missing.length} joint(s) the clips target: ${missing.slice(0, 5)}`);
  }
}
if (!fs.existsSync(atlasOut)) fail(`shared atlas not copied to ${atlasOut}`);

console.log(
  `\n${report.characters?.length ?? 0} characters, ${(total / 1024 / 1024).toFixed(2)} MB total` +
  ` + ${(fs.existsSync(atlasOut) ? fs.statSync(atlasOut).size / 1024 : 0).toFixed(0)} KB shared atlas`,
);
console.log(clipJoints ? `verified against ${path.basename(clipSrc)} (${clipJoints.size} animated joints)` : "WARN no clips file to verify joints against");
console.log(bad === 0 ? "\nALL PASS" : `\n${bad} FAILURE(S)`);
process.exit(bad === 0 ? 0 : 1);
