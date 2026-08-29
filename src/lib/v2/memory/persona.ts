import { getDb, tx } from "../db";
import { uuid as newUuid, now } from "../ids";
import { emit } from "../events";
import { readSettings } from "../../settings";
import { modelCallText } from "./llm";
import { createLabel, getLabelByName, type LabelRow } from "./labels";
import { getEpisode } from "./graph";
import { DEFAULT_USER_NAME } from "./constants";
import {
  GRAPH_ASPECTS,
  VOICE_ASPECTS,
  type StatementAspect,
  type VoiceAspect,
} from "./types";
import {
  ASPECT_SECTION_MAP,
  BatchDecisionSchema,
  PlacementDecisionSchema,
  buildAspectSectionPrompt,
  buildBatchPlacementPrompt,
  buildChunkSummaryPrompt,
  buildMergePrompt,
  buildPlacementPrompt,
  type PersonaFactInput,
  type PersonaEpisodeInput,
  type PersonaUserContext,
  type PlacementDecision,
} from "./prompts/persona";

/**
 * A6 — persona document generator. Port of REF apps/webapp/app/jobs/spaces/
 * {persona-trigger.logic, persona-generation.logic, aspect-persona-generation,
 * persona-bullet-ops, persona-llm-placement}.ts — DIRECT-CALL branch only
 * (REF USE_BATCH=false); ALL OpenAI-batch-API plumbing deleted.
 *
 * Storage: ONE `documents` row, type='persona', session_id 'persona-v2'
 * (SPEC-A §2.2; REF used type "skill" + sessionId persona-v2-<ws> — our
 * schema names the type honestly). NOT embedded into any vector namespace
 * (REF savePersonaDocument writes no vector — the persona is derived FROM the
 * graph, stored only for display/preload).
 *
 * INVARIANT (409 semantics): full generation runs ONLY when no persona doc
 * exists. A full regen over an existing doc is REFUSED — user edits live in
 * the doc; incremental bullet-ops/tombstones are the only writers after
 * first generation.
 *
 * Trigger: fired from queue.ts after a COMPLETED ingestion, per episode (REF
 * ingest-episode.logic.ts enqueuePersonaGeneration), non-fatal. Gated on
 * settings.memory.personaAutoUpdate.
 */

// ---------------------------------------------------------------------------
// PERSONA_ASPECTS — single source of truth (REF persona-bullet-ops.ts).
// Order here is also the section rendering order.
// ---------------------------------------------------------------------------

export const PERSONA_ASPECTS: StatementAspect[] = [
  "Identity",
  "Preference",
  "Directive",
];

const GRAPH_ASPECTS_SET = new Set<string>(GRAPH_ASPECTS);
const VOICE_ASPECTS_SET = new Set<string>(VOICE_ASPECTS);
/** Persona-relevant aspects stored as SPO triples (graph): Identity. */
export const PERSONA_GRAPH_ASPECTS: StatementAspect[] = PERSONA_ASPECTS.filter(
  (a) => GRAPH_ASPECTS_SET.has(a),
);
/** Persona-relevant aspects stored whole (voice): Preference, Directive. */
export const PERSONA_VOICE_ASPECTS: VoiceAspect[] = PERSONA_ASPECTS.filter(
  (a): a is VoiceAspect => VOICE_ASPECTS_SET.has(a),
);

// REF aspect-persona-generation.ts — full-mode knobs (verbatim values).
const MIN_STATEMENTS_PER_SECTION = 1;
const MAX_STATEMENTS_PER_CHUNK = 30;
const MAX_EPISODES_PER_CHUNK = 20;

// Persona surfaces IDENTITY only (REF current behavior — the doc is
// intentionally tiny; everything else is retrievable via memory search).
export const SKIPPED_ASPECTS: StatementAspect[] = [
  "Event",
  "Relationship",
  "Knowledge",
  "Belief",
  "Habit",
  "Goal",
  "Decision",
  "Problem",
  "Task",
  "Preference",
  "Directive",
];

const PERSONA_SESSION_ID = "persona-v2";
const PERSONA_LABEL_NAME = "Persona";
const LAST_GENERATION_META_KEY = "persona.lastGenerationAt";

// ===========================================================================
// Markdown section split / merge primitives — PURE (REF persona-bullet-ops.ts
// verbatim). Exercised offline by smoke-compaction.mjs.
// ===========================================================================

export interface MarkdownSection {
  heading: string | null; // null = content before the first ## heading
  content: string; // raw markdown for this section (including the ## line)
}

/**
 * Split a markdown document into sections by `## ` boundaries.
 * Preserves every byte — join all .content to reconstruct the original.
 */
export function splitByH2Markdown(doc: string): MarkdownSection[] {
  if (!doc.trim()) return [];

  const sections: MarkdownSection[] = [];
  const h2Regex = /^## /gm;
  const positions: number[] = [];
  let m: RegExpExecArray | null;

  while ((m = h2Regex.exec(doc)) !== null) {
    positions.push(m.index);
  }

  if (positions.length === 0) {
    return [{ heading: null, content: doc }];
  }

  if (positions[0] > 0) {
    sections.push({ heading: null, content: doc.slice(0, positions[0]) });
  }

  for (let i = 0; i < positions.length; i++) {
    const start = positions[i];
    const end = i + 1 < positions.length ? positions[i + 1] : doc.length;
    const raw = doc.slice(start, end);
    const firstNewline = raw.indexOf("\n");
    const headingLine =
      firstNewline >= 0 ? raw.slice(3, firstNewline) : raw.slice(3);
    sections.push({ heading: headingLine.trim(), content: raw });
  }

  return sections;
}

/**
 * Decide whether `heading` is a user-customised version of canonical
 * `sectionName`. Accepts exact (case-insensitive, after HTML-comment strip),
 * first-token match, or canonical name appearing as a whole word.
 */
export function headingMatchesCanonical(
  heading: string | null,
  sectionName: string,
): boolean {
  if (!heading) return false;
  const name = sectionName.trim().toUpperCase();
  const stripped = heading
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim()
    .toUpperCase();
  if (stripped === name) return true;
  const firstToken = stripped.split(/\s+/)[0];
  if (firstToken === name) return true;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wordRe = new RegExp(`\\b${escaped}\\b`);
  return wordRe.test(stripped);
}

/**
 * Find a section by canonical name, replace its body, return the doc.
 * Preserves the user's existing heading text verbatim when matched;
 * uses the canonical heading only when creating a new section.
 */
