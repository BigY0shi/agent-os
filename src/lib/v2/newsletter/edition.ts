// SPEC-F K4.1 — the edition builder: one day's stories → the EditionDoc.
//
// The payoff of K3.2's dedupe lives here: a story that three newsletters
// covered appears ONCE, carrying three source chips. Nothing on this page is
// estimated — `stats.duplicatesMerged` is summed from real source rows
// (sources.length - 1), never guessed.
//
// SECTIONING is a single provider-routed call (rule 11: the configured agent
// runs or the call FAILS — no silent local fallback). When it fails, the
// classification does NOT silently collapse: it degrades down a stated ladder
//   1. the model's assignment for that story
//   2. the subscription's own `topic`, matched against the configured sections
//   3. "Everything Else"
// and the failure is logged LOUDLY and reported in the build result +
// the route payload, so the UI can say the edition was sectioned by fallback.
//
// IDEMPOTENCY (SPEC-F §5): a build for a date that already has a row returns
// the STORED document — same builtAt — unless `force` is passed. The daily job
// therefore cannot rewrite an edition that has already been read.

import { cliComplete } from "../../loopEngine";
import { readSettings } from "../../settings";
import { emit } from "../events";
import { now } from "../ids";
import { extractJsonObj } from "../json";
import { parseAgent } from "./parse";
import {
  STATE_LAST_EDITION,
  getEdition,
  getEmail,
  getSubscription,
  listStoriesForDate,
  listStorySources,
  patchStory,
  setState,
  today,
  upsertEdition,
} from "./store";
import type { EditionDoc, Story, StorySource } from "./types";

/** The section every unclassifiable story lands in. Always last. */
export const FALLBACK_SECTION = "Everything Else";

export const DEFAULT_SECTIONS = [
  "AI & Agents",
  "Dev & Tools",
  "Business",
  "Security",
  FALLBACK_SECTION,
];

const CLASSIFY_TIMEOUT_MS = 120_000;
/** Hard cap on stories fed to one classification prompt. */
const MAX_CLASSIFY_STORIES = 200;
const CLASSIFY_SUMMARY_CHARS = 240;

/** Configured section names (rule 16), always ending in the fallback. */
export function editionSections(): string[] {
  const raw = readSettings().newsletter?.sections;
  const configured = Array.isArray(raw)
    ? raw.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim())
    : [];
  const list = configured.length > 0 ? configured : [...DEFAULT_SECTIONS];
  const deduped: string[] = [];
  for (const s of list) if (!deduped.some((d) => norm(d) === norm(s))) deduped.push(s);
  if (!deduped.some((s) => norm(s) === norm(FALLBACK_SECTION))) deduped.push(FALLBACK_SECTION);
  return deduped;
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Resolve a free-form label onto one of the configured sections, or null. */
export function matchSection(raw: string | null | undefined, sections: string[]): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const target = norm(raw);
  return sections.find((s) => norm(s) === target) ?? null;
}

// ── the classifier (provider-routed, with a test seam) ───────────────────────

export interface ClassifyInput {
  stories: Array<{ id: string; title: string; summary: string }>;
  sections: string[];
}
export type SectionClassifier = (input: ClassifyInput) => Promise<Record<string, string>>;

let classifierOverride: SectionClassifier | null = null;

/**
 * Test seam (the `__setAddyTransportForTests` idiom): swap the model call for a
 * deterministic function so the smoke can exercise BOTH the success path and a
 * thrown failure with zero model spawns. Null restores the real routing.
 */
export function __setSectionClassifierForTests(fn: SectionClassifier | null): void {
  classifierOverride = fn;
}

function classifyPrompt(input: ClassifyInput): string {
  return [
    "You are the section editor of a daily newspaper assembled from newsletters.",
    "Assign every story below to EXACTLY ONE of these sections, using the section",
    "name verbatim:",
    ...input.sections.map((s) => `- ${s}`),
    "",
    "STORIES:",
    ...input.stories.map(
      (s) => `[${s.id}] ${s.title}${s.summary ? ` — ${s.summary.slice(0, CLASSIFY_SUMMARY_CHARS)}` : ""}`,
    ),
    "",
    'Return ONLY a JSON object (no prose, no fences): { "assignments": { "<story id>": "<section name>" } }',
    "",
    "Rules:",
    "- Every story id above must appear exactly once as a key.",
    "- Use ONLY the section names listed. Never invent a section.",
    `- A story that fits none of them goes in "${FALLBACK_SECTION}".`,
  ].join("\n");
}

/**
 * Ask the configured agent to section the stories. THROWS on a provider failure
 * or unparseable output — the caller catches, logs loudly and falls back.
 */
