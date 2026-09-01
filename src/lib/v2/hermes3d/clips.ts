// SPEC-F L — the animation clip catalog for the Hermes avatar.
//
// The original spec pinned the asset contract to three literal clip names
// (`Idle`/`Thinking`/`Talking`) that the GLB had to contain exactly. That made
// the .glb load-bearing on naming: changing which motion "thinking" used meant
// a re-export, and idle looped one clip forever.
//
// Instead the GLB is just a bag of clips, and BEHAVIOUR lives here as data. A
// state maps to a POOL; the scene samples one clip on entry to the state, so
// idle varies. Pools are overridable from settings.hermes3d.clips (rule 16),
// and settings' deepMerge replaces arrays wholesale — so a user-edited pool
// replaces the default rather than concatenating with it.
//
// Source assets: E:/Game Assets/SyntyStudio/Office Animations (26 Mixamo FBX,
// all sharing one Synty skeleton — root `Pelvis`, `UpperArm_L/R` — because the
// already-rigged office_boss was uploaded to Mixamo, so Mixamo retargeted onto
// OUR rig rather than stamping `mixamorig:` names on top). Verified 2026-08-31.

// Animation states, derived from AgentOS's OWN run lifecycle (RunStatus +
// RunEvent.kind in src/lib/agentsTypes.ts) rather than an LLM-call hook. See
// mapRunToState below.
//
// `idle` is the milling state: a run that has finished leaves its character
// wandering on NON-WORK clips instead of typing at a desk forever. That is the
// honest render for "nothing is happening", and it is the only state a
// character can be in without an active run.
export type HermesState = "idle" | "thinking" | "talking" | "working" | "waiting" | "offline";

export const HERMES_STATES: HermesState[] = [
  "idle", "thinking", "talking", "working", "waiting", "offline",
];

/** One baked clip: the slug that lands in the GLB, and the FBX it came from. */
export interface ClipSource {
  /** Clip name inside hermes.glb. Slugged deliberately — Blender otherwise
   *  names actions after the source file, giving us "Neutral Idle" (space) and
   *  "Talking3" (stray digit) as config keys. */
  slug: string;
  /** Filename under the Office Animations dir, verbatim including its typos. */
  file: string;
  /** Seated clips are excluded from the default pools: mixing them with
   *  standing clips in one pool pops the character between poses mid-scene. */
  seated?: boolean;
}

export const CLIP_SOURCES: ClipSource[] = [
  // — standing idles —
  { slug: "idle-standing-main", file: "Idle Standing Main.fbx" },
  { slug: "idle-standing-main-2", file: "Idle Standing Main 2.fbx" },
  { slug: "neutral-idle", file: "Neutral Idle.fbx" },
  { slug: "idle-stretch", file: "Idle Stretch.fbx" },
  { slug: "idle-nail-check", file: "Idle Nail Check.fbx" },
  { slug: "idle-fly-swat", file: "Idle Fly Swat.fbx" },
  // — thinking —
  { slug: "thinking-1", file: "Thinking 1.fbx" },
  { slug: "thinking-2", file: "Thinkin2.fbx" },
  { slug: "thinking-shake", file: "ThinkingShake.fbx" },
  // — talking —
  { slug: "talking-main", file: "TalkingMain.fbx" },
  { slug: "talking-1", file: "Talking 1.fbx" },
  { slug: "talking-2", file: "Talking 2.fbx" },
  { slug: "talking-3", file: "Talking3.fbx" },
  { slug: "talking-phone-pacing", file: "Talking on phone, pacing.fbx" },
  // — working (desk tasks) —
  { slug: "typing", file: "Typing.fbx" },
  { slug: "typing-start", file: "Typing Start.fbx" },
  { slug: "typing-to-sitting", file: "Typing to sitting.fbx", seated: true },
  { slug: "fax-send", file: "Fax Send.fbx" },
  { slug: "fax-send-2", file: "Fax Send 2.fbx" },
  { slug: "filing-cabinet-upper", file: "Filing Cabinet Uppter.fbx" },
  { slug: "filing-cabinet-lower", file: "Filing Cabinet lower.fbx" },
  // — seated (baked, but not pooled by default; see ClipSource.seated) —
  { slug: "idle-sitting", file: "Idle Siting.fbx", seated: true },
  { slug: "idle-sitting-2", file: "Idle Sitting 2.fbx", seated: true },
  { slug: "idle-laying", file: "Idle Laying.fbx", seated: true },
  { slug: "talking-sitting-meeting", file: "IdleTalking Sitting at meeting.fbx", seated: true },
  { slug: "idle-transition", file: "Idle Transition.fbx", seated: true },
];

/**
 * The clip that carries the MESH.
 *
 * Only 5 of the 26 FBX files were downloaded "with skin"; the rest are bone-only
 * action data. The mesh is identical in all 5, so the bake imports this one for
 * geometry + armature and every other file contributes its action alone.
 */
