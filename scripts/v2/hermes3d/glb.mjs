// Minimal GLB reader: pull the JSON chunk out of a .glb.
//
// Shared deliberately by the bake driver AND smoke-hermes3d, so the thing that
// verifies the asset is the same thing that reads it at build time. It also
// backs GET /api/hermes3d/clips, which means the settings gear can only offer
// clip names the asset really contains.
import fs from "node:fs";

const MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK = 0x4e4f534a; // "JSON"

export function readGlbJson(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 12) throw new Error(`${file}: too short to be a GLB`);
  if (buf.readUInt32LE(0) !== MAGIC) throw new Error(`${file}: bad GLB magic`);
  const total = buf.readUInt32LE(8);
  let off = 12;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const start = off + 8;
    if (type === JSON_CHUNK) return JSON.parse(buf.subarray(start, start + len).toString("utf8"));
    off = start + len;
  }
  throw new Error(`${file}: no JSON chunk in ${total} declared bytes`);
}

/** Animation clip names, in file order. */
export function clipNames(file) {
  const gltf = readGlbJson(file);
  return (gltf.animations ?? []).map((a, i) => a.name ?? `unnamed-${i}`);
}
