// SPEC-F J1.1 — a stable colour per campaign.
//
// Colours identify a campaign wherever its items appear next to another
// campaign's: the detail tabs, and later the rollup calendar (J3.1) where two
// campaigns land pills on the same day. So the colour has to be STABLE for a
// slug and persisted — a hash recomputed per render would reshuffle the
// calendar every deploy, and a random pick would give two campaigns the same
// colour half the time.
//
// Client-safe: no imports, so both the server store and a component can use it.

/** Distinct at a glance and legible on the app's dark panels. */
export const CAMPAIGN_PALETTE = [
  "#ec4899", // pink — the Marketing accent, first so a lone campaign matches the module
  "#34d399", // emerald
  "#60a5fa", // blue
  "#fbbf24", // amber
  "#a78bfa", // violet
  "#fb923c", // orange
  "#2dd4bf", // teal
  "#f87171", // rose
] as const;

/**
 * Deterministic colour for a slug. FNV-1a — not for security, just a spread
 * that does not clump on the common prefixes real slugs share
 * ("q4-", "launch-", the three business names).
 */
export function colorFor(slug: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return CAMPAIGN_PALETTE[h % CAMPAIGN_PALETTE.length];
}
