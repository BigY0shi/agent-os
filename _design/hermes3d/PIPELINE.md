# Hermes 3D asset pipeline

## Status

| Asset | State | Size |
|---|---|---|
| `public/hermes3d/hermes-clips.glb` | **baked** (26 clips, no mesh) | 7.38 MB |
| `public/hermes3d/characters/*.glb` | **baked** (18 characters) | 1.02 MB total |
| `public/hermes3d/characters/PolygonOffice_Texture_01_A.png` | shared atlas | 1.0 MB |
| `public/hermes3d/office.glb` | **baked** (3 meshes, automated) | 5.28 MB |
| `public/hermes3d/office-seats.json` | **baked** (149 anchors) | 20 KB |
| `public/hermes3d/draco/*` | not copied yet | ~700 KB |

Current total: **14.8 MB**, of which 18 characters cost 1.02 MB. The whole directory is gitignored — these are
derived artifacts, rebuilt from the source packs on `E:`.

SPEC-F L3 set a 15 MB cap. That number was a guess at web page-weight
discipline and does not survive contact with how this actually runs: the app is
self-hosted over localhost/LAN, so transfer cost is ~0, and the assets are not
in git. The metric that matters is **draw calls**, which is why the office bake
joins by material. Treat the cap as advisory.

## Why the character bake is automated

SPEC-F L1.3 assumed a human Blender pass to retarget Mixamo clips onto the Synty
rig. That assumption does not hold for how these assets were actually made:
**`office_boss` was uploaded to Mixamo already rigged**, so Mixamo retargeted onto
our skeleton instead of stamping `mixamorig:` names over it. Verified 2026-08-31 —
every one of the 26 FBX files exposes `Pelvis`, `Root`, `UpperArm_L/R`.

With one shared skeleton, importing an FBX binds its action to the existing
armature by bone name. There is nothing to retarget, so the whole character bake
is mechanical and runs headless.

## Running the bake

```powershell
npx tsx scripts/v2/hermes3d/bake.mjs
```

Overridable via env: `HERMES3D_SRC` (default `E:/Game Assets/SyntyStudio/Office Animations`),
`BLENDER_BIN` (default the Microsoft Store launcher under `WindowsApps`).

The driver shells Blender, then reads the exported GLB's own JSON chunk back and
verifies: all 26 slugs present, no unexpected clips, every clip referenced by a
default pool exists, every action bound to a slot with non-zero curves, and the
file under budget. A silently-empty animation list fails at bake time, not in
the browser.

## Toolchain

- **Blender 5.2.1 LTS**, Microsoft Store install. The raw `.exe` under
  `C:\Program Files\WindowsApps` is ACL-blocked; drive it through
  `%LOCALAPPDATA%\Microsoft\WindowsApps\blender-launcher.exe`.
- No FBX2glTF needed. Blender's own glTF exporter handles it, and going through
  Blender is what lets us merge 26 separate FBX files into one GLB.

## Gotchas

- **`action.fcurves` does not exist in Blender 5.x.** Actions are slotted; curves
  live at `action.layers[].strips[].channelbags[].fcurves`. Any snippet written
  for 4.x or earlier will silently find zero curves.
- **Store app execution aliases are invisible to `stat`.** `fs.existsSync` returns
  false for `blender-launcher.exe` even though `CreateProcess` resolves it fine.
  Do not gate the spawn on an existence check — this rejected a working Blender.
- **Mixamo pads every download to a fixed 250-frame timeline.** Untrimmed clips
  all end in dead air of the same length. The bake clamps each action to
  `curve_frame_range`. Sanity check: baked durations should be *distinct*
  (currently 25 distinct across 26 clips); if they are all ~8.33s the trim broke.
- **Actions with zero users get purged before export.** The bake sets
  `use_fake_user` on each one.
- **Only 5 of the 26 FBX files carry the mesh.** They were downloaded "with skin";
  the rest are bone-only. The mesh is identical in all five, so the bake imports
  `ThinkingShake.fbx` for geometry and takes only the *action* from every other
  file. See `MESH_DONOR_FILE` in `src/lib/v2/hermes3d/clips.ts`.
- **Do not mix seated and standing clips in one pool.** The character pops
  between poses mid-scene. Seated clips are baked but flagged `seated: true` and
  left out of the default pools.

## Clip naming

Blender names actions after their source file, which would put `Neutral Idle`
(space) and `Talking3` (stray digit) into a config file. `CLIP_SOURCES` in
`src/lib/v2/hermes3d/clips.ts` maps each source filename to a slug, and that
slug is the clip name in the GLB and the key in `settings.hermes3d.clips`.

The filename typos (`Thinkin2.fbx`, `Filing Cabinet Uppter.fbx`) are recorded
verbatim in the catalog because that is what is on disk. The slugs are corrected.

## Re-export checklist

