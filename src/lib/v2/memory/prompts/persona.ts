import { z } from "zod";
import type { StatementAspect } from "../types";

/**
 * A6 — persona-generation prompts, ported near-verbatim from
 * REF apps/webapp/app/jobs/spaces/aspect-persona-generation.ts (gate, section
 * map, section/chunk/merge prompts) and persona-llm-placement.ts (placement
 * rubric, few-shot bank, decision schemas, prompt builders).
 * Rule 17: prompts as DATA with schema exports. All batch-API plumbing from
 * REF is deleted — only the direct-call prompt surface is kept.
 */

// ---------------------------------------------------------------------------
// Aspect → persona-section map (REF ASPECT_SECTION_MAP, verbatim)
// ---------------------------------------------------------------------------

export interface AspectSectionInfo {
  title: string;
  description: string;
  agentQuestion: string;
  filterGuidance: string;
}

export const ASPECT_SECTION_MAP: Record<StatementAspect, AspectSectionInfo> = {
  Identity: {
    title: "IDENTITY",
    description:
      "Who they are - name, role, affiliations, contact info, location",
    agentQuestion: "Who am I talking to?",
    filterGuidance: `Rule: a fact belongs in IDENTITY if and only if an agent needs it on EVERY task to act on the user's behalf — to introduce, address, contact, or attribute correctly — regardless of what the task is about.

Apply this test:
  > "If the user just asked something completely unrelated, would I still need this fact loaded?"
  > If yes → keep. If no → drop; memory will retrieve it when the task is specifically about that thing.

Anchors:
  Keep — "primary email manoj@poozle.dev", "employer Polarize Labs LLP", "GitHub handle saimanoj"
  Drop — "31% body fat", "card ending 7108", "subscribed to Birkenstock", "owns RedPlanetHQ/sol"

When in doubt about a durable identifier (a secondary email, an affiliation, a public handle), keep it. The gate's drop rules still apply for everything else.`,
  },
  Knowledge: {
    title: "EXPERTISE",
    description: "What they know - skills, technologies, domains, tools",
    agentQuestion: "What do they know? (So I calibrate complexity)",
    filterGuidance:
      "Include: all technical skills, domain expertise, tools, platforms, frameworks they work with. Any agent might need to know their capability level.",
  },
  Belief: {
    title: "WORLDVIEW",
    description: "Core values, opinions, principles they hold",
    agentQuestion: "What do they believe? (So I align with their values)",
    filterGuidance:
      "Include: core values, strong opinions, guiding principles, philosophies. These shape how agents should frame suggestions.",
  },
  Preference: {
    title: "PREFERENCES",
    description: "How they want things done - style, format, approach, tools",
    agentQuestion: "How do they want things done?",
    filterGuidance: `Rule: a fact belongs in PREFERENCES if and only if an agent applies it on EVERY future task where the dimension is relevant — independent of which tool, feature, or project the task is about.

Apply this test:
  > "Would a future agent, working on something completely unrelated to where this preference came from, still apply it?"
  > If no → drop.

Anchors:
  Keep — "direct, founder tone in all writing", "drafts important messages for approval"
  Drop — "Linear widget shows assigned issues", "v1 ships with column-by-column filter", "Email N stops sequence"

Hard non-negotiable rules belong in DIRECTIVES, not here.`,
  },
  Habit: {
    title: "HABITS",
    description: "Regular habits, workflows, routines - work and personal",
    agentQuestion: "What do they do regularly? (So I fit into their life)",
    filterGuidance:
      "Include: recurring habits, established workflows, routines (work, health, personal). Exclude: one-time completed actions.",
  },
  Goal: {
    title: "GOALS",
    description: "What they're trying to achieve - work, health, personal",
    agentQuestion: "What are they trying to achieve? (So I align suggestions)",
    filterGuidance:
      "Include: all ongoing objectives across work, health, personal life. Exclude: completed goals, past deliverables.",
  },
  Directive: {
    title: "DIRECTIVES",
    description:
      "Standing rules and active decisions - always do X, never do Y, use Z for W",
    agentQuestion: "What rules must I follow? What's already decided?",
    filterGuidance: `Rule: a fact belongs in DIRECTIVES if and only if violating it would be a defect on ANY future task — not just on the feature, schedule, or workflow it came from.

Apply this test:
  > "If an agent on a totally unrelated task ignored this rule, would that be a bug?"
  > If yes → keep. If no → drop; that's feature config, not a persona directive.

The "always/never" wording is a trap — any feature config can be phrased as "always X" and sound directive-shaped. The test is about scope of authority, not wording.

Anchors:
  Keep — "never auto-send messages", "draft before sending anything", "read-only SQL", "use IST as default timezone"
  Drop — "Email N empty stops sequence", "Plan My Day runs at 5:15 PM IST", "modify decision-agent.ts", "schema.prisma sync in CI"

Format kept rules as actionable: "Always …", "Never …", "Use X for Y".`,
  },
  Decision: {
    title: "DECISIONS",
    description: "Choices already made - don't re-litigate these",
    agentQuestion: "What's already decided? (Don't suggest alternatives)",
    filterGuidance:
      "Include: all active decisions (technology, architecture, strategy, lifestyle). Agents should not suggest alternatives to decided matters.",
  },
  Event: {
    title: "TIMELINE",
    description: "Key events and milestones",
    agentQuestion: "What happened when?",
    filterGuidance:
      "SKIP - Transient data. Agents should query the graph directly for date-specific information.",
  },
  Problem: {
    title: "CHALLENGES",
    description: "Current blockers, struggles, areas needing attention",
    agentQuestion: "What's blocking them? (Where can I help?)",
    filterGuidance:
      "Include: all ongoing challenges, pain points, blockers. Exclude: resolved issues.",
  },
  Relationship: {
    title: "RELATIONSHIPS",
    description:
      "Key people - names, roles, contact info, how to work with them",
    agentQuestion: "Who matters to them? (Context for names mentioned)",
    filterGuidance:
      "Include: names, roles, relationships, contact info (email, phone), collaboration notes. Any agent might need to reference or contact these people.",
  },
  Task: {
    title: "TASKS",
    description: "One-time commitments, follow-ups, promises, action items",
    agentQuestion: "What do they need to do?",
    filterGuidance:
      "SKIP - Transient data. Agents should query the graph directly for tasks and action items.",
  },
};

