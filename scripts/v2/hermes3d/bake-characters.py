# SPEC-F L1.3 — bake one mesh-only GLB per Synty office character.
#
# Run through scripts/v2/hermes3d/bake-characters.mjs.
#
# The split this implements: ANIMATION lives in hermes-clips.glb exactly once,
# CHARACTERS are geometry-only files. Baking clips into each character would
# duplicate ~6.7 MB of animation per body; 18 characters that way is ~120 MB for
# one set of motions. All 18 rigs are the same 55-bone Synty skeleton, and
# hermes-clips.glb animates a 47-bone subset of it, so three.js binds any clip
# to any character by node name.
#
# Textures are deliberately NOT embedded. Every character shares the single
# atlas PolygonOffice_Texture_01_A.png; embedding would copy ~1 MB per file and
# hand the GPU 18 identical textures. The atlas is copied out once and applied
# at runtime instead.
import bpy, sys, json, pathlib, argparse

def log(m): print(f"[chars] {m}", flush=True)

def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--src", required=True)       # Characters dir
    p.add_argument("--textures", required=True)
    p.add_argument("--outdir", required=True)
    p.add_argument("--report", required=True)
    return p.parse_args(argv)

def slugify(stem):
    """SK_Chr_Developer_Male_01 -> developer-male-01."""
    s = stem
    for prefix in ("SK_Chr_", "SK_", "Chr_"):
        if s.startswith(prefix):
            s = s[len(prefix):]
    return s.replace("_", "-").lower()

def relink(tex_dir, report_entry):
    """Same failure as the office: Synty ships materials pointing at a
    `_Working/..._New.psd` authoring path that is not in the pack. Repoint to
    the delivered PNG. Recorded even though images are not embedded, because a
    material with a dead image can still export a broken texture reference."""
    for img in bpy.data.images:
        if img.has_data or not img.filepath:
            continue
        stem = pathlib.Path(bpy.path.abspath(img.filepath)).stem
        for cand in (stem, stem.removesuffix("_New")):
            for ext in (".png", ".tga", ".jpg"):
                p = tex_dir / f"{cand}{ext}"
                if p.exists():
                    img.filepath = str(p)
                    try: img.reload()
                    except Exception: pass
                    report_entry["atlas"] = p.name
                    return
    report_entry["atlas"] = None

def main():
    a = parse_args()
    src, tex_dir, outdir = pathlib.Path(a.src), pathlib.Path(a.textures), pathlib.Path(a.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    report = {"characters": [], "errors": []}

    for fbx in sorted(src.glob("*.fbx")):
        slug = slugify(fbx.stem)
        entry = {"slug": slug, "source": fbx.name}
        try:
            bpy.ops.wm.read_factory_settings(use_empty=True)
            bpy.ops.import_scene.fbx(
                filepath=str(fbx), use_anim=False,
                automatic_bone_orientation=False,
                # NOT ignoring leaf bones here: the clips animate a 47-bone
                # subset and unanimated leaves simply rest in bind pose, but a
                # character MISSING bones the clips target would break binding.
                ignore_leaf_bones=False,
            )
            arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
            meshes = [o for o in bpy.data.objects if o.type == "MESH"]
            if arm is None or not meshes:
                report["errors"].append(f"{fbx.name}: armature={bool(arm)} meshes={len(meshes)}")
                continue
            relink(tex_dir, entry)
            entry["bones"] = len(arm.data.bones)
            entry["tris"] = sum(len(p.vertices) - 2 for m in meshes for p in m.data.polygons)

            out = outdir / f"{slug}.glb"
            bpy.ops.export_scene.gltf(
                filepath=str(out), export_format="GLB", export_yup=True,
                export_apply=True, export_animations=False,
                export_materials="EXPORT",
                export_image_format="NONE",   # shared atlas applied at runtime
                export_draco_mesh_compression_enable=True,
                export_draco_mesh_compression_level=6,
            )
            entry["bytes"] = out.stat().st_size if out.exists() else 0
            report["characters"].append(entry)
            log(f"+ {slug} ({entry['bones']} bones, {entry['bytes']:,} B)")
        except Exception as e:
            report["errors"].append(f"{fbx.name}: {e!r}")

    pathlib.Path(a.report).write_text(json.dumps(report, indent=1))
    log(f"{len(report['characters'])} characters, {len(report['errors'])} error(s)")

main()
