// S35 Agent faces: a Rorschach-style mark for every agent that has no hand-drawn one.
//
// Owner 2026-10-01: "each agent should be getting a rorschach type shape, like Codex
// and Claude currently have." The hand-drawn marks in components/AgentAvatar.tsx stay
// exactly as they are (HAND_DRAWN_AGENT_IDS below is that list); every other agent id
// gets a generated inkblot: smooth blob paths with mirror symmetry about the vertical
// axis of a 24x24 viewBox, drawn in white on an accent gradient derived from the id.
//
// Deterministic by construction: the only randomness is mulberry32 seeded from the
// agent id (FNV-1a), or from a stored per-agent seed when the owner pressed "New shape"
// (settings.agents.faces.seeds, see lib/v2/agentFaces/seeds.ts). Nothing here reads a
// clock or Math.random, so a mark never changes on its own. The colour comes from the
// id alone, so a re-roll changes the shape and keeps the agent's accent.
//
// Pure module: no node imports, so the client avatar, the API route and the smoke all
// use the same code. smoke-agent-faces.mjs checks determinism and symmetry on the
// path data this file emits.

export const MARK_VIEWBOX = 24;
const AXIS = MARK_VIEWBOX / 2;

export type FaceDetail = "low" | "medium" | "high";
export const FACE_DETAILS: readonly FaceDetail[] = ["low", "medium", "high"];
export const DEFAULT_FACE_DETAIL: FaceDetail = "medium";
export const FACE_DETAIL_LABEL: Record<FaceDetail, string> = {
  low: "Low (two lobes, one spot pair)",
  medium: "Medium (three lobes, two spot pairs)",
  high: "High (four lobes, three spot pairs)",
};

/** The agents whose marks are hand-drawn in components/AgentAvatar.tsx (STYLE keys). */
export const HAND_DRAWN_AGENT_IDS = [
  "claude", "openclaw", "hermes", "gemini", "antigravity", "fcc", "codex",
  "cursor", "pi", "ollama", "kimi", "glm", "grok",
] as const;

export function hasHandDrawnMark(id: string): boolean {
  return (HAND_DRAWN_AGENT_IDS as readonly string[]).includes(id);
}

/** FNV-1a 32-bit over the UTF-16 code units of the id; unsigned. */
export function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Small, fast, well-distributed PRNG; the same seed always yields the same stream. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The seed a mark is drawn from: the stored override when it is a finite number, else the id's hash. */
export function faceSeedFor(id: string, override?: number | null): number {
  return typeof override === "number" && Number.isFinite(override) ? Math.floor(override) >>> 0 : hashId(id);
}

export interface MarkSpot { cx: number; cy: number; r: number }

export interface AgentMark {
  id: string;
  /** The seed the shape was drawn from. */
  seed: number;
  /** True when the seed is the id's own hash (no "New shape" override stored). */
  derived: boolean;
  detail: FaceDetail;
  viewBox: string;
  /** Closed, mirror-symmetric blob paths (SVG `d`), drawn white. */
  paths: string[];
  /** Ink spots; every off-axis spot has its mirror twin in the list. */
  spots: MarkSpot[];
  /** Hue 0-359 from the id alone (stable across re-rolls). */
  hue: number;
  accent: string;
  /** Translucent accent for chips and tints (the `bg` of the hand-drawn styles). */
  bg: string;
  gradient: string;
}

const LOBES: Record<FaceDetail, number> = { low: 2, medium: 3, high: 4 };
const SPOT_PAIRS: Record<FaceDetail, number> = { low: 1, medium: 2, high: 3 };

type Pt = { x: number; y: number };

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const fmt = (n: number) => String(round2(n));
/** Mirror about the vertical axis; applied to already-rounded values so both sides print identically. */
const mirrorX = (x: number) => round2(MARK_VIEWBOX - x);

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * One blob: K+1 points on the right half from the top axis point to the bottom axis
 * point, smoothed with Catmull-Rom tangents (the tangent at each axis point uses the
 * mirrored neighbour, so the curve crosses the axis smoothly), then the left half is
 * the same segments mirrored and walked back. The result is symmetric by construction.
 */