export function mergeSectionIntoMarkdown(
  doc: string,
  sectionName: string,
  newBody: string,
): string {
  const sections = splitByH2Markdown(doc);

  const targetIndex = sections.findIndex((s) =>
    headingMatchesCanonical(s.heading, sectionName),
  );

  if (targetIndex >= 0) {
    const existing = sections[targetIndex];
    const existingHeading = existing.heading ?? sectionName;
    sections[targetIndex] = {
      heading: existingHeading,
      content: `## ${existingHeading}\n\n${newBody}\n\n`,
    };
  } else {
    sections.push({
      heading: sectionName,
      content: `## ${sectionName}\n\n${newBody}\n\n`,
    });
  }

  return sections.map((s) => s.content).join("");
}

/** Strip leading bullet marker (`-`, `*`, `•`) and surrounding whitespace. */
export function normalizeBullet(text: string): string {
  return text.replace(/^[\s]*[-*•]\s*/, "").trim();
}

// ─── Section structure parsing (read-side summarisation) ──────────────────

export interface SubsectionSummary {
  name: string;
  proseFirstSentence: string;
  bulletCount: number;
}

export interface LooseFact {
  id: string; // L1, L2, ...
  text: string; // normalised bullet text (without leading "- ")
}

export interface SectionStructure {
  subsections: SubsectionSummary[];
  looseFacts: LooseFact[];
}

const TOMBSTONE_PREFIX = "⚠ Possibly outdated:";

function isTombstoneBullet(normalised: string): boolean {
  return normalised.startsWith(TOMBSTONE_PREFIX);
}

function isBulletLine(trimmed: string): boolean {
  return (
    trimmed.startsWith("- ") ||
    trimmed.startsWith("* ") ||
    trimmed.startsWith("• ")
  );
}

function firstSentenceOf(prose: string): string {
  const trimmed = prose.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^[^.!?]*[.!?]/);
  return match ? match[0].trim() : trimmed;
}

/**
 * Read-side parser used to summarise a section's structure for the LLM
 * placement prompt. Never modifies the doc; returns subsection anchors and
 * loose-fact bullets with stable IDs (`L1`, `L2`, ...).
 */
export function parseSectionStructure(
  doc: string,
  sectionTitle: string,
): SectionStructure {
  const sections = splitByH2Markdown(doc);
  const target = sections.find((s) =>
    headingMatchesCanonical(s.heading, sectionTitle),
  );
  if (!target) return { subsections: [], looseFacts: [] };

  const firstNewline = target.content.indexOf("\n");
  const body = firstNewline >= 0 ? target.content.slice(firstNewline + 1) : "";
  const lines = body.split("\n");

  const looseFacts: LooseFact[] = [];
  const subsections: SubsectionSummary[] = [];

  let inSubsection = false;
  let currentName: string | null = null;
  let currentProse = "";
  let currentBulletCount = 0;
  let proseClosed = false;

  const flushSubsection = () => {
    if (currentName === null) return;
    subsections.push({
      name: currentName,
      proseFirstSentence: firstSentenceOf(currentProse),
      bulletCount: currentBulletCount,
    });
    currentName = null;
    currentProse = "";
    currentBulletCount = 0;
    proseClosed = false;
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("### ")) {
      flushSubsection();
      inSubsection = true;
      currentName = trimmed.slice(4).trim();
      continue;
    }

    if (trimmed.startsWith("## ")) {
      break; // defensive — we sliced one section
    }

    if (trimmed.startsWith("[Confidence:")) continue;

    if (!inSubsection) {
      if (isBulletLine(trimmed)) {
        const norm = normalizeBullet(trimmed);
        if (norm && !isTombstoneBullet(norm)) {
          looseFacts.push({ id: `L${looseFacts.length + 1}`, text: norm });
        }
      }
      continue;
    }

    if (isBulletLine(trimmed)) {
      proseClosed = true;
      const norm = normalizeBullet(trimmed);
      if (norm && !isTombstoneBullet(norm)) {
        currentBulletCount++;
      }
      continue;
    }

    if (!proseClosed && trimmed) {
      currentProse = currentProse ? `${currentProse} ${trimmed}` : trimmed;
    }
  }

  flushSubsection();

  return { subsections, looseFacts };
}

// ─── Write-side bullet ops ─────────────────────────────────────────────────

function getSectionBody(sectionContent: string): string {
  const firstNewline = sectionContent.indexOf("\n");
  if (firstNewline < 0) return "";
  return sectionContent.slice(firstNewline + 1);
}

function rewriteSectionBody(
  doc: string,
  sectionTitle: string,
  rewriteBody: (body: string) => string,
): string {
  const sections = splitByH2Markdown(doc);
  const idx = sections.findIndex((s) =>
    headingMatchesCanonical(s.heading, sectionTitle),
  );
  if (idx < 0) return doc;
  const existing = sections[idx];

  const headingLine = existing.content.slice(0, existing.content.indexOf("\n"));
  const body = getSectionBody(existing.content);
  const newBody = rewriteBody(body);
  if (newBody === body) return doc;
  sections[idx] = {
    heading: existing.heading,
    content: `${headingLine}\n${newBody}`,
  };
  return sections.map((s) => s.content).join("");
}

/**
 * Append a bullet at the end of the named subsection's bullets zone.
 * No-op if the section or subsection isn't found. Preserves all surrounding
 * content byte-for-byte.
 */
export function appendBulletToSubsection(
  doc: string,
  sectionTitle: string,
  subsectionName: string,
  bullet: string,
): string {
  return rewriteSectionBody(doc, sectionTitle, (body) => {
    const lines = body.split("\n");
    const wantedName = subsectionName.trim().toLowerCase();
    let subStart = -1;
    let subEnd = lines.length;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith("### ")) {
        const name = trimmed.slice(4).trim().toLowerCase();
        if (subStart === -1 && name === wantedName) {
          subStart = i;
        } else if (subStart !== -1) {
          subEnd = i;
          break;
        }
      }
    }
    if (subStart === -1) return body;

    // Insert after the last non-blank, non-tombstone bullet; if no bullets
    // yet, append at the end of the subsection with a blank separator.
    let lastBulletIdx = -1;
    for (let i = subStart + 1; i < subEnd; i++) {
      const trimmed = lines[i].trim();
      if (!isBulletLine(trimmed)) continue;
      const norm = normalizeBullet(trimmed);
      if (isTombstoneBullet(norm)) continue;
      lastBulletIdx = i;
    }

    const newLine = `- ${bullet}`;
    if (lastBulletIdx !== -1) {
      lines.splice(lastBulletIdx + 1, 0, newLine);
    } else {
      let insertAt = subEnd;
      while (insertAt > subStart + 1 && lines[insertAt - 1].trim() === "") {
        insertAt--;
      }
      lines.splice(insertAt, 0, "", newLine);
    }
    return lines.join("\n");
  });
}