// ---------------------------------------------------------------------------
// Shared persona-worthiness gate (REF PERSONA_WORTHINESS_GATE, verbatim).
// Repeated in EVERY full-mode prompt so chunk summaries, merge, and
// single-section calls all apply the same filter.
// ---------------------------------------------------------------------------

export const PERSONA_WORTHINESS_GATE = `
=========================================================
PERSONA-WORTHINESS GATE — apply BEFORE writing anything
=========================================================

The persona is a small, durable operating manual for OTHER AGENTS —
agents that have no knowledge of the conversation that produced these
facts, working on UNRELATED future tasks. The label upstream is
NECESSARY but NOT SUFFICIENT — most labelled facts will still fail
this gate. Default is drop.

----------- THE UNIFIED RULE -----------

A fact is persona-worthy if and only if an agent would apply it on
EVERY future task where its dimension is relevant — independent of the
specific tool, feature, project, schedule, or episode the fact came
from.

Apply this single test to every fact:

  > "Would a fresh agent, working on something completely unrelated
  > to where this fact came from, still need this fact to act
  > correctly?"
  > If no → drop.

Aspect-specific reading of the rule:
  - IDENTITY  → keep if an agent needs it on every task to act on the
                user's behalf (introduce, address, contact, attribute).
                Drop possessions, biometrics, account/policy numbers,
                workload counts — those are about the user but only
                relevant when the task is specifically about that
                thing; memory will retrieve them when needed.
  - PREFERENCE → keep if it shapes agent behaviour across many tools,
                features, and tasks. Drop preferences scoped to one
                tool/feature/episode.
  - DIRECTIVE → keep if its violation would be a defect on ANY future
                task. Drop rules whose authority is scoped to one
                feature/file/job — that's feature config, not persona.

Anchors (apply to all aspects):
  Keep — "primary email manoj@poozle.dev", "founder tone in writing",
         "never auto-send messages", "use IST as default timezone"
  Drop — "31% body fat", "Linear widget shows assigned issues",
         "Email N column stops sequence", "Plan My Day at 5:15 PM IST",
         "modify decision-agent.ts", "subscribed to Birkenstock"

----------- WORKING HEURISTIC -----------

If a fact mentions a NAMED artifact — a specific tool, widget, file,
function, repo, ticket, column, schedule, job, workflow, gateway,
pipeline stage — that's a strong signal it's feature config, not
persona. Drop unless the rule it expresses clearly applies far beyond
that one artifact.

If you'd name a subsection after a feature, workflow, or schedule
("Email sequence", "Linear widget", "Gmail monitor", "Plan mode",
"Recurring runs", "Sheet status", etc.), the cluster itself is
feature config. Drop every fact in it.

When in doubt, drop. The persona stays useful by staying small.
`.trim();

