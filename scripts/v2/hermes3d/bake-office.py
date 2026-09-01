# SPEC-F L1.3 — bake office.glb from the Synty PolygonOffice demo level.
#
# Run through scripts/v2/hermes3d/bake-office.mjs, not directly.
#
# Office_Demo.fbx is a 56 x 38 m DEMO LEVEL, not a room: 4,152 mesh objects and
# ~430k triangles. Shipping it as-is would mean 4,152 draw calls. But Synty
# atlases the whole pack onto a handful of materials, so joining by material
# collapses it to a handful of meshes with no visual change at all.
#
# Two things this has to fix that a naive import does not:
#   1. The main atlas is UNLINKED. Materials point at a `_Working/..._New.psd`
#      authoring path that does not exist in the shipped pack, so the building
#      exports untextured. The real files sit in SourceFiles/Textures as PNG.
#   2. Joining destroys per-prop identity, so desk/chair placements are captured
#      to a sidecar BEFORE the join — that is the data a future multi-character
#      scene would need to seat anyone.
import bpy, sys, json, pathlib, argparse, collections
from mathutils import Vector

def log(m): print(f"[office] {m}", flush=True)

def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--fbx", required=True)
    p.add_argument("--textures", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--seats", required=True)
    p.add_argument("--report", required=True)
    return p.parse_args(argv)

def relink_textures(tex_dir, report):
    """Repoint every image Blender could not load at the shipped PNG.

    Synty's FBX records the artist's authoring path (a .psd under _Working that
    is not in the distributed pack). The delivered file has the same stem minus
    a `_New` suffix, with a real image extension."""
    fixed, missing = [], []
    for img in bpy.data.images:
        if img.has_data or not img.filepath:
            continue
        stem = pathlib.Path(bpy.path.abspath(img.filepath)).stem
        for cand_stem in (stem, stem.removesuffix("_New")):
            hit = None
            for ext in (".png", ".tga", ".jpg", ".jpeg"):
                p = tex_dir / f"{cand_stem}{ext}"
                if p.exists():
                    hit = p; break
            if hit:
                img.filepath = str(hit)
                try:
                    img.reload()
                except Exception:
                    pass
                fixed.append({"image": img.name, "now": hit.name, "loaded": img.has_data})
                break
        else:
            missing.append({"image": img.name, "was": img.filepath})
    report["textures_relinked"] = fixed
    report["textures_missing"] = missing

# Unreal collision-proxy prefixes. Office_Demo.fbx carries 1,876 of these
# (45% of all objects): invisible physics hulls that a game engine consumes and
# a renderer must not. Left in, they export as solid boxes wrapping every prop.
COLLISION_PREFIXES = ("UCX_", "UBX_", "USP_", "UCP_", "MCDCX_")

def strip_collision(report):
    doomed = [o for o in bpy.data.objects if o.name.startswith(COLLISION_PREFIXES)]
    for o in doomed:
        bpy.data.objects.remove(o, do_unlink=True)
    report["collision_removed"] = len(doomed)
    return len(doomed)

# Props a character could plausibly be seated at / standing near. Captured
# pre-join because after the join these objects no longer exist individually.
SEAT_PREFIXES = ("SM_Prop_Desk", "SM_Prop_Chair", "SM_Prop_Table", "SM_Prop_Computer")

def capture_seats(objs):
    seats = []
    for o in objs:
        if not o.name.startswith(SEAT_PREFIXES):
            continue
        w = o.matrix_world.translation
        seats.append({
            "name": o.name,
            "kind": o.name.split("_")[2].lower() if len(o.name.split("_")) > 2 else "prop",
            # +Y up to match the GLB export (export_yup=True), so these
            # coordinates drop straight into the r3f scene.
            "pos": [round(w.x, 3), round(w.z, 3), round(-w.y, 3)],
            "rotY": round(o.rotation_euler.z, 4),
        })
    seats.sort(key=lambda s: (s["kind"], s["name"]))
    return seats

def join_by_material(objs, report):
    groups = collections.defaultdict(list)
    for o in objs:
        key = o.data.materials[0].name if o.data.materials and o.data.materials[0] else "__none__"
        groups[key].append(o)
    made = []
    for key, members in groups.items():
        members = [m for m in members if m.name in bpy.data.objects]
        if not members:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for m in members:
            m.select_set(True)
        bpy.context.view_layer.objects.active = members[0]
        if len(members) > 1:
            try:
                bpy.ops.object.join()
            except Exception as e:
                report.setdefault("join_errors", []).append(f"{key}: {e!r}")
        members[0].name = f"Office_{key}"
        members[0].data.name = f"Office_{key}"
        made.append(members[0].name)
    return made

def main():
    a = parse_args()
    report = {}
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=a.fbx, use_anim=False, automatic_bone_orientation=False)

    report["objects_imported"] = len([o for o in bpy.data.objects if o.type == "MESH"])
    n = strip_collision(report)
    log(f"stripped {n} Unreal collision proxies")

    objs = [o for o in bpy.data.objects if o.type == "MESH"]
    report["objects_in"] = len(objs)
    report["tris_in"] = sum(len(p.vertices) - 2 for o in objs for p in o.data.polygons)
    log(f"imported {len(objs)} objects / {report['tris_in']:,} tris")

    relink_textures(pathlib.Path(a.textures), report)
    log(f"relinked {len(report['textures_relinked'])} texture(s), {len(report['textures_missing'])} still missing")

    seats = capture_seats(objs)
    pathlib.Path(a.seats).parent.mkdir(parents=True, exist_ok=True)
    pathlib.Path(a.seats).write_text(json.dumps(seats, indent=1))
    report["seats"] = len(seats)
    log(f"captured {len(seats)} seat/desk anchors")

    made = join_by_material(objs, report)
    report["objects_out"] = len([o for o in bpy.data.objects if o.type == "MESH"])
    report["meshes"] = made
    log(f"joined to {report['objects_out']} mesh(es)")

    pathlib.Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=a.out,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_animations=False,
        export_materials="EXPORT",
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
    )
    report["out_bytes"] = pathlib.Path(a.out).stat().st_size if pathlib.Path(a.out).exists() else 0
    pathlib.Path(a.report).write_text(json.dumps(report, indent=1))
    log(f"exported {report['out_bytes']:,} bytes")

main()