/**
 * Append a loose-fact bullet at the end of the loose-facts zone — after the
 * last existing loose bullet, always before the first `### subsection`.
 */
export function appendLooseFactBullet(
  doc: string,
  sectionTitle: string,
  bullet: string,
): string {
  return rewriteSectionBody(doc, sectionTitle, (body) => {
    const lines = body.split("\n");
    let firstSubsectionIdx = lines.findIndex((l) => l.trim().startsWith("### "));
    if (firstSubsectionIdx === -1) {
      firstSubsectionIdx = lines.findIndex((l) => {
        const t = l.trim();
        if (t.startsWith("[Confidence:")) return true;
        if (isBulletLine(t) && isTombstoneBullet(normalizeBullet(t))) return true;
        return false;
      });
      if (firstSubsectionIdx === -1) firstSubsectionIdx = lines.length;
    }

    let lastLooseIdx = -1;
    for (let i = 0; i < firstSubsectionIdx; i++) {
      const trimmed = lines[i].trim();
      if (!isBulletLine(trimmed)) continue;
      const norm = normalizeBullet(trimmed);
      if (isTombstoneBullet(norm)) continue;
      lastLooseIdx = i;
    }

    const newLine = `- ${bullet}`;
    if (lastLooseIdx !== -1) {
      lines.splice(lastLooseIdx + 1, 0, newLine);
    } else {
      let insertAt = 0;
      while (insertAt < firstSubsectionIdx && lines[insertAt].trim() === "") {
        insertAt++;
      }
      if (insertAt > 0 && lines[insertAt - 1].trim() !== "") {
        lines.splice(insertAt, 0, "", newLine, "");
      } else {
        lines.splice(insertAt, 0, newLine, "");
      }
    }
    return lines.join("\n");
  });
}

// ─── New subsection operations ─────────────────────────────────────────────

function buildSubsectionBlock(
  name: string,
  prose: string,
  bullets: string[],
): string {
  const proseTrim = prose.trim();
  const bulletLines = bullets.map((b) => `- ${b}`).join("\n");
  return `### ${name}\n\n${proseTrim}\n\n${bulletLines}\n`;
}

/**
 * Append a new ### subsection (prose + initial bullets) at the end of the
 * section's subsection list — just before the tombstone block and the
 * [Confidence: …] line. Creates the section if missing.
 */
export function appendNewSubsection(
  doc: string,
  sectionTitle: string,
  subsectionName: string,
  prose: string,
  bullets: string[],
): string {
  const sections = splitByH2Markdown(doc);
  const idx = sections.findIndex((s) =>
    headingMatchesCanonical(s.heading, sectionTitle),
  );
  if (idx < 0) {
    const body = buildSubsectionBlock(subsectionName, prose, bullets);
    return mergeSectionIntoMarkdown(doc, sectionTitle, body);
  }

  return rewriteSectionBody(doc, sectionTitle, (body) => {
    const lines = body.split("\n");
    let endOfSubsections = lines.length;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith("[Confidence:")) {
        endOfSubsections = i;
        break;
      }
      if (isBulletLine(trimmed) && isTombstoneBullet(normalizeBullet(trimmed))) {
        endOfSubsections = i;
        break;
      }
    }
    while (endOfSubsections > 0 && lines[endOfSubsections - 1].trim() === "") {
      endOfSubsections--;
    }
    const block = buildSubsectionBlock(subsectionName, prose, bullets);
    const before = lines.slice(0, endOfSubsections).join("\n");
    const after = lines.slice(endOfSubsections).join("\n");
    const sep = before.endsWith("\n") || before === "" ? "\n" : "\n\n";
    const tail = after.startsWith("\n") || after === "" ? "" : "\n";
    return `${before}${sep}${block}${tail}${after}`;
  });
}

/**
 * Append a canonical ## SECTION heading with an empty content area at the
 * end of the doc. No-op if the section already exists.
 */
export function appendNewSection(doc: string, sectionTitle: string): string {
  const sections = splitByH2Markdown(doc);
  const exists = sections.some((s) =>
    headingMatchesCanonical(s.heading, sectionTitle),
  );
  if (exists) return doc;
  const sep = doc.length === 0 || doc.endsWith("\n") ? "" : "\n";
  return `${doc}${sep}\n## ${sectionTitle}\n\n`;
}

/**
 * Atomic structural promotion: remove the named loose-fact bullets (by exact
 * normalised text) and append a new ### subsection. Bullets that don't
 * exact-match are kept (user edits are protected). If no loose bullets
 * matched, the operation is a no-op.
 */
export function promoteLooseFactsToSubsection(
  doc: string,
  sectionTitle: string,
  looseTextsToRemove: string[],
  subsectionName: string,
  prose: string,
  bullets: string[],
): string {
  const sections = splitByH2Markdown(doc);
  const idx = sections.findIndex((s) =>
    headingMatchesCanonical(s.heading, sectionTitle),
  );
  if (idx < 0) return doc;

  const wantedSet = new Set(looseTextsToRemove.map((t) => t.trim()));

  const headingLine = sections[idx].content.slice(
    0,
    sections[idx].content.indexOf("\n"),
  );
  const body = getSectionBody(sections[idx].content);
  const lines = body.split("\n");
  const firstSubIdx = lines.findIndex((l) => l.trim().startsWith("### "));
  const looseZoneEnd = firstSubIdx === -1 ? lines.length : firstSubIdx;

  let matched = 0;
  for (let i = 0; i < looseZoneEnd; i++) {
    const trimmed = lines[i].trim();
    if (!isBulletLine(trimmed)) continue;
    const norm = normalizeBullet(trimmed);
    if (isTombstoneBullet(norm)) continue;
    if (wantedSet.has(norm)) matched++;
  }
  if (matched === 0) return doc;

  const newLines: string[] = [];
  for (let i = 0; i < looseZoneEnd; i++) {
    const trimmed = lines[i].trim();
    if (isBulletLine(trimmed)) {
      const norm = normalizeBullet(trimmed);
      if (!isTombstoneBullet(norm) && wantedSet.has(norm)) {
        continue; // drop this loose bullet
      }
    }
    newLines.push(lines[i]);
  }
  for (let i = looseZoneEnd; i < lines.length; i++) {
    newLines.push(lines[i]);
  }

  const newBody = newLines.join("\n");
  sections[idx] = {
    heading: sections[idx].heading,
    content: `${headingLine}\n${newBody}`,
  };
  const docAfterDelete = sections.map((s) => s.content).join("");

  return appendNewSubsection(
    docAfterDelete,
    sectionTitle,
    subsectionName,
    prose,
    bullets,
  );
}