// ---------------------------------------------------------------------------
// Full-mode prompt inputs
// ---------------------------------------------------------------------------

/** Single-user install: the only user-context field we carry (REF getUserContext
 *  pulled name/email/role from the User table; SPEC A6.1: "user identity
 *  synthetics from config userName"). */
export interface PersonaUserContext {
  name?: string;
  role?: string;
  goal?: string;
}

export interface PersonaFactInput {
  fact: string;
  createdAt: string; // UTC ISO
}

export interface PersonaEpisodeInput {
  content: string;
  createdAt: string; // UTC ISO
}

function factsList(statements: PersonaFactInput[]): string {
  return statements.map((s, i) => `${i + 1}. ${s.fact}`).join("\n");
}

function episodesList(episodes: PersonaEpisodeInput[], max?: number): string {
  const slice = max !== undefined ? episodes.slice(0, max) : episodes;
  return slice
    .map((e) => {
      const date = e.createdAt.split("T")[0];
      return `[${date}] ${e.content}`;
    })
    .join("\n\n---\n\n");
}

/** REF buildAspectSectionPrompt — one small section, direct generation. */
export function buildAspectSectionPrompt(args: {
  aspect: StatementAspect;
  statements: PersonaFactInput[];
  episodes: PersonaEpisodeInput[];
  userContext: PersonaUserContext;
}): string {
  const sectionInfo = ASPECT_SECTION_MAP[args.aspect];
  const factsText = factsList(args.statements);
  const episodesText = episodesList(args.episodes, 10);
  const { userContext } = args;

  return `
You are generating the **${sectionInfo.title}** section of a persona document.

${PERSONA_WORTHINESS_GATE}

## What is a Persona Document?

A persona is NOT a summary of everything known about a person. It is an **operating manual** for AI agents to interact with this person effectively.

**Core principle:** Every line must change how an agent behaves across many UNRELATED future interactions. If removing a line wouldn't change agent behaviour in some other, unrelated future task, drop the line.

Think of it as a quick reference card, not a biography or database dump.

## Why This Section Exists

The **${sectionInfo.title}** section answers: "${sectionInfo.agentQuestion}"

${sectionInfo.description}

## User Context
${userContext.name ? `- Name: ${userContext.name}` : ""}
${userContext.role ? `- Role: ${userContext.role}` : ""}
${userContext.goal ? `- Goal: ${userContext.goal}` : ""}

## Raw Facts (${args.statements.length} statements)

You will see the raw facts below. APPLY THE GATE TO EACH FACT. Most labelled facts will fail the gate. The output should reflect that — sections that look thin are FINE, sections that look complete-but-noisy are NOT fine.

${factsText}

## Source Episodes (for context)
${episodesText}

## Aspect-specific filter

${sectionInfo.filterGuidance}

## Output Requirements

The output is a structured section body with these elements (in order):

1. (Optional) Loose-fact bullets at the very top — facts that don't cluster
   into a clear topic with at least one sibling. Format: \`- \${sentence}\`.

2. (Required, when there are clusterable topics) Zero or more \`### Subsection\` blocks. Each subsection is a
   topic cluster — group facts that share a coherent theme (e.g. "Email
   writing", "Code style"). Each subsection has:
   - A 1-3 sentence prose paragraph capturing contextual nuance, conditional
     behaviour, and relationships between the clustered facts.
   - A blank line.
   - One bullet per fact, format \`- \${sentence}\`.
   - One blank line between bullets and the next subsection.

3. The line \`[Confidence: HIGH|MEDIUM|LOW]\` at the very end of the section.

## Subsection naming

- 1-3 words, topic-shaped (e.g., "Email writing", "Code style", "Onboarding")
- No special characters except "-" or "/"
- Avoid duplicating subsection names within a section

## When to cluster

A topic with only ONE fact stays as a loose bullet at the top — do not create
a subsection for a single-fact topic. A cluster needs ≥ 2 related facts that
ALL pass the gate.

NEVER create a subsection whose name is the name of a feature, integration,
workflow, or job. If the only way to name the cluster is by feature ("Linear
widgets", "Email sequence", "Skill pipeline", "Gmail monitor", "Recurring
runs", "Sheet status", "Plan mode", "Outbound email"), the cluster itself
is feature config — DROP every fact in it.

Saturation: if you find yourself with ≥ 8 subsections in this section, stop
adding new ones. Drop further facts that don't unambiguously belong to one
of the existing subsections.

## What to Include vs Exclude

✅ INCLUDE only if all of these are true:
- Applies across MANY future, unrelated interactions
- No named feature/widget/file/repo/issue/schedule
- Describes BEHAVIOUR an agent should follow, not an OBSERVATION about the user
- Not already covered by another fact in the section

❌ EXCLUDE — drop without exception:
- Body composition, biometrics, physical stats
- Possessions, hardware, subscriptions, account/policy/order/card numbers
- Project work, repo/issue/PR/ticket mentions, file or function references
- Per-job schedules and cron times (e.g. "runs at 5:30 PM IST")
- Per-feature setup ("widget shows X", "column N triggers Y", "step Z")
- Implementation guidance for one specific kind of task
- Anything an agent can get from memory search at runtime

## Identity-specific guidance

For Identity specifically: if no clear sub-topics exist, emit a single
unnamed prose paragraph (1-3 sentences, biographical) at the top of the
section, above all bullets and any \`### subsection\` blocks. Then end with
\`[Confidence: …]\`.

## Bullet length

- Bullets are single sentences, ≤ 20 words for Preferences, ≤ 10 words for other aspects
- Active voice, no leading dash in your output (the dash is added by the format)
- No "I prefer" / "User does" prefixes — just the rule or fact

Even if there is only 1 fact, generate the section — do NOT return "INSUFFICIENT_DATA".

Generate ONLY the section content, no title header.
  `.trim();
}