1. Add or replace FBX files under the source dir.
2. Add a `{ slug, file }` entry to `CLIP_SOURCES`.
3. Add the slug to a pool in `DEFAULT_CLIP_POOLS` if it should ever play.
4. `npx tsx scripts/v2/hermes3d/bake.mjs` — it fails loudly on a mismatch.

## The office bake

```powershell
npx tsx scripts/v2/hermes3d/bake-office.mjs
```

Source: `E:/Game Assets/SyntyStudio/Unreal/SourceFiles/Office_Demo.fbx`
(override with `HERMES3D_OFFICE_SRC`).

This was also assumed to need a human. It does not, because `Office_Demo.fbx`
is a complete 56 x 38 m furnished level and Synty atlases the whole pack onto
9 materials. Joining by material collapses **4,152 objects to 3 meshes** with
no visual change, so no room assembly is required — the level already contains
far better rooms than anyone would build by hand.

### Office gotchas

- **1,876 of the 4,152 objects are `UCX_` collision proxies** — 45% of the
  scene. These are Unreal physics hulls that a game engine consumes invisibly;
  a renderer draws them as solid boxes wrapping every prop. The bake strips
  `UCX_`/`UBX_`/`USP_`/`UCP_`/`MCDCX_` before joining. If the office ever looks
  like it is full of grey crates, this filter regressed.
- **The main atlas ships unlinked.** Materials reference the artist's authoring
  path (`_Working/PolygonOffice_Texture_01_A_New.psd`), which is not in the
  distributed pack, so a naive import gives a flat-grey building. The bake
  repoints any image with `has_data == False` to `SourceFiles/Textures/<stem
  minus _New>.png`. The driver fails if zero images end up embedded.
- **glTF takes `mesh.name` from the DATA block, not the object.** Renaming only
  the object leaves the exported mesh named after whichever member the join
  happened to keep. The bake renames both.
- `Mat_PolygonOffice_Chrome` legitimately has no texture. Do not "fix" it.

### `office-seats.json`

Joining destroys per-prop identity, so desk/chair/table/computer world
positions are captured **before** the join into a sidecar: 149 anchors
(60 chairs, 54 computers, 18 desks, 11 tables). Positions are already in +Y-up
glTF space, so they drop straight into the r3f scene. Nothing consumes this
yet; it exists so a future multi-character scene has somewhere to seat people
without re-baking.


## The clips / characters split

Animation lives in `hermes-clips.glb` **once**. Characters are geometry-only
files under `characters/`. This is not a size micro-optimisation: a combined
file is 7.4 MB of which 99.4% is animation data, so baking clips into each body
would cost ~133 MB for 18 characters instead of ~8.4 MB.

It works because every rig is the same 55-bone Synty skeleton and the clips
animate a 47-bone subset of it (the bake imports clips with
`ignore_leaf_bones=True`, characters with it `False`). three.js binds animation
tracks by node name, so any clip plays on any character; the 8 unanimated leaf
bones (fingertips, toes) rest in bind pose.

```powershell
npx tsx scripts/v2/hermes3d/bake-characters.mjs
```

`smoke-hermes3d.mjs` §B enforces the invariant that makes this safe: every
character must be a joint **superset** of the clips. A character missing a
targeted joint does not raise — three.js drops those tracks and the limb
freezes mid-pose, which is the kind of bug you notice a week later.

### Why textures are not embedded

All 18 characters share one material (`PolygonOffice_Charaters`, Synty's typo)
on one atlas. Embedding would copy ~1 MB into each file and hand the GPU 18
identical textures. The bake exports with `export_image_format="NONE"` and the
atlas is copied out once, to be applied to every character material at runtime.

### The characters ship untextured from Blender

The six hand-exported GLBs on `E:` all had `images=0` — the same unlinked-`.psd`
problem as the office. That is why characters are baked from
`SourceFiles/Characters/SK_Chr_*.fbx` rather than reused: the bake relinks the
atlas. Anything exported from Blender without that step renders flat grey.

## State model

Animation state comes from AgentOS's own run lifecycle
(`RunStatus` + `RunEvent.kind` in `src/lib/agentsTypes.ts`), not from an
LLM-call hook. `mapRunToState` in `src/lib/v2/hermes3d/clips.ts`:

| run | animation state | pool |
|---|---|---|
| `waiting` (approval/question) | `waiting` | fidgety clips — reads as "needs you" |
| `running` + `tool`/`tool-result` | `working` | typing, fax, filing |
| `running` + `text`/`result` | `talking` | talking clips |
| `running`, otherwise | `thinking` | thinking clips |
| `done` / `error` / `killed` / no run | `idle` | milling, non-work clips |

The last row is the honesty rule and is asserted by smoke §F: a finished run
must **not** keep animating desk work. Faking activity for a run that ended is
the fake-telemetry pattern, rendered in 3D.

Characters are assigned per agent by `characterFor(agentId)`, an FNV-1a hash so
an agent keeps the same body across reloads and machines with nothing
persisted. Passing the already-assigned slugs spreads a roster across distinct
looks instead of cloning twins.