/**
 * Append a `- ⚠ Possibly outdated: <fact>` bullet at the bottom of a
 * section's content area, just before any `[Confidence: …]` line. No-op if
 * the section doesn't exist. Tombstones are never deduped.
 */
export function appendTombstone(
  doc: string,
  sectionTitle: string,
  originalFact: string,
): string {
  return rewriteSectionBody(doc, sectionTitle, (body) => {
    const lines = body.split("\n");
    const confidenceIdx = lines.findIndex((l) =>
      l.trim().startsWith("[Confidence:"),
    );
    const tombstoneLine = `- ⚠ Possibly outdated: ${originalFact}`;
    if (confidenceIdx === -1) {
      let endIdx = lines.length;
      while (endIdx > 0 && lines[endIdx - 1].trim() === "") endIdx--;
      lines.splice(endIdx, 0, "", tombstoneLine);
    } else {
      lines.splice(confidenceIdx, 0, tombstoneLine, "");
    }
    return lines.join("\n");
  });
}

/**
 * Pure-code dispatcher: turn an LLM placement decision into a doc edit.
 * Falls back gracefully — skip → no-op; promote with no resolvable IDs →
 * add_to_loose_facts; a decision against a missing section → no-op.
 */
export function applyPlacementDecision(
  doc: string,
  sectionTitle: string,
  decision: PlacementDecision,
  looseIdToText: Map<string, string> = new Map(),
): string {
  switch (decision.decision) {
    case "skip":
      return doc;

    case "append_to_subsection":
      return appendBulletToSubsection(
        doc,
        sectionTitle,
        decision.subsection,
        decision.bullet,
      );

    case "add_to_loose_facts":
      return appendLooseFactBullet(doc, sectionTitle, decision.bullet);

    case "promote_to_new_subsection": {
      const looseTextsToRemove: string[] = [];
      for (const id of decision.promoted_loose_ids) {
        const text = looseIdToText.get(id);
        if (text) looseTextsToRemove.push(text);
      }
      if (looseTextsToRemove.length === 0) {
        const newFactBullet = decision.bullets[0] ?? "";
        if (!newFactBullet) return doc;
        return appendLooseFactBullet(doc, sectionTitle, newFactBullet);
      }
      return promoteLooseFactsToSubsection(
        doc,
        sectionTitle,
        looseTextsToRemove,
        decision.subsection,
        decision.prose,
        decision.bullets,
      );
    }
  }
}

// ===========================================================================
// Persona document storage (documents row type='persona', single row)
// ===========================================================================

export class PersonaExistsError extends Error {
  readonly status = 409;
  constructor() {
    super(
      "persona document already exists — full regeneration over an existing doc is forbidden (user edits live in the doc); use incremental updates",
    );
    this.name = "PersonaExistsError";
  }
}

export interface PersonaDocument {
  id: string;
  content: string;
  title: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

interface PersonaDocRow {
  id: string;
  title: string;
  content: string;
  version: number;
  metadata: string;
  created_at: string;
  updated_at: string;
}

/** The single persona documents row, or null. Exported for A7 (memory_about_user)
 *  and C4 (Jarvis context preload). */
export function getPersonaDocument(): PersonaDocument | null {
  const row = getDb()
    .prepare("SELECT * FROM documents WHERE type = 'persona' LIMIT 1")
    .get() as PersonaDocRow | undefined;
  if (!row) return null;
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(row.metadata) as Record<string, unknown>;
  } catch {
    /* malformed metadata tolerated */
  }
  return {
    id: row.id,
    content: row.content,
    title: row.title,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata,
  };
}

/** Upsert the single persona row (REF savePersonaDocument, Prisma → SQL).
 *  Bumps documents.version on update; mirrors the Persona label. */
function savePersonaDocument(content: string, labelId?: string): string {
  const ts = now();
  const existing = getPersonaDocument();
  const id = existing?.id ?? newUuid();
  const metadata = JSON.stringify({ generatedAt: ts, version: "v2" });
  tx((db) => {
    if (existing) {
      db.prepare(
        `UPDATE documents SET content = ?, source = 'persona-v2', metadata = ?,
                              version = version + 1, updated_at = ?
         WHERE id = ?`,
      ).run(content, metadata, ts, id);
    } else {
      db.prepare(
        `INSERT INTO documents (id, session_id, title, content, source, type, version,
                                metadata, created_at, updated_at)
         VALUES (?, ?, 'Persona', ?, 'persona-v2', 'persona', 1, ?, ?, ?)`,
      ).run(id, PERSONA_SESSION_ID, content, metadata, ts, ts);
    }
    if (labelId) {
      db.prepare(
        "INSERT OR IGNORE INTO document_labels (document_id, label_id) VALUES (?, ?)",
      ).run(id, labelId);
    }
  });
  return id;
}

// meta-table helpers (REF workspace.metadata.lastPersonaGenerationAt)
function getLastGenerationAt(): string | null {
  const row = getDb()
    .prepare("SELECT value FROM meta WHERE key = ?")
    .get(LAST_GENERATION_META_KEY) as { value: string } | undefined;
  return row?.value ?? null;
}