/** REF buildChunkSummaryPrompt — one chunk of a large section. */
export function buildChunkSummaryPrompt(args: {
  aspect: StatementAspect;
  statements: PersonaFactInput[];
  episodes: PersonaEpisodeInput[];
  chunkIndex: number;
  totalChunks: number;
  isLatest: boolean;
}): string {
  const sectionInfo = ASPECT_SECTION_MAP[args.aspect];
  const factsText = factsList(args.statements);
  const episodesText = episodesList(args.episodes);
  const recencyNote = args.isLatest
    ? "**This is the MOST RECENT chunk** - this information is the most current and should be weighted heavily."
    : `This is chunk ${args.chunkIndex + 1} of ${args.totalChunks} (older data).`;

  return `
You are summarizing a chunk of data for the **${sectionInfo.title}** section of a persona document.

${recencyNote}

${PERSONA_WORTHINESS_GATE}

## Section Purpose
${sectionInfo.agentQuestion}

## Aspect-specific filter
${sectionInfo.filterGuidance}

## Facts in this chunk (${args.statements.length} statements)

APPLY THE GATE TO EACH FACT. Most facts here will fail the gate — that is
correct. Drop them silently; do NOT carry them through.

${factsText}

## Source Episodes (for context)
${episodesText}

## Instructions

After applying the gate, cluster the SURVIVING facts by topic (1-3 word
topic names). For each cluster of ≥ 2 SURVIVING facts that share a STANDING
topic (not a feature/widget/workflow), output a small block:

  TOPIC: <name>
  PROSE: <1-3 sentences capturing contextual nuance>
  BULLETS:
  - fact one
  - fact two

NEVER name a TOPIC after a feature, integration, workflow, schedule, file,
or repo. If the natural cluster name is feature-shaped, the cluster is
feature config — drop it entirely.

For solo SURVIVING facts that don't cluster, emit:

  LOOSE: <fact>

Return one such block per topic cluster or solo fact. The merge step will
combine these into the final structured section. If after applying the gate
NO facts survive, return "NO_PATTERNS".
  `.trim();
}

