// Ported near-verbatim from REF apps/webapp/app/jobs/labels/label-assignment.logic.ts
// (buildLabelExtractionMessages + LabelExtractionSchema) — A2.7.
// Prompts are DATA (rule 17): battle-tested wording — do not "improve".

import { z } from "zod";
import type { ChatMessage } from "../types";
import { countTokens } from "../chunker";
import { LABEL_CONTEXT_MAX_TOKENS } from "../constants";

export const ExtractedLabelSchema = z.object({
  name: z.string().describe("Label name - 1-3 words, Title Case"),
  description: z
    .string()
    .describe("User-specific description of what they discuss - max 15 words"),
});

export const LabelExtractionSchema = z.object({
  labels: z
    .array(ExtractedLabelSchema)
    .describe("Extracted labels (1-3 per episode, empty if none)"),
});

export type LabelExtractionResult = z.infer<typeof LabelExtractionSchema>;

/**
 * Build messages for label extraction using HTML tags for clear section management.
 * Applies token-based truncation (LABEL_CONTEXT_MAX_TOKENS, 20k) across session
 * context + current episode (REF MAX_CONTENT_TOKENS budget kept verbatim).
 */
export function labelAssignmentPrompt(
  episodeBody: string,
  availableLabels: Array<{
    id: string;
    name: string;
    description: string | null;
  }>,
  sessionContext?: string,
): ChatMessage[] {
  // Token-aware truncation: prioritise current episode, fill remainder with session context
  const episodeTokens = countTokens(episodeBody);
  let truncatedEpisode = episodeBody;
  let truncatedContext: string | undefined;

  if (episodeTokens > LABEL_CONTEXT_MAX_TOKENS) {
    // Edge case: episode alone exceeds budget — hard-trim from the end
    const chars = Math.floor((LABEL_CONTEXT_MAX_TOKENS / episodeTokens) * episodeBody.length);
    truncatedEpisode = episodeBody.substring(0, chars) + "...[truncated]";
  }

  if (sessionContext) {
    const remaining = LABEL_CONTEXT_MAX_TOKENS - countTokens(truncatedEpisode);
    if (remaining > 200) {
      const contextTokens = countTokens(sessionContext);
      if (contextTokens <= remaining) {
        truncatedContext = sessionContext;
      } else {
        // Keep the most recent part of the session (tail), drop oldest
        const ratio = remaining / contextTokens;
        const startChar = Math.floor((1 - ratio) * sessionContext.length);
        truncatedContext =
          "...[earlier context omitted]\n" + sessionContext.substring(startChar);
      }
    }
  }

  const existingLabelsXml =
    availableLabels.length > 0
      ? `<existing_labels>
${availableLabels
  .map(
    (l) =>
      `  <label name="${l.name}"${l.description ? ` description="${l.description}"` : ""} />`,
  )
  .join("\n")}
</existing_labels>`
      : "<existing_labels />";

  const sessionContextXml = truncatedContext
    ? `<session_context>
${truncatedContext}
</session_context>`
    : "";

  const currentEpisodeXml = `<current_episode>
${truncatedEpisode}
</current_episode>`;

  return [
    {
      role: "system",
      content: `You extract LABELS from episodes for a USER'S PERSONAL KNOWLEDGE SYSTEM.

<core_principle>
Labels are HIGH-LEVEL THEMES the user is actively discussing. They help organise and retrieve episodes later.
Labels must reflect the actual topics the user speaks about — if a user is discussing Search, Authentication, Payments, etc., those deserve labels. Do NOT dismiss topics as "too generic" if the user is substantively engaging with them.
</core_principle>

<what_to_extract>
Extract labels when the episode:
1. Substantially discusses a theme (not just a passing mention)
2. Contains user-specific context about the theme
3. Represents a searchable category for future retrieval

EXTRACT labels for:
- User's projects and work (CORE, API Design, Mobile App)
- User's professional domains and features (Search, AI, Authentication, DevOps)
- User's personal interests (Fitness, Cooking, Photography)
- Recurring activities (Code Review, Team Management, Learning)

DO NOT extract labels for:
- Brief mentions with no substantive content
- Textbook/generic definitions the user is not personally engaged with
- Tools only mentioned in passing without real discussion
</what_to_extract>

<matching_rules>
1. Check existing_labels first — reuse the EXACT name if it fits
2. Create a new label only when no existing label covers the theme
3. Assign labels across all relevant dimensions (project, domain, feature, activity)
</matching_rules>

<label_naming_rules>
- 1-3 words, Title Case
- Use noun form: "Search" not "Searching", "Fitness" not "Getting Fit"
- Be specific but not verbose: "Code Review" not "Code Review Process Guidelines"

Examples:
  TOO VERBOSE           → CLEAN
  Code Review Process   → Code Review
  Database Connection   → Database Setup
  Morning Exercise      → Morning Routine
  Memory Search System  → Memory Search
</label_naming_rules>

<description_rules>
- Max 15 words
- Describe what the USER does/discusses about this topic
- User-specific, not a generic dictionary definition

Examples:
  GENERIC DEFINITION                      → USER-SPECIFIC
  "The practice of physical exercise"     → "User's fat loss goals and workout routine"
  "A software project"                    → "Personal knowledge management system user is building"
  "Database technology"                   → "Graph storage architecture for CORE project"
  "A search algorithm"                    → "Temporal and semantic search routing in CORE memory"
</description_rules>`,
    },
    {
      role: "user",
      content: `Extract labels from the content below.

${existingLabelsXml}

${sessionContextXml}

${currentEpisodeXml}`,
    },
  ];
}
