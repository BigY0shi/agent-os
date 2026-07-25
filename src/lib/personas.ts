// Nemotron Personas — synthetic-but-realistic human personas used to give the
// Agent Room's agents a *human* character for a chat, on top of their own identity.
//
// Source: nvidia/Nemotron-Personas-USA (CC BY 4.0), sampled via the HuggingFace
// datasets-server and trimmed to the fields a group chat actually needs. Bundled
// as JSON so the room works offline with no dataset dependency at runtime.
//
// Field keys are short to keep the payload small:
//   n = name · p = persona summary · pro = professional persona · o = occupation
//   a = age · l = location · h = hobbies · s = skills
//
// NOTE: server-side only. Don't import this from a client component — it would ship
// the whole dataset in the browser bundle. The UI gets personas from /api/room/personas.
import DATA from "@/data/nemotron-personas.json";

export interface Persona {
  n: string;
  p: string;
  pro?: string;
  o?: string;
  a?: number;
  l?: string;
  h?: string;
  s?: string;
}

const PERSONAS = DATA as Persona[];

export function personaCount(): number {
  return PERSONAS.length;
}

/** Pretty occupation — the dataset uses snake_case codes like "fast_food_or_counter_worker". */
export function occupationLabel(p: Persona): string {
  if (!p.o) return "";
  return p.o.replace(/_or_/g, " / ").replace(/_/g, " ");
}

/** A one-line label for chips/tooltips: "Mary Alberti · 28 · cashier". */
export function personaLabel(p: Persona): string {
  return [p.n, p.a ? String(p.a) : "", occupationLabel(p)].filter(Boolean).join(" · ");
}

/**
 * Pick `n` DISTINCT random personas. Optionally seedable so a given chat id always
 * gets the same cast (nice for reloads); omit the seed for true randomness.
 */
export function pickPersonas(n: number, seed?: string): Persona[] {
  const pool = [...PERSONAS];
  let rnd: () => number;
  if (seed) {
    // Small deterministic PRNG (mulberry32) from a string hash.
    let h = 1779033703 ^ seed.length;
    for (let i = 0; i < seed.length; i++) {
      h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    let a = h >>> 0;
    rnd = () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  } else {
    rnd = Math.random;
  }
  // Partial Fisher-Yates — only shuffle what we need.
  const take = Math.min(n, pool.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rnd() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, take);
}

/**
 * Look a persona up by name. The client only ever holds the display fields, so it
 * posts names back and the server re-hydrates the full record for the prompt.
 * Stable across roster changes, unlike re-deriving from an index.
 */
const BY_NAME = new Map(PERSONAS.map((p) => [p.n.toLowerCase(), p]));
export function personaByName(name: string): Persona | undefined {
  return BY_NAME.get(String(name || "").trim().toLowerCase());
}

/** Assign a distinct persona to each agent id. */
export function assignPersonas(agentIds: string[], seed?: string): Record<string, Persona> {
  const picked = pickPersonas(agentIds.length, seed);
  const out: Record<string, Persona> = {};
  agentIds.forEach((id, i) => { if (picked[i]) out[id] = picked[i]; });
  return out;
}

/**
 * The prompt fragment that layers a human persona over an agent's own identity.
 * The agent keeps its expertise but speaks as this person — that contrast is the
 * point (a Codex that talks like a 62-year-old quilter is a genuinely different
 * council member than plain Codex).
 */
export function personaPrompt(p: Persona): string {
  const bits = [
    `You are ROLE-PLAYING as a specific person for this conversation: ${p.n}.`,
    p.a || p.o || p.l ? `They are ${[p.a ? `${p.a}` : "", occupationLabel(p), p.l].filter(Boolean).join(", ")}.` : "",
    `About them: ${p.p}`,
    p.pro ? `Professionally: ${p.pro}` : "",
    p.h ? `Interests: ${p.h}` : "",
    `Speak as ${p.n} — their voice, priorities, temperament and turns of phrase. Let their background genuinely shape what they notice and care about.`,
    `Keep your own expertise and knowledge, but filter it through this person. Do NOT announce that you are role-playing, and never break character.`,
  ];
  return bits.filter(Boolean).join(" ");
}
