// Principal identity — who a thing IS, independent of what it may do.
//
// Two kinds of principal:
//   user:U1     the human. Assigned once, on first run.
//   agent:43    a top-level agent (an imported frontier model, an agentic
//               harness, or an agent built in the Forge).
//   agent:43A   a sub-agent spawned BY agent 43. Its siblings are 43B, 43C.
//   agent:43AB  a sub-agent of 43A.
//
// The lineage is encoded in the id on purpose. Sub-agents inherit their
// orchestrator's credential folder, so the credential owner of any agent is
// recoverable from its id alone — no lookup, no database, no chance of the
// record and the reality disagreeing. `rootAgentOf("43AB") === "43"` is the
// whole security model in one function.
//
// That inheritance is exactly what the persist-credentials checkbox has to warn
// about: ticking it for agent 43 grants every sub-agent 43 ever spawns access
// to whatever 43 is logged into.

/** `43`, `43A`, `43AB`, and (past 26 siblings) `43A2`, `43Z2B`. */
const AGENT_RE = /^(\d+)((?:[A-Z]\d*)*)$/;
/** `U1`, `U2`. */
const USER_RE = /^U(\d+)$/;

export type PrincipalKind = "user" | "agent";

export interface Principal {
  kind: PrincipalKind;
  /** The bare id: "U1" for a user, "43A" for an agent. */
  id: string;
  /** Canonical string form, e.g. "agent:43A". This is what gets stored. */
  ref: string;
}

export const USER_PREFIX = "user:";
export const AGENT_PREFIX = "agent:";

export function isValidAgentId(id: string): boolean {
  return AGENT_RE.test(id);
}

export function isValidUserId(id: string): boolean {
  return USER_RE.test(id);
}

/** "agent:43A" -> {kind:"agent", id:"43A"}. Returns null for anything malformed. */
export function parsePrincipal(ref: string): Principal | null {
  const value = (ref ?? "").trim();
  if (value.startsWith(AGENT_PREFIX)) {
    const id = value.slice(AGENT_PREFIX.length);
    return isValidAgentId(id) ? { kind: "agent", id, ref: `${AGENT_PREFIX}${id}` } : null;
  }
  if (value.startsWith(USER_PREFIX)) {
    const id = value.slice(USER_PREFIX.length);
    return isValidUserId(id) ? { kind: "user", id, ref: `${USER_PREFIX}${id}` } : null;
  }
  return null;
}

export function userRef(id: string): string {
  if (!isValidUserId(id)) throw new Error(`Invalid user id "${id}"`);
  return `${USER_PREFIX}${id}`;
}

export function agentRef(id: string): string {
  if (!isValidAgentId(id)) throw new Error(`Invalid agent id "${id}"`);
  return `${AGENT_PREFIX}${id}`;
}

/** Split "43AB" into its base number and per-generation segments ["A","B"]. */
function segments(agentId: string): { base: string; gens: string[] } {
  const m = AGENT_RE.exec(agentId);
  if (!m) throw new Error(`Invalid agent id "${agentId}"`);
  return { base: m[1], gens: m[2].match(/[A-Z]\d*/g) ?? [] };
}

/**
 * The top-level agent an id descends from. `43AB` -> `43`; `43` -> `43`.
 *
 * This is the credential owner. A sub-agent has no folder of its own — it works
 * inside its orchestrator's, which is what makes the persist warning load-bearing.
 */
export function rootAgentOf(agentId: string): string {
  return segments(agentId).base;
}

/** How deep a sub-agent sits. 0 for a top-level agent. */
export function generationOf(agentId: string): number {
  return segments(agentId).gens.length;
}

/** Is `descendant` spawned (at any depth) by `ancestor`? Not reflexive. */
export function isDescendantOf(descendant: string, ancestor: string): boolean {
  if (!isValidAgentId(descendant) || !isValidAgentId(ancestor)) return false;
  if (descendant === ancestor) return false;
  const d = segments(descendant);
  const a = segments(ancestor);
  if (d.base !== a.base) return false;
  if (d.gens.length <= a.gens.length) return false;
  return a.gens.every((g, i) => d.gens[i] === g);
}

/** A -> B -> ... -> Z -> A2 -> B2 ... Kept single-letter-first so the common
 *  case reads the way Yoshi described it: 43 spawns 43A, 43B, 43C. */
function nextSegment(taken: Set<string>): string {
  for (let cycle = 1; cycle < 1000; cycle++) {
    for (let i = 0; i < 26; i++) {
      const seg = String.fromCharCode(65 + i) + (cycle === 1 ? "" : String(cycle));
      if (!taken.has(seg)) return seg;
    }
  }
  throw new Error("exhausted sub-agent segments");
}

/**
 * The id for a new sub-agent of `parentId`, given the parent's existing children.
 *
 * `existingChildren` is the full id list ("43A", "43B"); anything that is not a
 * direct child is ignored, so callers can pass the whole roster without filtering.
 */
export function nextSubAgentId(parentId: string, existingChildren: readonly string[] = []): string {
  if (!isValidAgentId(parentId)) throw new Error(`Invalid agent id "${parentId}"`);
  const parent = segments(parentId);
  const taken = new Set<string>();
  for (const child of existingChildren) {
    if (!isValidAgentId(child)) continue;
    const c = segments(child);
    // Direct children only: same base, exactly one generation deeper, and every
    // ancestor segment matching.
    if (c.base !== parent.base) continue;
    if (c.gens.length !== parent.gens.length + 1) continue;
    if (!parent.gens.every((g, i) => c.gens[i] === g)) continue;
    taken.add(c.gens[c.gens.length - 1]);
  }
  return `${parentId}${nextSegment(taken)}`;
}

/** The next free top-level agent number. Numbers are never reused. */
export function nextAgentId(existing: readonly string[] = []): string {
  let max = 0;
  for (const id of existing) {
    if (!isValidAgentId(id)) continue;
    const n = Number(segments(id).base);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return String(max + 1);
}

/** "Agent 43A" / "You (U1)" — for UI, never for storage or comparison. */
export function displayName(ref: string): string {
  const p = parsePrincipal(ref);
  if (!p) return ref;
  return p.kind === "user" ? `You (${p.id})` : `Agent ${p.id}`;
}