/** REF buildMergePrompt — merge chunk summaries into a final section body. */
export function buildMergePrompt(args: {
  aspect: StatementAspect;
  chunkSummaries: string[];
}): string {
  const sectionInfo = ASPECT_SECTION_MAP[args.aspect];
  const summariesText = args.chunkSummaries
    .map((summary, i) => {
      const recencyLabel =
        i === 0 ? "MOST RECENT (highest priority)" : `Older chunk ${i + 1}`;
      return `### ${recencyLabel}\n${summary}`;
    })
    .join("\n\n");

  return `
You are merging chunk summaries into the final **${sectionInfo.title}** section of a persona document.

${PERSONA_WORTHINESS_GATE}

## What is a Persona Document?

A persona is an **operating manual** for AI agents. Every line must change how an agent behaves across many UNRELATED future tasks.

## Section Purpose
The **${sectionInfo.title}** section answers: "${sectionInfo.agentQuestion}"

## Aspect-specific filter
${sectionInfo.filterGuidance}

## Chunk Summaries (ordered by recency)

The chunks below have already been filtered, but the filter may have let
some feature-config / observation facts through. Apply the gate AGAIN as
you merge — drop any TOPIC whose name is feature/widget/workflow shaped,
drop any LOOSE entry that fails the gate. Do NOT promote feature-shaped
TOPICs into ### subsections.

${summariesText}

## Output Format

The merged output uses the same structured format as a fresh section body:

1. (Optional) Loose-fact bullets at the very top — combine all LOOSE entries
   from chunks. Format: \`- \${sentence}\`.

2. Zero or more \`### Subsection\` blocks built by combining matching TOPICs
   across chunks:
   - If the same topic appears in multiple chunks, merge their BULLETS lists
     (deduplicating identical or near-identical facts, recent chunk wins).
   - For PROSE: prefer the most recent chunk's prose when available; otherwise
     synthesise a 1-3 sentence summary covering all the merged facts.
   - Each subsection is: \`### Topic Name\`, blank line, prose paragraph,
     blank line, one bullet per fact (format \`- \${sentence}\`), blank line.

3. End with \`[Confidence: HIGH|MEDIUM|LOW]\`.

## Bullet length

- Bullets are single sentences, ≤ 20 words for Preferences, ≤ 10 words for other aspects
- Active voice, no "I prefer" / "User does" prefixes
- Subsection names: 1-3 words, topic-shaped, no duplicates

## Merge rules

1. Recent info takes precedence — if there's a conflict, the most recent chunk wins.
2. Deduplicate identical bullets across chunks.
3. Preserve important older info — older facts stay unless contradicted.
4. The final output should be shorter than the sum of chunks.

Generate ONLY the section content, no title header.
  `.trim();
}

// ---------------------------------------------------------------------------
// Incremental placement — schemas (REF persona-llm-placement.ts, verbatim)
// ---------------------------------------------------------------------------

const SubsectionNameSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[\w][\w \-/&]+$/, "subsection name must be 1-3 short words");

const BulletStringSchema = z.string().min(1).max(300);

const SkipSchema = z.object({
  decision: z.literal("skip"),
  reason: z.string(),
});

const AppendToSubsectionSchema = z.object({
  decision: z.literal("append_to_subsection"),
  subsection: SubsectionNameSchema,
  bullet: BulletStringSchema,
});

const PromoteToNewSubsectionSchema = z.object({
  decision: z.literal("promote_to_new_subsection"),
  subsection: SubsectionNameSchema,
  prose: z.string().min(1).max(600),
  bullets: z.array(BulletStringSchema).min(1),
  promoted_loose_ids: z.array(z.string().regex(/^L\d+$/)).min(1),
});

const AddToLooseFactsSchema = z.object({
  decision: z.literal("add_to_loose_facts"),
  bullet: BulletStringSchema,
});

export const PlacementDecisionSchema = z.discriminatedUnion("decision", [
  SkipSchema,
  AppendToSubsectionSchema,
  PromoteToNewSubsectionSchema,
  AddToLooseFactsSchema,
]);

export type PlacementDecision = z.infer<typeof PlacementDecisionSchema>;