function setLastGenerationAt(): void {
  getDb()
    .prepare(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(LAST_GENERATION_META_KEY, now());
}

/** Auto-create the "Persona" label if missing (REF trigger behavior; color
 *  and description verbatim). labels.ts already excludes it from assignment. */
async function ensurePersonaLabel(): Promise<LabelRow> {
  const existing = getLabelByName(PERSONA_LABEL_NAME);
  if (existing) return existing;
  return createLabel({
    name: PERSONA_LABEL_NAME,
    color: "#009CF3",
    description: "Personal persona generated from your episodes",
  });
}

// ===========================================================================
// Fact fetch (SQL over statements/edges/voice_aspects — read-side, same
// pattern as search/handlers.ts)
// ===========================================================================

interface AspectFact {
  aspect: StatementAspect;
  fact: string;
}

/** Valid + invalidated persona-relevant facts touching one episode, across
 *  BOTH stores (REF fetchEpisodeFactsForPersona — the graph/voice split is
 *  load-bearing; an invalidate-only episode still counts). */
export function fetchEpisodeFactsForPersona(episodeUuid: string): {
  validFacts: AspectFact[];
  invalidatedFacts: AspectFact[];
} {
  const db = getDb();
  const graphIn = PERSONA_GRAPH_ASPECTS.map(() => "?").join(",");
  const voiceIn = PERSONA_VOICE_ASPECTS.map(() => "?").join(",");

  // Graph: provenance-linked, still valid (REF getStatementsForEpisodeByAspects)
  const graphValid = db
    .prepare(
      `SELECT s.fact AS fact, s.aspect AS aspect
       FROM edges e JOIN statements s ON s.uuid = e.to_uuid
       WHERE e.type = 'provenance' AND e.from_uuid = ?
         AND s.invalid_at IS NULL AND s.aspect IN (${graphIn})`,
    )
    .all(episodeUuid, ...PERSONA_GRAPH_ASPECTS) as AspectFact[];

  // Voice: episode listed in episode_uuids, still valid (REF getVoiceAspectsForEpisode)
  const voiceValid = db
    .prepare(
      `SELECT va.fact AS fact, va.aspect AS aspect
       FROM voice_aspects va
       WHERE va.invalid_at IS NULL AND va.aspect IN (${voiceIn})
         AND EXISTS (SELECT 1 FROM json_each(va.episode_uuids) je WHERE je.value = ?)`,
    )
    .all(...PERSONA_VOICE_ASPECTS, episodeUuid) as AspectFact[];

  // Invalidated BY this episode (tombstone payloads — pre-invalidation fact)
  const graphInvalidated = db
    .prepare(
      `SELECT fact, aspect FROM statements
       WHERE invalidated_by = ? AND aspect IN (${graphIn})`,
    )
    .all(episodeUuid, ...PERSONA_GRAPH_ASPECTS) as AspectFact[];
  const voiceInvalidated = db
    .prepare(
      `SELECT fact, aspect FROM voice_aspects
       WHERE invalidated_by = ? AND aspect IN (${voiceIn})`,
    )
    .all(episodeUuid, ...PERSONA_VOICE_ASPECTS) as AspectFact[];

  return {
    validFacts: [...graphValid, ...voiceValid],
    invalidatedFacts: [...graphInvalidated, ...voiceInvalidated],
  };
}

interface AspectData {
  aspect: StatementAspect;
  statements: PersonaFactInput[];
  episodes: PersonaEpisodeInput[];
}

/**
 * All valid statements grouped by aspect with their provenance episodes,
 * plus active voice aspects merged in as synthetic statements
 * (REF getStatementsByAspectWithEpisodes).
 */
function getStatementsByAspectWithEpisodes(): Map<StatementAspect, AspectData> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT s.aspect AS aspect, s.uuid AS suuid, s.fact AS fact,
              s.created_at AS screated,
              ep.uuid AS euuid, ep.content AS econtent, ep.created_at AS ecreated
       FROM statements s
       LEFT JOIN edges e ON e.type = 'provenance' AND e.to_uuid = s.uuid
       LEFT JOIN episodes ep ON ep.uuid = e.from_uuid
       WHERE s.invalid_at IS NULL AND s.aspect IS NOT NULL
       ORDER BY s.aspect`,
    )
    .all() as {
    aspect: StatementAspect;
    suuid: string;
    fact: string;
    screated: string;
    euuid: string | null;
    econtent: string | null;
    ecreated: string | null;
  }[];

  const map = new Map<StatementAspect, AspectData>();
  const seenStatements = new Map<StatementAspect, Set<string>>();
  const seenEpisodes = new Map<StatementAspect, Set<string>>();

  for (const r of rows) {
    let data = map.get(r.aspect);
    if (!data) {
      data = { aspect: r.aspect, statements: [], episodes: [] };
      map.set(r.aspect, data);
      seenStatements.set(r.aspect, new Set());
      seenEpisodes.set(r.aspect, new Set());
    }
    if (!seenStatements.get(r.aspect)!.has(r.suuid)) {
      seenStatements.get(r.aspect)!.add(r.suuid);
      data.statements.push({ fact: r.fact, createdAt: r.screated });
    }
    if (r.euuid && r.econtent && !seenEpisodes.get(r.aspect)!.has(r.euuid)) {
      seenEpisodes.get(r.aspect)!.add(r.euuid);
      data.episodes.push({ content: r.econtent, createdAt: r.ecreated ?? r.screated });
    }
  }

  // Merge active voice aspects as synthetic statements (dedupe by fact text)
  const voiceRows = db
    .prepare(
      `SELECT fact, aspect, created_at FROM voice_aspects
       WHERE invalid_at IS NULL
       ORDER BY created_at DESC LIMIT 200`,
    )
    .all() as { fact: string; aspect: string; created_at: string }[];

  for (const va of voiceRows) {
    if (!VOICE_ASPECTS_SET.has(va.aspect)) continue;
    const aspect = va.aspect as StatementAspect;
    const existing = map.get(aspect);
    if (existing) {
      if (!existing.statements.some((s) => s.fact === va.fact)) {
        existing.statements.push({ fact: va.fact, createdAt: va.created_at });
      }
    } else {
      map.set(aspect, {
        aspect,
        statements: [{ fact: va.fact, createdAt: va.created_at }],
        episodes: [],
      });
    }
  }

  return map;
}

// ===========================================================================
// Full-mode generation (REF aspect-persona-generation.ts, direct-call branch)
// ===========================================================================

/**
 * Strip structural markdown headings (# and ##) from LLM output — prevents
 * duplicate document/section headers. Preserves ### sub-headers. Only run on
 * LLM-produced text, never on user-edited content.
 */
function sanitizeSectionContent(content: string): string {
  return content
    .replace(/^#{1,2}\s+.*$/gm, "")
    .replace(/<!-- section:\w+ -->/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface ChunkData {
  statements: PersonaFactInput[];
  episodes: PersonaEpisodeInput[];
  chunkIndex: number;
  totalChunks: number;
  isLatest: boolean;
}

/** Split aspect data into recency-first chunks (30 statements / 20 episodes). */
function chunkAspectData(aspectData: AspectData): ChunkData[] {
  const sortedStatements = [...aspectData.statements].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const sortedEpisodes = [...aspectData.episodes].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );

  const numChunks = Math.max(
    Math.ceil(sortedStatements.length / MAX_STATEMENTS_PER_CHUNK),
    1,
  );

  const chunks: ChunkData[] = [];
  for (let i = 0; i < numChunks; i++) {
    const stmtStart = i * MAX_STATEMENTS_PER_CHUNK;
    const stmtEnd = Math.min(stmtStart + MAX_STATEMENTS_PER_CHUNK, sortedStatements.length);
    const epStart = i * MAX_EPISODES_PER_CHUNK;
    const epEnd = Math.min(epStart + MAX_EPISODES_PER_CHUNK, sortedEpisodes.length);
    chunks.push({
      statements: sortedStatements.slice(stmtStart, stmtEnd),
      episodes: sortedEpisodes.slice(epStart, epEnd),
      chunkIndex: i,
      totalChunks: numChunks,
      isLatest: i === 0,
    });
  }
  return chunks;
}

/** Direct chat call returning null on failure (REF directLLMCall semantics —
 *  null means "skip this piece this run", never a thrown pipeline failure). */
async function directCall(prompt: string): Promise<string | null> {
  try {
    return await modelCallText([{ role: "user", content: prompt }], "medium");
  } catch (err) {
    console.warn(
      "[v2/memory/persona] direct LLM call failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/** Large-section path: per-chunk summaries fanned out, then one merge call. */
async function generateSectionWithChunking(
  aspectData: AspectData,
): Promise<string | null> {
  const chunks = chunkAspectData(aspectData);

  const directResults = await Promise.all(
    chunks.map((chunk) =>
      directCall(
        buildChunkSummaryPrompt({
          aspect: aspectData.aspect,
          statements: chunk.statements,
          episodes: chunk.episodes,
          chunkIndex: chunk.chunkIndex,
          totalChunks: chunk.totalChunks,
          isLatest: chunk.isLatest,
        }),
      ),
    ),
  );
  const chunkSummaries = directResults.filter(
    (c): c is string => !!c && !c.includes("NO_PATTERNS"),
  );

  if (chunkSummaries.length === 0) return "INSUFFICIENT_DATA";
  if (chunkSummaries.length === 1) return chunkSummaries[0];

  const merged = await directCall(
    buildMergePrompt({ aspect: aspectData.aspect, chunkSummaries }),
  );
  return merged ?? chunkSummaries[0];
}

interface PersonaSectionResult {
  aspect: StatementAspect;
  title: string;
  content: string;
}

async function generateAllAspectSections(
  aspectDataMap: Map<StatementAspect, AspectData>,
  userContext: PersonaUserContext,
): Promise<PersonaSectionResult[]> {
  const largeAspects: AspectData[] = [];
  const smallAspects: AspectData[] = [];

  for (const [aspect, data] of aspectDataMap) {
    if (SKIPPED_ASPECTS.includes(aspect)) continue;
    if (data.statements.length < MIN_STATEMENTS_PER_SECTION) continue;
    if (data.statements.length > MAX_STATEMENTS_PER_CHUNK) largeAspects.push(data);
    else smallAspects.push(data);
  }

  if (largeAspects.length === 0 && smallAspects.length === 0) return [];

  const tasks: Promise<PersonaSectionResult[]>[] = [];

  for (const aspectData of largeAspects) {
    tasks.push(
      generateSectionWithChunking(aspectData).then((content) => {
        if (content && !content.includes("INSUFFICIENT_DATA")) {
          return [
            {
              aspect: aspectData.aspect,
              title: ASPECT_SECTION_MAP[aspectData.aspect].title,
              content,
            },
          ];
        }
        return [];
      }),
    );
  }

  if (smallAspects.length > 0) {
    tasks.push(
      (async () => {
        const sorted = smallAspects.map((aspectData) => ({
          ...aspectData,
          statements: [...aspectData.statements].sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt),
          ),
          episodes: [...aspectData.episodes].sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt),
          ),
        }));

        const results: PersonaSectionResult[] = [];
        const directResults = await Promise.all(
          sorted.map((aspectData) =>
            directCall(
              buildAspectSectionPrompt({
                aspect: aspectData.aspect,
                statements: aspectData.statements,
                episodes: aspectData.episodes,
                userContext,
              }),
            ),
          ),
        );
        for (let i = 0; i < directResults.length; i++) {
          const content = directResults[i];
          if (!content || content.includes("INSUFFICIENT_DATA")) continue;
          results.push({
            aspect: sorted[i].aspect,
            title: ASPECT_SECTION_MAP[sorted[i].aspect].title,
            content,
          });
        }
        return results;
      })(),
    );
  }

  const all = await Promise.all(tasks);
  return all.flat();
}

/** Combine sections into the final doc — IDENTITY-only order, sections always
 *  emitted even when empty (REF combineIntoPersonaDocument). */
function combineIntoPersonaDocument(sections: PersonaSectionResult[]): string {
  const sectionOrder: StatementAspect[] = ["Identity"];
  const sectionsByAspect = new Map(sections.map((s) => [s.aspect, s]));

  let document = "# PERSONA\n\n";
  for (const aspect of sectionOrder) {
    const section = sectionsByAspect.get(aspect);
    const title = ASPECT_SECTION_MAP[aspect].title;
    document += `## ${title}\n\n`;
    if (section) {
      document += `${sanitizeSectionContent(section.content)}\n\n`;
    }
  }
  return document.trim();
}