function blobPath(rnd: () => number): string {
  const cy = lerp(8, 16, rnd());
  const rx = lerp(3.2, 8.4, rnd());
  const ry = lerp(3.0, 7.0, rnd());
  const k = 4 + Math.floor(rnd() * 3); // 4..6 half-points between the axis points
  const pts: Pt[] = [];
  for (let i = 0; i <= k; i++) {
    const theta = -Math.PI / 2 + (i / k) * Math.PI;
    const jitter = lerp(0.65, 1.35, rnd());
    const onAxis = i === 0 || i === k;
    const x = onAxis ? AXIS : AXIS + rx * Math.cos(theta) * jitter;
    const y = cy + ry * Math.sin(theta) * (onAxis ? lerp(0.85, 1.15, rnd()) : jitter);
    pts.push({ x: round2(clamp(x, AXIS, MARK_VIEWBOX - 0.6)), y: round2(clamp(y, 0.8, MARK_VIEWBOX - 0.8)) });
  }
  const mirror = (p: Pt): Pt => ({ x: mirrorX(p.x), y: p.y });
  const at = (i: number): Pt => (i < 0 ? mirror(pts[-i]) : i > k ? mirror(pts[2 * k - i]) : pts[i]);
  type Seg = { c1: Pt; c2: Pt; to: Pt; from: Pt };
  const segs: Seg[] = [];
  for (let i = 0; i < k; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const c1 = { x: round2(p1.x + (p2.x - p0.x) / 6), y: round2(p1.y + (p2.y - p0.y) / 6) };
    const c2 = { x: round2(p2.x - (p3.x - p1.x) / 6), y: round2(p2.y - (p3.y - p1.y) / 6) };
    segs.push({ from: p1, c1, c2, to: p2 });
  }
  const P = (p: Pt) => `${fmt(p.x)} ${fmt(p.y)}`;
  let d = `M ${P(pts[0])}`;
  for (const s of segs) d += ` C ${P(s.c1)} ${P(s.c2)} ${P(s.to)}`;
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    d += ` C ${P(mirror(s.c2))} ${P(mirror(s.c1))} ${P(mirror(s.from))}`;
  }
  return d + " Z";
}

function spots(rnd: () => number, pairs: number): MarkSpot[] {
  const out: MarkSpot[] = [];
  for (let i = 0; i < pairs; i++) {
    const cx = round2(lerp(AXIS + 1.5, MARK_VIEWBOX - 2.2, rnd()));
    const cy = round2(lerp(2.2, MARK_VIEWBOX - 2.2, rnd()));
    const r = round2(lerp(0.5, 1.4, rnd()));
    out.push({ cx, cy, r }, { cx: mirrorX(cx), cy, r });
  }
  // One spot on the axis half the time: its own mirror image.
  if (rnd() < 0.5) out.push({ cx: AXIS, cy: round2(lerp(2.5, MARK_VIEWBOX - 2.5, rnd())), r: round2(lerp(0.6, 1.3, rnd())) });
  return out;
}

export function normalizeFaceDetail(v: unknown): FaceDetail {
  return (FACE_DETAILS as readonly string[]).includes(String(v)) ? (v as FaceDetail) : DEFAULT_FACE_DETAIL;
}

/** Colour from the id alone: an accent and the gradient the white mark sits on. */
export function accentFor(id: string): { hue: number; accent: string; bg: string; gradient: string } {
  const hue = hashId(`${id}:hue`) % 360;
  const accent = `hsl(${hue} 70% 64%)`;
  const bg = `hsl(${hue} 70% 64% / 0.18)`;
  const gradient = `linear-gradient(135deg, hsl(${hue} 72% 70%), hsl(${(hue + 26) % 360} 64% 36%))`;
  return { hue, accent, bg, gradient };
}

export function generateMark(id: string, opts: { seed?: number | null; detail?: FaceDetail | string } = {}): AgentMark {
  const safeId = String(id ?? "").trim() || "agent";
  const detail = normalizeFaceDetail(opts.detail);
  const seed = faceSeedFor(safeId, opts.seed);
  const rnd = mulberry32(seed);
  const paths: string[] = [];
  for (let i = 0; i < LOBES[detail]; i++) paths.push(blobPath(rnd));
  const colour = accentFor(safeId);
  return {
    id: safeId,
    seed,
    derived: seed === hashId(safeId),
    detail,
    viewBox: `0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`,
    paths,
    spots: spots(rnd, SPOT_PAIRS[detail]),
    ...colour,
  };
}

/** Every coordinate pair in a path's `d`, in order (for the symmetry check and tests). */
export function pathPoints(d: string): Pt[] {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const out: Pt[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push({ x: nums[i], y: nums[i + 1] });
  return out;
}

/** True when every point has a mirror twin (x -> 24 - x, same y) within `eps`. */
export function isMirrorSymmetric(mark: Pick<AgentMark, "paths" | "spots">, eps = 1e-6): boolean {
  const twin = (pts: Pt[], p: Pt) => pts.some((q) => Math.abs(q.x - (MARK_VIEWBOX - p.x)) <= eps && Math.abs(q.y - p.y) <= eps);
  for (const d of mark.paths) {
    const pts = pathPoints(d);
    if (pts.length === 0) return false;
    if (!pts.every((p) => twin(pts, p))) return false;
  }
  const sp = mark.spots.map((s) => ({ x: s.cx, y: s.cy }));
  return sp.every((p) => twin(sp, p));
}