// Batched form: same variants, but `promoted_loose_ids` may be empty because
// a cluster can be formed entirely from new facts of one episode.
const BatchPromoteSchema = PromoteToNewSubsectionSchema.extend({
  promoted_loose_ids: z.array(z.string().regex(/^L\d+$/)).default([]),
});

export const BatchDecisionSchema = z.discriminatedUnion("decision", [
  SkipSchema,
  AppendToSubsectionSchema,
  BatchPromoteSchema,
  AddToLooseFactsSchema,
]);

// ---------------------------------------------------------------------------
// Incremental placement — prompt data (REF RUBRIC + FEW_SHOT, verbatim)
// ---------------------------------------------------------------------------

export const PLACEMENT_RUBRIC = `
============================================================
STEP 0 — PERSONA-WORTHINESS GATE (apply BEFORE anything else)
============================================================

The fact has already been labelled by an upstream classifier — that
label is NECESSARY but NOT SUFFICIENT. Most labelled facts will still
fail this gate. Default is skip.

----------- THE UNIFIED RULE -----------

A fact is persona-worthy if and only if an agent would apply it on
EVERY future task where its dimension is relevant — independent of
the specific tool, feature, project, schedule, or episode the fact
came from.

Apply this single test:

  > "Would a fresh agent, working on something completely unrelated
  > to where this fact came from, still need this fact to act
  > correctly?"
  > If no → skip.

Aspect-specific reading of the rule:
  - IDENTITY  → keep if an agent needs it on every task to act on the
                user's behalf (introduce, address, contact, attribute).
                Drop possessions, biometrics, account numbers,
                workload counts — those are about the user but only
                relevant when the task is about that thing; memory
                will retrieve them when needed.
  - PREFERENCE → keep if it shapes agent behaviour across many tools,
                features, and tasks. Skip preferences scoped to one
                tool/feature/episode.
  - DIRECTIVE → keep if its violation would be a defect on ANY future
                task. Skip rules whose authority is scoped to one
                feature/file/job — that's feature config.

Anchors (apply to all aspects):
  Keep — "primary email manoj@poozle.dev", "founder tone in writing",
         "never auto-send messages", "use IST as default timezone"
  Skip — "31% body fat", "Linear widget shows assigned issues",
         "Email N column stops sequence", "Plan My Day at 5:15 PM IST",
         "modify decision-agent.ts", "subscribed to Birkenstock"

----------- WORKING HEURISTIC -----------

If a fact mentions a NAMED artifact — a specific tool, widget, file,
function, repo, ticket, column, schedule, job, workflow, gateway,
pipeline stage — that's a strong signal it's feature config, not
persona. Skip unless the rule it expresses clearly applies far
beyond that one artifact.

If you'd name a subsection after a feature, workflow, or schedule,
the cluster itself is feature config. Skip every fact in it.

SATURATION: if the section already has ≥ 8 subsections, prefer "skip"
over a 9th unless the fact unambiguously belongs to an existing one.

When in doubt, skip. The persona stays useful by staying small.

If the gate passes, decide which of the four placement variants applies:

1. "skip" — the fact failed the gate, or is a one-off / noise /
   project-specific. Set { decision: "skip", reason: "<short>" }.

2. "append_to_subsection" — the fact's topic is already represented by an
   existing ### subsection. Set { decision, subsection: "<EXACT existing name>",
   bullet: "<polished sentence, no leading dash>" }.

3. "promote_to_new_subsection" — the new fact + ≥ 1 existing loose facts share
   a clear topic AND that topic is a STANDING pattern (not a one-feature
   setup). Choose ≥ 1 loose-fact IDs to promote (the new fact is implicit —
   never list it among promoted IDs). Generate a short prose paragraph
   (1-3 sentences) capturing the topic's contextual frame, plus the initial
   bullets (the new fact's bullet first, then promoted facts). Subsection
   name is 1-3 words, topic-shaped, MUST NOT duplicate an existing name
   (case-insensitive). Do NOT promote if the topic only describes one
   feature/task/workflow you built once.

4. "add_to_loose_facts" — passes the gate but is too isolated to cluster.
   Set { decision, bullet: "<polished sentence>" }.

CONSTRAINTS:
- Output strictly a single JSON object matching one of the variants. No prose,
  no markdown fences, no commentary.
- Bullets are single sentences, ≤ 20 words, active voice, no leading "- ".
- Subsection names: 1-3 words, no special characters except "-" or "/".
- Never propose any operation that modifies existing prose, renames headings,
  or deletes any bullet other than via the \`promoted_loose_ids\` list.
`;