function personaUserContext(): PersonaUserContext {
  return { name: DEFAULT_USER_NAME };
}

/** Full-mode content generation (REF generateAspectBasedPersona, direct-call). */
async function generateAspectBasedPersona(): Promise<string> {
  const userContext = personaUserContext();
  const aspectDataMap = getStatementsByAspectWithEpisodes();

  // User-config fields as synthetic Identity statements (full mode only —
  // single-user install carries name only; SPEC A6.1 "userName synthetics").
  const syntheticIdentityFacts: string[] = [];
  if (userContext.name) syntheticIdentityFacts.push(`Name: ${userContext.name}`);

  if (syntheticIdentityFacts.length > 0) {
    const existingIdentity = aspectDataMap.get("Identity");
    const ts = now();
    const newStatements = syntheticIdentityFacts
      .filter((fact) => !existingIdentity?.statements.some((s) => s.fact === fact))
      .map((fact): PersonaFactInput => ({ fact, createdAt: ts }));
    if (newStatements.length > 0) {
      if (existingIdentity) existingIdentity.statements.push(...newStatements);
      else
        aspectDataMap.set("Identity", {
          aspect: "Identity",
          statements: newStatements,
          episodes: [],
        });
    }
  }

  if (aspectDataMap.size === 0) {
    return "# PERSONA\n\nInsufficient data to generate persona. Continue using the system to build your knowledge graph.";
  }

  const sections = await generateAllAspectSections(aspectDataMap, userContext);
  if (sections.length === 0) {
    return "# PERSONA\n\nInsufficient data in each aspect to generate meaningful persona sections. Continue using the system to build your knowledge graph.";
  }

  return combineIntoPersonaDocument(sections);
}

