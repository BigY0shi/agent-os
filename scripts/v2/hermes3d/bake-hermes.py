# SPEC-F L1.3 — bake hermes.glb from the Synty character + Mixamo clip library.
#
# Run through scripts/v2/hermes3d/bake.mjs, not directly.
#
# Why this is scriptable at all: office_boss was uploaded to Mixamo ALREADY
# RIGGED, so Mixamo retargeted onto our skeleton instead of stamping its own
# `mixamorig:` names on top. Every one of the 26 FBX files therefore shares one
# bone naming scheme (root `Pelvis`, `UpperArm_L/R`), and an action binds to the
# primary armature by name. There is no rig retargeting to do here.
#
# Verified against Blender 5.2.1 LTS: actions are SLOTTED (action.fcurves is
# gone; curves live at action.layers[].strips[].channelbags[].fcurves), and the
# glTF exporter takes export_animation_mode='ACTIONS'.
import bpy, sys, json, pathlib, argparse

def log(m): print(f"[bake] {m}", flush=True)

def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--src", required=True)      # Office Animations dir
    p.add_argument("--catalog", required=True)  # JSON [{slug,file},...]
    p.add_argument("--donor", required=True)    # filename carrying the mesh
    p.add_argument("--out", required=True)      # hermes.glb
    p.add_argument("--report", required=True)
    return p.parse_args(argv)

def wipe():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def import_fbx(path):
    """Import one FBX; return (new_objects, new_actions)."""
    before_o = set(bpy.data.objects)
    before_a = set(bpy.data.actions)
    bpy.ops.import_scene.fbx(
        filepath=str(path),
        use_anim=True,
        # Mixamo/Synty rigs already carry sane bone rolls; letting Blender
        # re-derive orientation is what classically twists the skeleton.
        automatic_bone_orientation=False,
        ignore_leaf_bones=True,
        global_scale=1.0,
    )
    return (list(set(bpy.data.objects) - before_o), list(set(bpy.data.actions) - before_a))

def curve_count(act):
    """Slotted-action curve count (Blender 4.4+/5.x). action.fcurves is gone."""
    n = 0
    for layer in act.layers:
        for strip in layer.strips:
            for cb in getattr(strip, "channelbags", []):
                n += len(cb.fcurves)
    return n

def trim(act):
    """Mixamo pads every download to a fixed timeline; clamp the action to the
    frames its curves actually cover so the clip does not end in dead air."""
    lo, hi = act.curve_frame_range
    if hi > lo:
        act.use_frame_range = True
        act.frame_start, act.frame_end = lo, hi
    return (round(lo, 2), round(hi, 2))

def bind(arm, act):
    """Make `act` play on `arm`, binding a slot explicitly when 5.x does not
    pick one itself (an unbound slot exports as an empty animation)."""
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = act
    if getattr(arm.animation_data, "action_slot", None) is None and len(act.slots):
        for slot in act.slots:
            try:
                arm.animation_data.action_slot = slot
                break
            except Exception:
                continue
    return getattr(arm.animation_data, "action_slot", None) is not None

def main():
    a = parse_args()
    src = pathlib.Path(a.src)
    catalog = json.loads(pathlib.Path(a.catalog).read_text(encoding="utf-8"))
    by_file = {c["file"]: c["slug"] for c in catalog}
    report = {"clips": [], "errors": [], "skipped": []}

    wipe()

    donor_path = src / a.donor
    if not donor_path.exists():
        report["errors"].append(f"mesh donor missing: {donor_path}")
        pathlib.Path(a.report).write_text(json.dumps(report, indent=1)); return
    log(f"mesh donor: {a.donor}")
    objs, acts = import_fbx(donor_path)

    arm = next((o for o in objs if o.type == "ARMATURE"), None)
    meshes = [o for o in objs if o.type == "MESH"]
    if arm is None:
        report["errors"].append("no armature in the mesh donor")
        pathlib.Path(a.report).write_text(json.dumps(report, indent=1)); return
    arm.name = "HermesRig"
    report["mesh_objects"] = [m.name for m in meshes]
    report["bones"] = len(arm.data.bones)
    log(f"rig: {report['bones']} bones, {len(meshes)} mesh object(s)")

    def adopt(act, slug):
        act.name = slug
        # 0-user actions are purged before export; a fake user pins them.
        act.use_fake_user = True
        rng = trim(act)
        bound = bind(arm, act)
        report["clips"].append(
            {"slug": slug, "frames": rng, "curves": curve_count(act), "bound": bound}
        )

    for act in acts:
        adopt(act, by_file[a.donor])

    for entry in catalog:
        fname = entry["file"]
        if fname == a.donor:
            continue
        path = src / fname
        if not path.exists():
            report["skipped"].append(fname); continue
        keep_o = set(bpy.data.objects)
        try:
            new_objs, new_acts = import_fbx(path)
        except Exception as e:
            report["errors"].append(f"{fname}: {e!r}"); continue
        for act in new_acts:
            adopt(act, entry["slug"])
        # Drop the duplicate rig/mesh this file brought; the ACTION is the payload.
        for o in set(bpy.data.objects) - keep_o:
            bpy.data.objects.remove(o, do_unlink=True)
        log(f"+ {entry['slug']}")

    # Leave a deterministic action active so ACTIVE_ACTIONS-style fallbacks and
    # a human opening the .blend both land somewhere sensible.
    for act in bpy.data.actions:
        if act.name == "idle-standing-main":
            bind(arm, act); break

    # Drop the mesh: this file is the CLIP LIBRARY, not a character. The mesh
    # Mixamo returned is untextured anyway (0 images, 0.04 MB), and characters
    # come from bake-characters.mjs as separate geometry-only GLBs. The armature
    # must stay — glTF animation tracks target its nodes by name.
    for m in [o for o in bpy.data.objects if o.type == "MESH"]:
        bpy.data.objects.remove(m, do_unlink=True)
    log("dropped mesh — exporting clips only")

    pathlib.Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(a.out),
        export_format="GLB",
        export_yup=True,
        export_animations=True,
        export_animation_mode="ACTIONS",   # every action -> its own glTF animation
        export_bake_animation=True,
        export_optimize_animation_size=True,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
    )
    report["out"] = a.out
    report["out_bytes"] = pathlib.Path(a.out).stat().st_size if pathlib.Path(a.out).exists() else 0
    pathlib.Path(a.report).write_text(json.dumps(report, indent=1))
    log(f"exported {report['out_bytes']} bytes")

main()
