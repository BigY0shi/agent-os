// The principal registry: who exists, what folder is theirs, and whether their
// credentials survive a restart.
//
// Storage is a plain JSON file (`~/.agentic-os/principals.json`) rather than the
// settings store, because identity is not a preference. A settings file can be
// reset to defaults without much thought; resetting identity would silently
// re-point every credential folder.
//
// AGENTIC_OS_PRINCIPALS overrides the path, mirroring AGENTIC_OS_DB /
// AGENTIC_OS_SETTINGS / AGENTIC_OS_BROWSER_PROFILES. Rule 19: any smoke that
// touches this MUST redirect it first.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  agentRef, isValidAgentId, nextAgentId, nextSubAgentId, parsePrincipal,
  rootAgentOf, userRef,
} from "./ids";

/** What kind of thing an agent principal represents. Yoshi's three sources. */
export type AgentOrigin = "frontier-model" | "harness" | "forge" | "subagent";

export interface AgentRecord {
  id: string;
  label: string;
  origin: AgentOrigin;
  /** Only meaningful on a ROOT agent — sub-agents inherit. See persistsFor(). */
  persistCredentials: boolean;
  createdAt: number;
  /** Present on sub-agents. */
  parentId?: string;
  /** The AgentOS agent slug (RunMeta.agentId) this principal stands for, when
   *  it was provisioned for an existing agent rather than registered fresh. */
  externalId?: string;
}

export interface PrincipalsFile {
  userId?: string;
  agents?: AgentRecord[];
}

export function principalsPath(): string {
  const override = process.env.AGENTIC_OS_PRINCIPALS;
  if (override && override.trim()) return override.trim();
  return path.join(os.homedir(), ".agentic-os", "principals.json");
}

function read(): PrincipalsFile {
  try {
    const p = principalsPath();
    if (!fs.existsSync(p)) return {};
    let raw = fs.readFileSync(p, "utf8");
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // PowerShell BOM
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as PrincipalsFile;
  } catch (err) {
    // Loud but not fatal. A corrupt file must not brick the app, but it must
    // never silently mint a SECOND user id either - see ensureUserId.
    console.error(`[identity] could not read ${principalsPath()}:`, err instanceof Error ? err.message : err);
    return {};
  }
}

function write(next: PrincipalsFile): void {
  const p = principalsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(next, null, 2) + "\n");
}

/**
 * The human's id, assigned once on first run.
 *
 * Deliberately never regenerated: if the file is unreadable this throws rather
 * than minting U2, because a fresh id would orphan every folder the real user
 * owns and hand their profiles to nobody.
 */
export function ensureUserId(): string {
  const file = read();
  if (file.userId) {
    const p = parsePrincipal(userRef(file.userId));
    if (!p) throw new Error(`principals.json holds an invalid userId "${file.userId}" - refusing to overwrite it`);
    return file.userId;
  }
  if (fs.existsSync(principalsPath()) && Object.keys(file).length === 0) {
    throw new Error(
      `${principalsPath()} exists but could not be parsed. Fix or move it; refusing to mint a second user id.`,
    );
  }
  const id = "U1";
  write({ ...file, userId: id });
  return id;
}

export function currentUserRef(): string {
  return userRef(ensureUserId());
}

export function listAgents(): AgentRecord[] {
  return read().agents ?? [];
}

export function getAgent(id: string): AgentRecord | undefined {
  return listAgents().find((a) => a.id === id);
}

/**
 * Register a top-level agent: an imported frontier model, an agentic harness,
 * or one built in the Forge.
 *
 * `persistCredentials` is the answer to the install-time question. False means
 * this agent's credential folder is treated as disposable.
 */
export function registerAgent(input: {
  label: string;
  origin: Exclude<AgentOrigin, "subagent">;
  persistCredentials: boolean;
}): AgentRecord {
  const file = read();
  const agents = file.agents ?? [];
  const rec: AgentRecord = {
    id: nextAgentId(agents.map((a) => a.id)),
    label: input.label.trim() || "Unnamed agent",
    origin: input.origin,
    persistCredentials: input.persistCredentials,
    createdAt: Date.now(),
  };
  write({ ...file, agents: [...agents, rec] });
  return rec;
}

/**
 * Register a sub-agent of `parentId`. Agent 43 spawns 43A, then 43B, then 43C.
 *
 * A sub-agent gets NO persistence choice of its own: it works inside its root
 * agent's folder, so the root's answer already decided. Storing a separate flag
 * here would be a field that looks like it does something and does not.
 */
export function registerSubAgent(parentId: string, label?: string): AgentRecord {
  if (!isValidAgentId(parentId)) throw new Error(`Invalid parent agent id "${parentId}"`);
  const file = read();
  const agents = file.agents ?? [];
  if (!agents.some((a) => a.id === parentId)) {
    throw new Error(`Parent agent "${parentId}" is not registered`);
  }
  const id = nextSubAgentId(parentId, agents.map((a) => a.id));
  const root = rootAgentOf(id);
  const rec: AgentRecord = {
    id,
    label: (label ?? "").trim() || `Sub-agent of ${parentId}`,
    origin: "subagent",
    persistCredentials: agents.find((a) => a.id === root)?.persistCredentials ?? false,
    createdAt: Date.now(),
    parentId,
  };
  write({ ...file, agents: [...agents, rec] });
  return rec;
}

