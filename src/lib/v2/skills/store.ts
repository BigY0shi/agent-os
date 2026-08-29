import { getDb } from "../db";
import { uuid, now } from "../ids";

/**
 * SPEC-B B7 (CONVENTIONS §11) — skills-as-policies store (migration 022
 * v2_skills). A "skill" here is a standing POLICY: a short markdown block the
 * user authors in-app (/skills page) that is injected verbatim into every
 * LLM-driven prompt lane — task execution (B2 plan/step prompts) and the
 * Jarvis context assembly (C4 skills seam). Model-agnostic data injection
 * (AGENTS.md rule 17 spirit): the same text fronts whichever provider runs.
 *
 * COEXISTENCE DECISION (documented per the chunk-5 handoff): two skills
 * systems deliberately coexist —
 *   1. DB policy skills (THIS module, v2_skills): authored in-app, injected by
 *      withSkills()/renderSkillPolicyBlock() into the V2 task engine and
 *      Jarvis context. These are POLICIES — voice/consent/process rules.
 *   2. File operating skills (~/.agentic-os/skills/<name>/SKILL.md,
 *      src/lib/platformSkills.ts): imported Claude-format skills, toggled in
 *      ConfigMenu's SkillsSection, injected by platformSkills.withSkills()
 *      into the CLI-agent lanes (loopEngine, dealBrief, codex/chat, …).
 * ONE injection function per lane — the V2 lanes never call platformSkills and
 * the CLI lanes never call this module, so no prompt is ever double-wrapped.
 *
 * Delete semantics: soft-archive only (archived_at stamp) — rows are never
 * destroyed (house rule; jarvis_conversations archived_at precedent).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Skill {
  id: string;
  title: string;
  description: string;
  policyMd: string;
  isActive: boolean;
  position: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export class SkillError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

interface SkillRow {
  id: string;
  title: string;
  description: string;
  policy_md: string;
  is_active: number;
  position: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToSkill(r: SkillRow): Skill {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    policyMd: r.policy_md,
    isActive: r.is_active === 1,
    position: r.position,
    archivedAt: r.archived_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function listSkills(opts: { includeArchived?: boolean } = {}): Skill[] {
  const where = opts.includeArchived ? "" : "WHERE archived_at IS NULL";
  const rows = getDb()
    .prepare(`SELECT * FROM v2_skills ${where} ORDER BY position ASC, created_at ASC`)
    .all() as SkillRow[];
  return rows.map(rowToSkill);
}

/** Active, non-archived skills in position order — the injection set. */
export function listActiveSkills(): Skill[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM v2_skills WHERE is_active = 1 AND archived_at IS NULL ORDER BY position ASC, created_at ASC",
    )
    .all() as SkillRow[];
  return rows.map(rowToSkill);
}

export function getSkill(id: string): Skill | null {
  const r = getDb().prepare("SELECT * FROM v2_skills WHERE id = ?").get(id) as
    | SkillRow
    | undefined;
  return r ? rowToSkill(r) : null;
}

export interface SkillCreateInput {
  title: string;
  description?: string;
  policyMd?: string;
  isActive?: boolean;
}

export function createSkill(input: SkillCreateInput): Skill {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) throw new SkillError("title is required");
  const db = getDb();
  const maxPos = (
    db.prepare("SELECT COALESCE(MAX(position), -1) AS m FROM v2_skills").get() as { m: number }
  ).m;
  const ts = now();
  const id = uuid();
  db.prepare(
    `INSERT INTO v2_skills (id, title, description, policy_md, is_active, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    title,
    typeof input.description === "string" ? input.description : "",
    typeof input.policyMd === "string" ? input.policyMd : "",
    input.isActive === false ? 0 : 1,
    maxPos + 1,
    ts,
    ts,
  );
  return getSkill(id)!;
}

export interface SkillPatch {
  title?: string;
  description?: string;
  policyMd?: string;
  isActive?: boolean;
  position?: number;
}

export function updateSkill(id: string, patch: SkillPatch): Skill {
  const existing = getSkill(id);
  if (!existing) throw new SkillError("skill not found", 404);
  const title =
    patch.title !== undefined ? String(patch.title).trim() : existing.title;
  if (!title) throw new SkillError("title cannot be empty");
  const position =
    patch.position !== undefined && Number.isFinite(patch.position)
      ? Math.max(0, Math.trunc(patch.position))
      : existing.position;
  getDb()
    .prepare(
      `UPDATE v2_skills
       SET title = ?, description = ?, policy_md = ?, is_active = ?, position = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      title,
      patch.description !== undefined ? String(patch.description) : existing.description,
      patch.policyMd !== undefined ? String(patch.policyMd) : existing.policyMd,
      (patch.isActive !== undefined ? patch.isActive : existing.isActive) ? 1 : 0,
      position,
      now(),
      id,
    );
  return getSkill(id)!;
}