export const PLACEMENT_FEW_SHOT = `
EXAMPLE G1 (skip — feature-config detector, named artifact):
  aspect: Directive
  fact: "Order summary widget shows the last three deliveries with status badges"
  → { "decision": "skip", "reason": "names a specific widget — feature config, not persona" }

EXAMPLE G2 (skip — implementation guidance, named function/file):
  aspect: Directive
  fact: "Build the inventory cache in inventoryStore.refresh() before serving the dashboard"
  → { "decision": "skip", "reason": "names a specific function — implementation detail, not persona" }

EXAMPLE G3 (skip — schedule/cadence, named job):
  aspect: Directive
  fact: "Garden Care reminder runs daily at 7:00 AM IST"
  → { "decision": "skip", "reason": "specific job schedule lives on the reminder, not the persona" }

EXAMPLE G4 (skip — observation, body composition):
  aspect: Identity
  fact: "Resting heart rate is 58 bpm with VO2 max around 42"
  → { "decision": "skip", "reason": "biometric observation, not behaviour an agent should follow" }

EXAMPLE G5 (skip — observation, possession/account):
  aspect: Identity
  fact: "Holds a savings account at SBI ending in 4421"
  → { "decision": "skip", "reason": "account number / vendor relationship; not persona-worthy" }

EXAMPLE G6 (skip — one-feature artifact):
  aspect: Directive
  fact: "Mark Step 2 as Skipped if the upstream Step 1 row has 'pending'"
  → { "decision": "skip", "reason": "describes one workflow's status semantics — feature config, not standing rule" }

EXAMPLE G7 (skip — already implied):
  aspect: Preference
  fact: "Wants conversational tone in customer replies"
  existing subsection: "Voice" with bullet "Direct and conversational, no corporate filler"
  → { "decision": "skip", "reason": "already implied by existing voice rule" }

EXAMPLE G8 (skip — one-off):
  aspect: Preference
  fact: "Wanted bold headers in last week's report"
  → { "decision": "skip", "reason": "one-off styling request, not a standing preference" }

EXAMPLE P1 (append_to_subsection — passes gate):
  aspect: Preference
  fact: "Avoids hedging language like 'might' or 'maybe' in summaries"
  existing subsection: "Voice" (4 bullets)
  → { "decision": "append_to_subsection", "subsection": "Voice",
      "bullet": "Avoids hedging language like 'might' or 'maybe' in summaries" }
  why kept: applies to every summary the agent writes, no artifact named, durable voice rule.

EXAMPLE P2 (promote_to_new_subsection — passes gate):
  aspect: Directive
  fact: "Confirm before placing any order over ₹5000"
  loose facts: L1 "Never auto-confirm purchases", L2 "Surface total cost before checkout"
  → { "decision": "promote_to_new_subsection",
      "subsection": "Spend gates",
      "prose": "Treat any spend as approval-gated — surface costs first and never auto-confirm.",
      "bullets": ["Confirm before placing any order over ₹5000", "Never auto-confirm purchases", "Surface total cost before checkout"],
      "promoted_loose_ids": ["L1", "L2"] }
  why kept: standing safety pattern across all paid flows; not tied to one feature.

EXAMPLE P3 (add_to_loose_facts — passes gate, isolated):
  aspect: Directive
  fact: "Never read SMS OTPs out loud"
  no related subsections, no related loose facts
  → { "decision": "add_to_loose_facts", "bullet": "Never read SMS OTPs out loud" }
  why kept: hard standing rule across many flows, no feature named.
`;

// ---------------------------------------------------------------------------
// Incremental placement — prompt builders (REF buildPlacementPrompt /
// buildBatchPlacementPrompt). SectionStructure lives in persona.ts (pure
// parser); the prompt only needs its summarized rendering.
// ---------------------------------------------------------------------------

