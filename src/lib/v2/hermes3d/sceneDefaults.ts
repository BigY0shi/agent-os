// What the scene assumes when settings.hermes3d is partial. Mirrors
// DEFAULT_SETTINGS.hermes3d in src/lib/settings.ts (which spreads this so the
// two cannot drift). Kept apart from scene.ts only so the gear imports a tiny
// module.
export const DEFAULT_HERMES3D = {
  showFps: false,
  shadows: false,
  talkingHoldMs: 4000,
  quality: "full" as const,
  seatedCount: 4,
};