// ===========================================================================
// Incremental placement LLM calls (REF persona-llm-placement.ts, direct)
// ===========================================================================

/** Strip markdown fences / <output> wrapping, keeping REF's tolerant contract:
 *  null = "skip for this run" (the next episode touching the aspect retries). */
function extractJsonPayload(raw: string, arrayMode: boolean): string | null {
  let text = raw.trim();
  const tag = /<output>([\s\S]*?)<\/output>/i.exec(text);
  if (tag) text = tag[1].trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const open = arrayMode ? "[" : "{";
  const close = arrayMode ? "]" : "}";
  const first = text.indexOf(open);
  const last = text.lastIndexOf(close);
  if (first === -1 || last <= first) return null;
  return text.slice(first, last + 1);
}

/** Per-fact placement decision, null on any call/parse/validation failure. */
async function placeFactInPersona(input: {
  aspect: StatementAspect;
  fact: string;
  structure: SectionStructure;
  filterGuidance: string;
}): Promise<PlacementDecision | null> {
  try {
    const raw = await modelCallText(
      [{ role: "user", content: buildPlacementPrompt(input) }],
      "medium",
    );
    const payload = extractJsonPayload(raw, false);
    if (!payload) {
      console.warn("[v2/memory/persona] placement output had no JSON object", {
        aspect: input.aspect,
      });
      return null;
    }
    const validated = PlacementDecisionSchema.safeParse(JSON.parse(payload));
    if (!validated.success) {
      console.warn("[v2/memory/persona] placement output failed schema", {
        aspect: input.aspect,
        issues: validated.error.issues.map((i) => i.message).join("; "),
      });
      return null;
    }
    return validated.data;
  } catch (err) {
    console.warn(
      "[v2/memory/persona] placement LLM call failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/** Batched placement: ordered decisions for all NEW facts of one aspect from
 *  one episode. Malformed entries are dropped; null = skip all this run. */
async function placeFactsInPersona(input: {
  aspect: StatementAspect;
  facts: string[];
  structure: SectionStructure;
  filterGuidance: string;
  episodeContent?: string;
}): Promise<PlacementDecision[] | null> {
  if (input.facts.length === 0) return [];
  try {
    const raw = await modelCallText(
      [{ role: "user", content: buildBatchPlacementPrompt(input) }],
      "medium",
    );
    const payload = extractJsonPayload(raw, true);
    if (!payload) {
      console.warn("[v2/memory/persona] batch placement output had no JSON array", {
        aspect: input.aspect,
      });
      return null;
    }
    const parsed = JSON.parse(payload) as unknown;
    if (!Array.isArray(parsed)) return null;
    const decisions: PlacementDecision[] = [];
    for (let i = 0; i < parsed.length; i++) {
      const validated = BatchDecisionSchema.safeParse(parsed[i]);
      if (!validated.success) {
        console.warn("[v2/memory/persona] dropping malformed batch decision", {
          aspect: input.aspect,
          index: i,
        });
        continue;
      }
      decisions.push(validated.data as PlacementDecision);
    }
    return decisions;
  } catch (err) {
    console.warn(
      "[v2/memory/persona] batch placement LLM call failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

// ===========================================================================
// Trigger + orchestration (REF persona-trigger.logic.ts +
// persona-generation.logic.ts processPersonaGeneration)
// ===========================================================================

export interface PersonaThresholdCheck {
  shouldGenerate: boolean;
  labelId?: string;
  mode?: "full" | "incremental";
  startTime?: string;
  reason?: string;
}

/**
 * Worthiness gate for the auto trigger (REF checkPersonaUpdateThreshold):
 * gate on settings.memory.personaAutoUpdate; auto-create the Persona label;
 * first-run → full; per-episode → incremental iff the episode produced ≥1
 * new OR invalidated Identity/Preference/Directive fact.
 */
export async function checkPersonaUpdateThreshold(
  episodeUuid?: string,
): Promise<PersonaThresholdCheck> {
  try {
    if (readSettings().memory?.personaAutoUpdate === false) {
      return { shouldGenerate: false, reason: "auto_update_persona_disabled" };
    }

    let label: LabelRow;
    try {
      label = await ensurePersonaLabel();
    } catch (err) {
      console.error("[v2/memory/persona] failed to create Persona label:", err);
      return { shouldGenerate: false, reason: "failed_to_create_label" };
    }

    const latestPersona = getPersonaDocument();

    // First generation: always generate if no persona exists yet
    if (!latestPersona) {
      return {
        shouldGenerate: true,
        labelId: label.id,
        mode: "full",
        reason: "no existing persona",
      };
    }

    const lastPersonaGenerationAt = getLastGenerationAt();
    if (!lastPersonaGenerationAt) {
      return {
        shouldGenerate: true,
        labelId: label.id,
        mode: "full", // full over an existing doc is refused downstream (invariant)
        reason: "no last generation timestamp",
      };
    }

    // No episodeUuid (manual trigger) → incremental pass
    if (!episodeUuid) {
      return {
        shouldGenerate: true,
        labelId: label.id,
        mode: "incremental",
        startTime: lastPersonaGenerationAt,
        reason: "no episodeUuid provided (manual trigger)",
      };
    }

    // Both stores, both valid and invalidated sides — an "invalidate-only"
    // episode (tombstones only) must still trigger.
    const { validFacts, invalidatedFacts } = fetchEpisodeFactsForPersona(episodeUuid);
    const totalPersonaRelevant = validFacts.length + invalidatedFacts.length;

    if (totalPersonaRelevant > 0) {
      return {
        shouldGenerate: true,
        labelId: label.id,
        mode: "incremental",
        startTime: lastPersonaGenerationAt,
        reason: `episode ${episodeUuid} has ${validFacts.length} new + ${invalidatedFacts.length} invalidated persona-relevant facts`,
      };
    }

    return {
      shouldGenerate: false,
      reason: `episode ${episodeUuid} has no Identity/Preference/Directive new or invalidated facts`,
    };
  } catch (err) {
    console.warn(
      "[v2/memory/persona] threshold check failed:",
      err instanceof Error ? err.message : err,
    );
    return { shouldGenerate: false, reason: "error" };
  }
}

function sectionTitleFor(aspect: StatementAspect): string {
  const entry = ASPECT_SECTION_MAP[aspect];
  if (!entry) {
    throw new Error(`No ASPECT_SECTION_MAP entry for aspect: ${aspect}`);
  }
  return entry.title;
}

export interface PersonaUpdateResult {
  success: boolean;
  mode: "full" | "incremental" | "none";
  changed: boolean;
  summaryLength: number;
  reason?: string;
}

/**
 * Per-episode incremental pass (REF processPersonaGeneration incremental
 * branch): tombstones first (PURE CODE, no LLM), placements second (per-fact
 * fast path for singles, batched path for multi-fact aspect groups), ONE save.
 */
async function applyEpisodeUpdate(
  existingContent: string,
  episodeUuid: string,
  labelId?: string,
): Promise<PersonaUpdateResult> {
  const { validFacts, invalidatedFacts } = fetchEpisodeFactsForPersona(episodeUuid);

  if (validFacts.length === 0 && invalidatedFacts.length === 0) {
    return {
      success: true,
      mode: "incremental",
      changed: false,
      summaryLength: existingContent.length,
      reason: "no persona-relevant changes",
    };
  }

  let doc = existingContent;

  // Step A: tombstones first. Pure code, no LLM.
  for (const { aspect, fact } of invalidatedFacts) {
    doc = appendTombstone(doc, sectionTitleFor(aspect), fact);
  }

  // Step B: placements second, grouped by aspect.
  const factsByAspect = new Map<StatementAspect, string[]>();
  for (const { aspect, fact } of validFacts) {
    const list = factsByAspect.get(aspect) ?? [];
    list.push(fact);
    factsByAspect.set(aspect, list);
  }

  // Lazy-load episode content once, only when any aspect group has ≥2 facts.
  let episodeContent: string | undefined;
  const needsEpisodeContent = Array.from(factsByAspect.values()).some(
    (facts) => facts.length >= 2,
  );
  if (needsEpisodeContent) {
    try {
      episodeContent = getEpisode(episodeUuid)?.content ?? undefined;
    } catch (err) {
      console.warn(
        "[v2/memory/persona] could not load episode content for batched placement:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  for (const [aspect, facts] of factsByAspect) {
    const title = sectionTitleFor(aspect);

    if (facts.length === 1) {
      // Per-fact fast path — no episode context, single decision.
      const structure = parseSectionStructure(doc, title);
      const looseIdToText = new Map(structure.looseFacts.map((l) => [l.id, l.text]));
      const decision = await placeFactInPersona({
        aspect,
        fact: facts[0],
        structure,
        filterGuidance: ASPECT_SECTION_MAP[aspect].filterGuidance,
      });
      if (!decision) continue;
      doc = applyPlacementDecision(doc, title, decision, looseIdToText);
      continue;
    }

    // Batched path — one call, ordered decisions; structure recomputed
    // between applications so a promote → append chain resolves correctly.
    const initialStructure = parseSectionStructure(doc, title);
    const decisions = await placeFactsInPersona({
      aspect,
      facts,
      structure: initialStructure,
      filterGuidance: ASPECT_SECTION_MAP[aspect].filterGuidance,
      episodeContent,
    });
    if (!decisions || decisions.length === 0) continue;

    for (const decision of decisions) {
      const structure = parseSectionStructure(doc, title);
      const looseIdToText = new Map(structure.looseFacts.map((l) => [l.id, l.text]));
      doc = applyPlacementDecision(doc, title, decision, looseIdToText);
    }
  }

  const changed = doc !== existingContent;
  if (changed) {
    savePersonaDocument(doc, labelId);
    setLastGenerationAt();
    emit("memory.persona.updated", { mode: "incremental", episodeUuid, length: doc.length });
  }

  return {
    success: true,
    mode: "incremental",
    changed,
    summaryLength: doc.length,
  };
}

/**
 * FULL generation — ONLY when no persona doc exists. Throws
 * PersonaExistsError (status 409) otherwise — the invariant the REST route
 * surfaces as HTTP 409. Manual action: bypasses the personaAutoUpdate gate.
 */
export async function generatePersonaFull(): Promise<PersonaDocument> {
  if (getPersonaDocument()) {
    throw new PersonaExistsError();
  }
  const label = await ensurePersonaLabel();
  const summary = await generateAspectBasedPersona();
  savePersonaDocument(summary, label.id);
  setLastGenerationAt();
  emit("memory.persona.updated", { mode: "full", length: summary.length });
  const doc = getPersonaDocument();
  if (!doc) throw new Error("persona document missing after save");
  return doc;
}

/**
 * Incremental update for one episode's persona-relevant facts (bullet ops +
 * tombstones + LLM placement). Requires an existing persona doc.
 */
export async function updatePersonaIncremental(
  episodeUuid: string,
): Promise<PersonaUpdateResult> {
  const existing = getPersonaDocument();
  if (!existing) {
    throw new Error(
      "no persona document exists — run full generation first (POST /persona mode=full)",
    );
  }
  const label = await ensurePersonaLabel();
  return applyEpisodeUpdate(existing.content, episodeUuid, label.id);
}

/**
 * The post-ingestion trigger (queue.ts A6 seam — REF enqueuePersonaGeneration
 * + processPersonaGeneration in one synchronous pass). Never throws.
 */
export async function personaTrigger(episodeUuid?: string): Promise<PersonaUpdateResult> {
  try {
    const check = await checkPersonaUpdateThreshold(episodeUuid);
    if (!check.shouldGenerate || !check.mode) {
      return {
        success: false,
        mode: "none",
        changed: false,
        summaryLength: 0,
        reason: check.reason,
      };
    }

    const existing = getPersonaDocument();

    if (!existing) {
      // First-time generation (full mode).
      const doc = await generatePersonaFull();
      return {
        success: true,
        mode: "full",
        changed: true,
        summaryLength: doc.content.length,
      };
    }

    if (check.mode === "full") {
      // Forbidden by invariant — never replace an existing doc.
      return {
        success: false,
        mode: "full",
        changed: false,
        summaryLength: existing.content.length,
        reason: "persona doc exists — full regen not permitted by invariant",
      };
    }

    if (check.mode !== "incremental" || !episodeUuid) {
      return {
        success: false,
        mode: "none",
        changed: false,
        summaryLength: existing.content.length,
        reason: "nothing actionable",
      };
    }

    return await applyEpisodeUpdate(existing.content, episodeUuid, check.labelId);
  } catch (err) {
    console.warn(
      "[v2/memory/persona] personaTrigger failed (non-fatal):",
      err instanceof Error ? err.message : err,
    );
    return {
      success: false,
      mode: "none",
      changed: false,
      summaryLength: 0,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