export interface StructureSummaryInput {
  subsections: { name: string; proseFirstSentence: string; bulletCount: number }[];
  looseFacts: { id: string; text: string }[];
}

export function summariseStructure(structure: StructureSummaryInput): string {
  const subs = structure.subsections.length
    ? structure.subsections
        .map(
          (s) =>
            `  - "${s.name}" (${s.bulletCount} bullets) — first: ${JSON.stringify(s.proseFirstSentence)}`,
        )
        .join("\n")
    : "  (none)";
  const loose = structure.looseFacts.length
    ? structure.looseFacts.map((l) => `  ${l.id}: ${l.text}`).join("\n")
    : "  (none)";
  return `Existing subsections:\n${subs}\n\nExisting loose facts (refer to by id):\n${loose}`;
}

export function buildPlacementPrompt(input: {
  aspect: StatementAspect;
  fact: string;
  structure: StructureSummaryInput;
  filterGuidance: string;
}): string {
  return `You are placing a NEW persona fact into an existing persona document section.

Aspect: ${input.aspect}
Filter guidance for this aspect:
${input.filterGuidance}

NEW FACT:
${input.fact}

${summariseStructure(input.structure)}

${PLACEMENT_RUBRIC}

${PLACEMENT_FEW_SHOT}

Now produce the JSON object for the NEW FACT above. Output JSON only.`;
}

function truncateForPrompt(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\n... [truncated]";
}

export function buildBatchPlacementPrompt(input: {
  aspect: StatementAspect;
  facts: string[];
  structure: StructureSummaryInput;
  filterGuidance: string;
  episodeContent?: string;
}): string {
  const factList = input.facts.map((f, i) => `  ${i + 1}. ${f}`).join("\n");

  const episodeBlock = input.episodeContent
    ? `\n\nSOURCE EPISODE (for context — do NOT copy verbatim):\n"""\n${truncateForPrompt(input.episodeContent, 3000)}\n"""\n`
    : "";

  return `You are placing MULTIPLE NEW persona facts (from a single source episode) into an existing persona document section. First apply the persona-worthiness gate to EACH fact independently — many will be "skip". Then, among the facts that pass, cluster facts that share a STANDING topic.

Aspect: ${input.aspect}
Filter guidance for this aspect:
${input.filterGuidance}

NEW FACTS (from one episode):
${factList}
${episodeBlock}
${summariseStructure(input.structure)}

${PLACEMENT_RUBRIC}

OUTPUT FORMAT FOR BATCH:
- Return a JSON ARRAY of decision objects, in the order you want them applied.
- Each item is one of the four variants above.
- Multiple new facts that share a topic SHOULD be combined into a single
  "promote_to_new_subsection" decision (use \`bullets\` to list all the
  related new-fact bullets, plus any related loose facts via
  \`promoted_loose_ids\`).
- A later decision may "append_to_subsection" using a subsection name that
  was just created by an earlier "promote_to_new_subsection" in the same
  array.
- Do NOT emit duplicate "promote_to_new_subsection" entries with the same
  subsection name. Do NOT propose subsection names that already exist
  (case-insensitive) unless using "append_to_subsection".
- Output strictly a single JSON array. No prose, no markdown fences.

${PLACEMENT_FEW_SHOT}

EXAMPLE (batch with mixed skip + keep — gate applied per fact):
  aspect: Directive
  facts (from one episode about building a "Daily Brief" feature):
    1. "Daily Brief widget runs at 8:00 AM IST every weekday"
    2. "Confirm before sending anything to external recipients"
    3. "Brief job stops if Slack channel ID is missing"
    4. "Never include sensitive financial figures in shared summaries"
  loose facts: (none)
  → [
      { "decision": "skip", "reason": "names a specific widget and schedule — feature config" },
      { "decision": "add_to_loose_facts", "bullet": "Confirm before sending anything to external recipients" },
      { "decision": "skip", "reason": "names a specific job and config field — feature config" },
      { "decision": "add_to_loose_facts", "bullet": "Never include sensitive financial figures in shared summaries" }
    ]
  why: facts 1 and 3 mention named artifacts (widget, schedule, job, config field) — feature config, skip. Facts 2 and 4 are durable rules that apply to many unrelated future tasks — keep.

Now produce the JSON array for the NEW FACTS above. Output JSON only.`;
}