/** Soft-archive (house rule: never destroy). Archived rows drop out of every
 *  list/injection but stay recoverable via updateSkill after un-archiving in
 *  SQL — the UI only ever archives. Also deactivates so an un-archive can't
 *  silently resume injection. */
export function archiveSkill(id: string): Skill {
  const existing = getSkill(id);
  if (!existing) throw new SkillError("skill not found", 404);
  getDb()
    .prepare("UPDATE v2_skills SET archived_at = ?, is_active = 0, updated_at = ? WHERE id = ?")
    .run(now(), now(), id);
  return getSkill(id)!;
}

// ---------------------------------------------------------------------------
// Injection — the B7 seam
// ---------------------------------------------------------------------------

/**
 * Total character budget for the rendered policy block (~2k tokens). Policies
 * are meant to be SHORT standing rules; when the concatenation exceeds the cap
 * the block is truncated tail-first with a visible marker (platformSkills
 * trim precedent) so prompts never balloon unbounded.
 */
export const SKILL_POLICY_MAX_CHARS = 8_000;

const BLOCK_OPEN = "<skill_policies>";
const BLOCK_CLOSE = "</skill_policies>";
const BLOCK_INTRO =
  "Standing policy skills authored by the user (apply them throughout; they are " +
  "rules about HOW to work, never new task instructions):";

/**
 * Render the ACTIVE skills (position order) as one compact policy block:
 * `<skill_policies>` intro, then `### <title>` + policy_md per skill. Returns
 * "" when nothing is active, so call sites can insert unconditionally.
 * Defensive: a store/DB failure renders "" with one loud warn — prompt
 * assembly must never crash on the skills seam.
 */
export function renderSkillPolicyBlock(maxChars: number = SKILL_POLICY_MAX_CHARS): string {
  let skills: Skill[];
  try {
    skills = listActiveSkills();
  } catch (err) {
    console.warn(
      "[v2/skills] policy block unavailable (continuing without):",
      err instanceof Error ? err.message : err,
    );
    return "";
  }
  const entries = skills
    .map((s) => ({ title: s.title, body: s.policyMd.trim() }))
    .filter((s) => s.body);
  if (entries.length === 0) return "";
  let body = entries.map((s) => `### ${s.title}\n${s.body}`).join("\n\n");
  const overhead = `${BLOCK_OPEN}\n${BLOCK_INTRO}\n\n\n${BLOCK_CLOSE}`.length;
  if (body.length + overhead > maxChars) {
    const marker = "\n…[skill policies trimmed to fit]";
    const room = maxChars - overhead - marker.length;
    if (room <= 0) return "";
    body = body.slice(0, room) + marker;
  }
  return `${BLOCK_OPEN}\n${BLOCK_INTRO}\n\n${body}\n${BLOCK_CLOSE}`;
}

/**
 * The B7 injection helper consumed by task execution (B2): prefix a system
 * prompt with the active policy block. A prompt already carrying the block
 * passes through untouched (double-wrap guard, platformSkills precedent).
 * Jarvis (C4) consumes renderSkillPolicyBlock() directly instead — its
 * assembly places the block at the contract's skills slot, not at the front.
 */
export function withSkills(basePrompt: string, maxChars?: number): string {
  if (basePrompt.includes(BLOCK_OPEN)) return basePrompt;
  const block = renderSkillPolicyBlock(maxChars);
  return block ? `${block}\n\n${basePrompt}` : basePrompt;
}