export async function classifySections(input: ClassifyInput): Promise<Record<string, string>> {
  if (classifierOverride) return classifierOverride(input);
  const agent = parseAgent();
  const raw = await cliComplete(agent, classifyPrompt(input), { timeoutMs: CLASSIFY_TIMEOUT_MS });
  const parsed = extractJsonObj<{ assignments?: unknown }>(raw);
  const assignments = parsed?.assignments;
  if (!assignments || typeof assignments !== "object" || Array.isArray(assignments)) {
    throw new Error(
      `section classification via '${agent}' returned no parseable {assignments} object (got ${raw.length} chars)`,
    );
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(assignments as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}

// ── the fallback ladder rung 2: the subscription's own topic ─────────────────

/**
 * The topic of the first subscription that contributed a source for this story.
 * Null when the story only came from unmatched senders (no alias hit).
 */
export function subscriptionTopicFor(sources: StorySource[]): string | null {
  for (const src of sources) {
    const email = getEmail(src.emailId);
    if (!email?.subscriptionId) continue;
    const sub = getSubscription(email.subscriptionId);
    const topic = sub?.topic?.trim();
    if (topic) return topic;
  }
  return null;
}

// ── the build ────────────────────────────────────────────────────────────────

export interface BuildEditionResult {
  edition: EditionDoc;
  /** True when the stored document was returned untouched (idempotency guard). */
  reused: boolean;
  /**
   * How the sections were decided. `fallback` means the model call failed and
   * the topic→Everything-Else ladder ran — honest telemetry, surfaced in the UI.
   */
  classification: "reused" | "model" | "fallback" | "empty";
  classificationError?: string;
}

export async function buildEdition(
  date: string = today(),
  opts: { force?: boolean } = {},
): Promise<BuildEditionResult> {
  // 1. Idempotency guard — the stored doc wins unless forced (SPEC-F §5).
  const existing = getEdition(date);
  if (existing && !opts.force) {
    const doc = existing.content as EditionDoc | null;
    if (doc && typeof doc === "object" && Array.isArray(doc.sections) && doc.stats) {
      return { edition: doc, reused: true, classification: "reused" };
    }
    console.warn(
      `[newsletter/edition] stored edition ${date} is unreadable — rebuilding it rather than serving a broken document.`,
    );
  }

  const stories = listStoriesForDate(date);
  const sourcesByStory = new Map<string, StorySource[]>();
  for (const s of stories) sourcesByStory.set(s.id, listStorySources(s.id));

  const sections = editionSections();
  let assignment: Record<string, string> = {};
  let classification: BuildEditionResult["classification"] = "empty";
  let classificationError: string | undefined;

  if (stories.length > 0) {
    try {
      assignment = await classifySections({
        stories: stories.slice(0, MAX_CLASSIFY_STORIES).map((s) => ({
          id: s.id,
          title: s.title,
          summary: s.summary,
        })),
        sections,
      });
      classification = "model";
    } catch (err) {
      classificationError = err instanceof Error ? err.message : String(err);
      classification = "fallback";
      // LOUD (rule 11): a degraded edition must never look like a normal one.
      console.error(
        `[newsletter/edition] section classification FAILED for ${date} — falling back to ` +
          `subscription topic, then '${FALLBACK_SECTION}'. Stories are still published, but ` +
          `they are NOT model-sectioned. Reason: ${classificationError}`,
      );
    }
  }

  // 2. Resolve each story's section down the stated ladder.
  const bySection = new Map<string, Story[]>();
  for (const story of stories) {
    const sources = sourcesByStory.get(story.id) ?? [];
    const section =
      matchSection(assignment[story.id], sections) ??
      matchSection(subscriptionTopicFor(sources), sections) ??
      FALLBACK_SECTION;
    if (story.topic !== section) patchStory(story.id, { topic: section });
    const bucket = bySection.get(section);
    if (bucket) bucket.push(story);
    else bySection.set(section, [story]);
  }

  // 3. Assemble in the CONFIGURED section order; empty sections are omitted.
  const docSections: EditionDoc["sections"] = [];
  for (const topic of sections) {
    const bucket = bySection.get(topic);
    if (!bucket || bucket.length === 0) continue;
    docSections.push({
      topic,
      stories: bucket.map((story) => {
        const sources = sourcesByStory.get(story.id) ?? [];
        return {
          id: story.id,
          title: story.title,
          ...(story.canonicalUrl ? { url: story.canonicalUrl } : {}),
          summary: story.summary,
          sources: sources.map((src) => ({
            name: src.sourceName,
            ...(src.itemUrl ? { url: src.itemUrl } : {}),
          })),
        };
      }),
    });
  }

  // 4. Stats — counted, never estimated.
  const emailIds = new Set<string>();
  let duplicatesMerged = 0;
  for (const story of stories) {
    const sources = sourcesByStory.get(story.id) ?? [];
    for (const src of sources) emailIds.add(src.emailId);
    duplicatesMerged += Math.max(0, sources.length - 1);
  }

  // An empty day is still a real, storable edition (zero sections, zero
  // stories) — the reader says "no stories in this edition" rather than
  // pretending yesterday's paper is today's.
  const builtAt = now();
  const edition: EditionDoc = {
    date,
    builtAt,
    sections: docSections,
    stats: { emails: emailIds.size, stories: stories.length, duplicatesMerged },
  };

  upsertEdition(date, edition, builtAt);
  setState(STATE_LAST_EDITION, date);
  emit("newsletter.edition.built", { date, stories: edition.stats.stories }, "newsletter");

  return {
    edition,
    reused: false,
    classification,
    ...(classificationError ? { classificationError } : {}),
  };
}
