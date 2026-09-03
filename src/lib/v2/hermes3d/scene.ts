// SPEC-F L2 — the data side of the Hermes 3D scene: where the baked assets
// live, what the page says when they are not there, and which seats get a body.
//
// No three.js here on purpose. The browser component (HermesOffice.tsx) is
// dynamic-imported with ssr:false and never runs under tsx, so everything a
// smoke needs to assert lives in this file instead.

/** URLs the browser fetches. public/hermes3d/ is gitignored (derived from the
 *  Synty packs on E:), so every one of these can legitimately be a 404. */
export const HERMES3D_ASSETS = {
  office: "/hermes3d/office.glb",
  clips: "/hermes3d/hermes-clips.glb",
  seats: "/hermes3d/office-seats.json",
  characters: "/hermes3d/characters",
  atlas: "/hermes3d/characters/PolygonOffice_Texture_01_A.png",
} as const;

/** Shown in place of the canvas when office.glb is missing. Names the doc that
 *  rebuilds the directory so the fix is one hop away, not a search. */
export const MISSING_ASSETS_MESSAGE =
  "Hermes 3D assets not baked: public/hermes3d/office.glb is missing. " +
  "The directory is gitignored and rebuilt from the Synty source packs; " +
  "see _design/hermes3d/PIPELINE.md.";

/** One row of office-seats.json, captured by bake-office.mjs before the join. */
export interface SeatAnchor {
  name: string;
  kind: string;
  /** +Y-up glTF metres. */
  pos: [number, number, number];
  /** Yaw in radians. */
  rotY: number;
}

/** Seated idle clips from the catalog. Only these may play on a chair: the
 *  standing pools pop a seated body up through the desk. */
export const SEATED_IDLE_CLIPS = ["idle-sitting", "idle-sitting-2"] as const;

export function isSeatAnchor(x: unknown): x is SeatAnchor {
  if (!x || typeof x !== "object") return false;
  const a = x as Record<string, unknown>;
  return typeof a.name === "string" && typeof a.kind === "string"
    && Array.isArray(a.pos) && a.pos.length === 3 && a.pos.every((n) => typeof n === "number")
    && typeof a.rotY === "number";
}

/**
 * Pick `count` chairs to seat bodies on: the ones nearest the chairs' own
 * centroid, so the default camera has one cluster to look at instead of four
 * bodies in four corners of a 56 m floor. Deterministic on purpose, so a
 * reload seats the same chairs.
 */
export function pickSeats(anchors: readonly SeatAnchor[], count: number): SeatAnchor[] {
  const chairs = anchors.filter((a) => a.kind === "chair");
  if (chairs.length === 0 || count <= 0) return [];
  const cx = chairs.reduce((s, a) => s + a.pos[0], 0) / chairs.length;
  const cz = chairs.reduce((s, a) => s + a.pos[2], 0) / chairs.length;
  const d2 = (a: SeatAnchor) => (a.pos[0] - cx) ** 2 + (a.pos[2] - cz) ** 2;
  return [...chairs].sort((a, b) => d2(a) - d2(b) || a.name.localeCompare(b.name)).slice(0, count);
}