/**
 * Find (or create) the principal for an AgentOS agent id.
 *
 * AgentOS agents are identified by their own slug (`RunMeta.agentId`), which
 * predates this registry. Rather than deny every agent that has not been
 * through the new registration flow - which would break working setups on
 * upgrade - an unknown agent is auto-provisioned with its OWN folder and
 * persistence OFF.
 *
 * That is the fail-safe direction: an unregistered agent gains a private
 * scratch identity, never access to the user's. The alternative (treating
 * unknown callers as the user) would hand every legacy agent the human's
 * cookie jar on first run.
 */
export function ensureAgentPrincipal(externalId: string, label?: string): AgentRecord {
  const key = (externalId ?? "").trim();
  if (!key) throw new Error("ensureAgentPrincipal requires an agent id");
  const file = read();
  const agents = file.agents ?? [];
  const found = agents.find((a) => a.externalId === key);
  if (found) return found;
  const rec: AgentRecord = {
    id: nextAgentId(agents.map((a) => a.id)),
    label: (label ?? "").trim() || key,
    origin: "harness",
    persistCredentials: false,
    createdAt: Date.now(),
    externalId: key,
  };
  write({ ...file, agents: [...agents, rec] });
  return rec;
}

/** The principal ref for a caller. No agent id means the human is driving. */
export function callerRef(externalAgentId?: string | null, label?: string): string {
  if (externalAgentId && externalAgentId.trim()) {
    return agentRef(ensureAgentPrincipal(externalAgentId, label).id);
  }
  return currentUserRef();
}

/**
 * Which principal's folder a ref actually uses.
 *
 * The user owns their own. An agent uses its ROOT agent's folder, so
 * `agent:43AB` resolves to `agent:43`. Derived from the id, never looked up -
 * an inherited-folder rule that depends on a database row can disagree with
 * reality; one that depends on the id cannot.
 */
export function credentialOwnerOf(ref: string): string | null {
  const p = parsePrincipal(ref);
  if (!p) return null;
  if (p.kind === "user") return p.ref;
  return agentRef(rootAgentOf(p.id));
}

/** Does this principal's credential folder survive a restart? */
export function persistsFor(ref: string): boolean {
  const owner = credentialOwnerOf(ref);
  if (!owner) return false;
  const p = parsePrincipal(owner);
  if (!p) return false;
  if (p.kind === "user") return true; // the human's own state always persists
  return getAgent(p.id)?.persistCredentials ?? false;
}

export function principalsRoot(): string {
  return path.join(path.dirname(principalsPath()), "principals");
}

/**
 * The gated folder for a ref. Sub-agents resolve to their root's folder, so
 * 43AB and 43 get the same path by construction.
 *
 * The id is validated by parsePrincipal before it reaches path.join, so a ref
 * can never traverse out of the root - same guarantee getProfileDir() gives.
 */
export function principalHome(ref: string): string {
  const owner = credentialOwnerOf(ref);
  if (!owner) throw new Error(`Invalid principal ref "${ref}"`);
  const p = parsePrincipal(owner);
  if (!p) throw new Error(`Invalid principal ref "${ref}"`);
  return path.join(principalsRoot(), `${p.kind}-${p.id}`);
}

export function ensurePrincipalHome(ref: string): string {
  const dir = principalHome(ref);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * What a human should SEE for a principal.
 *
 * The id ("43A") is plumbing: it encodes lineage so credential ownership is
 * derivable, and it is what gets stored and compared. It is not a name. Every
 * agent carries a label at registration ("Claude Code", "Codex", "Deal Desk
 * triage"), and that label is what any surface renders.
 *
 * A sub-agent inherits its root's label and is distinguished by its generation
 * suffix, so 43A of "Claude Code" reads as "Claude Code · A" rather than as a
 * separate unnamed thing. Unregistered refs fall back to the raw form, which is
 * a visible bug rather than a silent blank.
 */
export function displayFor(ref: string): string {
  const p = parsePrincipal(ref);
  if (!p) return ref;
  if (p.kind === "user") return "You";

  const exact = getAgent(p.id);
  if (exact && exact.origin !== "subagent") return exact.label;

  const root = getAgent(rootAgentOf(p.id));
  const suffix = p.id.slice(rootAgentOf(p.id).length);
  if (root) return suffix ? `${root.label} · ${suffix}` : root.label;
  if (exact) return exact.label;
  return `Agent ${p.id}`;
}

/** Registered agents with their display labels — for pickers and settings UI. */
export function agentDirectory(): { ref: string; id: string; label: string; display: string; origin: AgentOrigin }[] {
  return listAgents().map((a) => ({
    ref: agentRef(a.id),
    id: a.id,
    label: a.label,
    display: displayFor(agentRef(a.id)),
    origin: a.origin,
  }));
}

// Re-exported from ./copy so server callers have one import, while client
// components can take the string without dragging node:fs into the bundle.
export { PERSIST_CREDENTIALS_WARNING } from "./copy";

/**
 * Attach an AgentOS agent slug to an already-registered principal.
 *
 * Registration happens when the agent is BUILT (so the persist answer is
 * recorded against the label the user typed), but the AgentOS id only exists
 * once the agent def is written. This closes that gap so callerRef() finds the
 * existing principal instead of auto-provisioning a second one.
 */
export function linkExternalId(principalId: string, externalId: string): void {
  const file = read();
  const agents = file.agents ?? [];
  const idx = agents.findIndex((a) => a.id === principalId);
  if (idx < 0) throw new Error(`Agent principal "${principalId}" is not registered`);
  const next = agents.slice();
  next[idx] = { ...next[idx], externalId: externalId.trim() };
  write({ ...file, agents: next });
}