export const MESH_DONOR_FILE = "ThinkingShake.fbx";

/** Default state → eligible clips. Yoshi's picks lead each pool. */
export const DEFAULT_CLIP_POOLS: Record<HermesState, string[]> = {
  idle: [
    "idle-standing-main",
    "idle-standing-main-2",
    "neutral-idle",
    "idle-stretch",
    "idle-nail-check",
    "idle-fly-swat",
  ],
  thinking: ["thinking-1", "thinking-2", "thinking-shake"],
  talking: ["talking-main", "talking-1", "talking-2", "talking-3", "talking-phone-pacing"],
  working: ["typing", "typing-start", "fax-send", "fax-send-2", "filing-cabinet-upper", "filing-cabinet-lower"],
  // Blocked on a human. Deliberately the fidgety clips — a character that
  // looks impatient reads as "this one needs you" from across the room.
  waiting: ["idle-nail-check", "idle-fly-swat", "idle-stretch"],
  // Offline deliberately holds ONE clip: a "disconnected" avatar that keeps
  // shuffling motions reads as alive, which is the opposite of the signal.
  offline: ["idle-standing-main"],
};

/**
 * Pick a clip for `state`.
 *
 * `available` is what the GLB actually exposes, so a pool entry that was never
 * baked (or a typo in a user-edited pool) is filtered out rather than handed to
 * three.js as a missing clip. If nothing survives, callers get the first
 * available clip: a wrong animation beats a frozen T-pose.
 *
 * `pick` is injected so the scene can pass a seeded/round-robin chooser and the
 * smoke can pass a deterministic one. Defaults to uniform random.
 */
export function resolveClip(
  state: HermesState,
  available: readonly string[],
  pools: Partial<Record<HermesState, string[]>> = {},
  pick: (n: number) => number = (n) => Math.floor(Math.random() * n),
): string | null {
  if (available.length === 0) return null;
  const pool = (pools[state] ?? DEFAULT_CLIP_POOLS[state] ?? []).filter((c) => available.includes(c));
  if (pool.length === 0) return available[0];
  const i = Math.min(Math.max(pick(pool.length), 0), pool.length - 1);
  return pool[i];
}


// ── characters ───────────────────────────────────────────────────────────────
//
// Baked by scripts/v2/hermes3d/bake-characters.mjs into
// public/hermes3d/characters/<slug>.glb — geometry only, no clips, no embedded
// texture. All 18 share PolygonOffice_Texture_01_A.png, loaded once at runtime
// as a single GPU texture, and all carry the 55-bone Synty skeleton that is a
// superset of the 47 joints the clips animate.

export const CHARACTERS: string[] = [
  "boss-female-01", "boss-male-01",
  "business-female-01", "business-female-02", "business-female-03", "business-female-04",
  "business-male-01", "business-male-02", "business-male-03", "business-male-04",
  "cleaner-female-01", "cleaner-male-01",
  "developer-female-01", "developer-female-02", "developer-male-01", "developer-male-02",
  "security-female-01", "security-male-01",
];

/** The shared atlas, applied to every character material at runtime. */
export const CHARACTER_ATLAS = "PolygonOffice_Texture_01_A.png";

/** FNV-1a, same hash the marketing palette uses for stable per-slug colour. */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Which body an agent wears.
 *
 * Derived from the agent id, so an agent looks the same across reloads,
 * restarts and machines without persisting anything. `exclude` lets a caller
 * spread a roster across distinct looks — pass the already-assigned slugs and
 * a colliding agent walks to the next free one rather than cloning a twin.
 */
export function characterFor(agentId: string, exclude: readonly string[] = []): string {
  const start = fnv1a(agentId) % CHARACTERS.length;
  for (let i = 0; i < CHARACTERS.length; i++) {
    const candidate = CHARACTERS[(start + i) % CHARACTERS.length];
    if (!exclude.includes(candidate)) return candidate;
  }
  return CHARACTERS[start];
}

/**
 * Turn one run into an animation state.
 *
 * `status` and `lastEventKind` come straight off RunMeta / RunEvent
 * (src/lib/agentsTypes.ts) — this reads real lifecycle, and returns "idle"
 * when a run has ended rather than inventing activity. A dashboard that
 * animates work nobody is doing is worse than one that shows an empty chair.
 */
export function mapRunToState(
  status: "running" | "waiting" | "done" | "error" | "killed" | null | undefined,
  lastEventKind?: string | null,
): HermesState {
  // Blocked on a human: an approval or a question. The most actionable state
  // on the whole floor, so it gets its own look.
  if (status === "waiting") return "waiting";
  if (status === "running") {
    if (lastEventKind === "tool" || lastEventKind === "tool-result") return "working";
    if (lastEventKind === "text" || lastEventKind === "result") return "talking";
    return "thinking";
  }
  // done / error / killed / no run at all — the character mills.
  return "idle";
}
