// SPEC-F L3.1 — the Hermes 3D asset + data-layer smoke.
//
// Run: npx tsx scripts/v2/smoke-hermes3d.mjs
//
// Reads the BAKED ARTIFACTS, not a build report: every claim about what sits
// inside a GLB is checked by parsing that GLB's own JSON chunk. The pure-data
// assertions (pools, character assignment, run mapping) need no Blender and no
// browser, so this stays runnable in CI where neither exists.
import fs from "node:fs";
import path from "node:path";
import { readGlbJson, clipNames } from "./hermes3d/glb.mjs";

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : extra ? `  [${extra}]` : ""}`);
  if (!cond) failures++;
};

const {
  CLIP_SOURCES, DEFAULT_CLIP_POOLS, CHARACTERS, CHARACTER_ATLAS,
  HERMES_STATES, resolveClip, characterFor, mapRunToState,
} = await import("../../src/lib/v2/hermes3d/clips.ts");

const DIR = path.resolve("public/hermes3d");
const CLIPS = path.join(DIR, "hermes-clips.glb");
const OFFICE = path.join(DIR, "office.glb");
const CHARDIR = path.join(DIR, "characters");
const baked = fs.existsSync(CLIPS);

// ── §A baked assets ──────────────────────────────────────────────────────────
console.log("\n── §A baked assets ──");
if (!baked) {
  console.log("SKIP  assets not baked — run scripts/v2/hermes3d/bake*.mjs");
} else {
  const clips = clipNames(CLIPS);
  check("A1 every catalog clip is in the GLB",
    CLIP_SOURCES.every((c) => clips.includes(c.slug)),
    CLIP_SOURCES.filter((c) => !clips.includes(c.slug)).map((c) => c.slug).join(","));
  check("A2 the GLB holds no clip the catalog does not name",
    clips.every((n) => CLIP_SOURCES.some((c) => c.slug === n)));

  // The clip library must NOT carry a body. Characters are separate files; a
  // mesh here would mean the animation set gets duplicated per character.
  const cg = readGlbJson(CLIPS);
  check("A3 the clip library carries no mesh", (cg.meshes ?? []).length === 0,
    String((cg.meshes ?? []).length));

  // Mixamo pads every download to a fixed timeline. Near-identical durations
  // across the set is the signature of the trim having silently broken.
  const durs = cg.animations.map((a) =>
    Math.max(0, ...a.samplers.map((s) => cg.accessors[s.input]?.max?.[0] ?? 0)));
  const distinct = new Set(durs.map((d) => d.toFixed(2))).size;
  check("A4 clips have distinct durations (Mixamo padding was trimmed)",
    distinct > durs.length * 0.8, `${distinct}/${durs.length} distinct`);

  const og = readGlbJson(OFFICE);
  check("A5 the office collapsed to a handful of meshes", (og.meshes ?? []).length <= 32,
    String((og.meshes ?? []).length));
  check("A6 the office is textured (the atlas relink held)", (og.images ?? []).length > 0);
  // 1,876 of the source objects are UCX_ collision hulls. Unreal hides them by
  // convention; a renderer has no such convention and draws them as boxes.
  const proxies = (og.meshes ?? []).map((m) => m.name ?? "")
    .filter((n) => /^(UCX|UBX|USP|UCP|MCDCX)_/.test(n));
  check("A7 no Unreal collision proxies survived into the office",
    proxies.length === 0, proxies.join(","));
  check("A8 seat anchors exist for placing characters",
    fs.existsSync(path.join(DIR, "office-seats.json")));
}

// ── §B characters ────────────────────────────────────────────────────────────
console.log("\n── §B characters ──");
if (!fs.existsSync(CHARDIR)) {
  console.log("SKIP  characters not baked");
} else {
  let clipJoints = null;
  if (baked) {
    const cg = readGlbJson(CLIPS);
    clipJoints = new Set((cg.skins ?? []).flatMap((s) => s.joints.map((j) => cg.nodes[j]?.name)));
  }
  const missingJoints = [];
  const withAnims = [];
  const withTex = [];
  for (const slug of CHARACTERS) {
    const f = path.join(CHARDIR, `${slug}.glb`);
    if (!fs.existsSync(f)) continue;
    const g = readGlbJson(f);
    if ((g.animations ?? []).length) withAnims.push(slug);
    if ((g.images ?? []).length) withTex.push(slug);
    if (clipJoints) {
      const js = new Set((g.skins ?? []).flatMap((s) => s.joints.map((j) => g.nodes[j]?.name)));
      const miss = [...clipJoints].filter((j) => !js.has(j));
      if (miss.length) missingJoints.push(`${slug}:${miss.length}`);
    }
  }
  check("B1 every catalog character is baked",
    CHARACTERS.every((s) => fs.existsSync(path.join(CHARDIR, `${s}.glb`))),
    CHARACTERS.filter((s) => !fs.existsSync(path.join(CHARDIR, `${s}.glb`))).join(","));
  // A character missing a targeted joint does not error: three.js silently
  // drops those tracks and the limb freezes mid-pose.
  check("B2 every character is a joint superset of the clips",
    missingJoints.length === 0, missingJoints.join(","));
  check("B3 no character embeds animations (they belong in ONE file)",
    withAnims.length === 0, withAnims.join(","));
  check("B4 no character embeds the shared atlas", withTex.length === 0, withTex.join(","));
  check("B5 the shared atlas is present", fs.existsSync(path.join(CHARDIR, CHARACTER_ATLAS)));
}

// ── §C clip pools ────────────────────────────────────────────────────────────
console.log("\n── §C clip pools ──");
const slugs = CLIP_SOURCES.map((c) => c.slug);
check("C1 every state has a pool",
  HERMES_STATES.every((s) => (DEFAULT_CLIP_POOLS[s] ?? []).length > 0),
  HERMES_STATES.filter((s) => !(DEFAULT_CLIP_POOLS[s] ?? []).length).join(","));
const dangling = Object.entries(DEFAULT_CLIP_POOLS)
  .flatMap(([st, pool]) => pool.filter((c) => !slugs.includes(c)).map((c) => `${st}:${c}`));
check("C2 no pool references a clip the catalog does not define",
  dangling.length === 0, dangling.join(","));
// A seated clip in a standing pool pops the character between poses mid-scene.
const seated = new Set(CLIP_SOURCES.filter((c) => c.seated).map((c) => c.slug));
const seatedInPools = Object.entries(DEFAULT_CLIP_POOLS)
  .flatMap(([st, pool]) => pool.filter((c) => seated.has(c)).map((c) => `${st}:${c}`));
check("C3 no seated clip leaked into a default pool",
  seatedInPools.length === 0, seatedInPools.join(","));
// The milling requirement: a finished run must stop miming desk work.
const work = new Set(DEFAULT_CLIP_POOLS.working);
check("C4 idle (milling) shares no clip with working",
  !DEFAULT_CLIP_POOLS.idle.some((c) => work.has(c)));
check("C5 idle has enough variety to not read as a loop",
  DEFAULT_CLIP_POOLS.idle.length >= 3, String(DEFAULT_CLIP_POOLS.idle.length));

// ── §D resolveClip ───────────────────────────────────────────────────────────
console.log("\n── §D resolveClip ──");
check("D1 picks from the pool", DEFAULT_CLIP_POOLS.thinking.includes(resolveClip("thinking", slugs)));
check("D2 an unbaked pool entry is filtered out, not returned",
  resolveClip("idle", slugs, { idle: ["does-not-exist", "idle-stretch"] }) === "idle-stretch");
check("D3 an entirely bogus pool falls back rather than returning null",
  resolveClip("idle", slugs, { idle: ["nope"] }) === slugs[0]);
check("D4 no clips available yields null (never a fabricated name)",
  resolveClip("idle", []) === null);
check("D5 the picker is injectable for determinism",
  resolveClip("talking", slugs, {}, () => 0) === DEFAULT_CLIP_POOLS.talking[0]);
check("D6 an out-of-range picker is clamped, not undefined",
  typeof resolveClip("talking", slugs, {}, () => 999) === "string");

// ── §E per-agent characters ──────────────────────────────────────────────────
console.log("\n── §E characterFor ──");
check("E1 stable for the same agent id", characterFor("agent-alpha") === characterFor("agent-alpha"));
check("E2 returns a real catalog slug", CHARACTERS.includes(characterFor("agent-alpha")));
const taken = [characterFor("a")];
check("E3 exclude walks to a different body", characterFor("a", taken) !== taken[0]);
const roster = [];
for (const id of ["a", "b", "c", "d", "e", "f"]) roster.push(characterFor(id, roster));
check("E4 a roster gets distinct looks", new Set(roster).size === roster.length, roster.join(","));

// ── §F run lifecycle → animation ─────────────────────────────────────────────
console.log("\n── §F mapRunToState ──");
check("F1 waiting on a human is its own state", mapRunToState("waiting") === "waiting");
check("F2 running a tool is working", mapRunToState("running", "tool") === "working");
check("F3 streaming text is talking", mapRunToState("running", "text") === "talking");
check("F4 running with no signal yet is thinking", mapRunToState("running", "init") === "thinking");
// The honesty rule. A finished run must not keep animating work — that is the
// fake-telemetry pattern, just rendered in 3D.
check("F5 done mills (idle), it does not keep working", mapRunToState("done") === "idle");
check("F6 killed mills", mapRunToState("killed") === "idle");
check("F7 error mills rather than faking activity", mapRunToState("error") === "idle");
check("F8 no run at all mills", mapRunToState(null) === "idle");
check("F9 every mapped state resolves to a real clip",
  ["running", "waiting", "done", "error", "killed", null]
    .every((s) => resolveClip(mapRunToState(s), slugs) !== null));

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
