import { readSettings } from "../../settings";
import { personaPrompt } from "../../jarvisPersona";
import { getPersonaDocument } from "../memory/persona";
import { renderSkillPolicyBlock } from "../skills/store";
import {
  IDENTITY_BLOCK,
  TOOL_GUIDANCE_BLOCK,
  SPOKEN_MECHANICS_BLOCK,
  RECALLED_MEMORY_RULE,
  skillsNoteBlock,
  datetimeBlock,
  activePageBlock,
  userPersonaBlock,
  replySurfaceBlock,
  type ActivePageInput,
  type ReplySurfaceInput,
} from "./prompts/system";

/**
 * SPEC-C C4 — Jarvis context assembly. Order (normative, smoke-asserted):
 *   runtime <identity> (never user-editable)
 *   → jarvisPersona record (model-agnostic editable data, rule 17)
 *   → A6 persona DOCUMENT (getPersonaDocument — absent until generated)
 *   → skills slot (B7: active v2_skills POLICY bodies + file-skill names note)
 *   → <current_datetime> + <active_page> (per-request pageContext, NEVER persisted)
 *   → spoken mechanics.
 *
 * The warm SDK session cannot swap its system prompt per turn, so the assembly
 * splits: buildStableSystemPrompt() (identity → persona → doc → skills → tool
 * guidance → §9.4 rule → spoken mechanics) seeds the session; the per-turn
 * half (datetime + active_page) rides ahead of the user text via
 * buildTurnContextBlock(). buildSystemPrompt() composes the FULL ordered
 * assembly for the cli lane and for order verification.
 */

export interface PageContextPayload extends ActivePageInput {
  route: string;
  title?: string;
  summary?: string;
  selection?: string;
}

const ROUTE_CAP = 200;
const TITLE_CAP = 200;
const SUMMARY_CAP = 800;
const SELECTION_CAP = 1500;

/** Defensive normalization of the client-supplied descriptor (never trusted raw). */
export function sanitizePageContext(raw: unknown): PageContextPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const route = typeof p.route === "string" ? p.route.trim().slice(0, ROUTE_CAP) : "";
  if (!route.startsWith("/")) return null;
  const str = (v: unknown, cap: number) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, cap) : undefined;
  return {
    route,
    title: str(p.title, TITLE_CAP),
    summary: str(p.summary, SUMMARY_CAP),
    selection: str(p.selection, SELECTION_CAP),
  };
}

export interface BuildContextInput {
  pageContext?: PageContextPayload | null;
  /** Per-request reply surface (glasses) — rendered after <active_page>, never persisted. */
  surface?: ReplySurfaceInput | null;
  mode?: "text" | "voice";
  /** Test override — production reads getPersonaDocument()/settings itself. */
  personaDocContent?: string | null;
  skillNames?: string[];
  /** Test override for the B7 policy block — undefined = read the v2_skills
   *  store (renderSkillPolicyBlock); null/"" = render none. */
  skillPolicies?: string | null;
  now?: Date;
}

function personaDocOrNull(input: BuildContextInput): string | null {
  if (input.personaDocContent !== undefined) return input.personaDocContent;
  try {
    return getPersonaDocument()?.content ?? null;
  } catch (err) {
    // DB not booted (e.g. pure prompt-assembly tests) — render without it, loudly once.
    console.warn(
      "[v2/jarvis] persona document unavailable (continuing without):",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

function skillNamesOrSettings(input: BuildContextInput): string[] {
  if (input.skillNames) return input.skillNames;
  try {
    return readSettings().skills?.global ?? [];
  } catch {
    return [];
  }
}

/**
 * The C4 skills SLOT (B7 upgrade): the active v2_skills POLICY bodies
 * (<skill_policies>, from skills/store.ts — "" on empty/DB-unbooted, warned
 * inside renderSkillPolicyBlock) followed by the file-skill NAMES note. Slot
 * position in the assembly is unchanged (…doc → skills → datetime…, the
 * smoke-asserted order).
 */
function skillsSlot(input: BuildContextInput): string {
  const policies =
    input.skillPolicies !== undefined
      ? (input.skillPolicies ?? "")
      : renderSkillPolicyBlock();
  return [policies, skillsNoteBlock(skillNamesOrSettings(input))]
    .filter(Boolean)
    .join("\n\n");
}

/** Session-stable half — seeds the warm SDK session's system prompt. */
export function buildStableSystemPrompt(input: BuildContextInput = {}): string {
  return [
    IDENTITY_BLOCK,
    personaPrompt(),
    userPersonaBlock(personaDocOrNull(input)),
    skillsSlot(input),
    TOOL_GUIDANCE_BLOCK,
    RECALLED_MEMORY_RULE,
    SPOKEN_MECHANICS_BLOCK,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Per-turn half — datetime + active_page + reply_surface. Rides in the user message on the
 *  sdk lane. Returns "" when there is nothing to say. */
export function buildTurnContextBlock(input: BuildContextInput = {}): string {
  return [datetimeBlock(input.now), activePageBlock(input.pageContext), replySurfaceBlock(input.surface)]
    .filter(Boolean)
    .join("\n");
}

/**
 * The FULL ordered assembly (C4 contract order) — used verbatim by the cli
 * answer-only lane and by the smoke's ordered-marker assertion.
 */
export function buildSystemPrompt(input: BuildContextInput = {}): string {
  return [
    IDENTITY_BLOCK,
    personaPrompt(),
    userPersonaBlock(personaDocOrNull(input)),
    skillsSlot(input),
    RECALLED_MEMORY_RULE,
    datetimeBlock(input.now),
    activePageBlock(input.pageContext),
    replySurfaceBlock(input.surface),
    SPOKEN_MECHANICS_BLOCK,
  ]
    .filter(Boolean)
    .join("\n\n");
}
