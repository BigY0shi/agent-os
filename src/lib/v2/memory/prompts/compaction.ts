import { z } from "zod";
import type { ChatMessage } from "../types";

/**
 * A5 — session-compaction prompt, ported near-verbatim from
 * REF apps/webapp/app/jobs/session/session-compaction.logic.ts
 * (createCompactionSystemPrompt / createCompactionUserPrompt /
 * CompactionResultSchema / parseCompactionResponse).
 * Rule 17: prompts are DATA — plain strings + a schema export, injected into
 * whichever provider settings.memory selects.
 */

// Zod schema for the compaction result (REF CompactionResultSchema). The LLM
// call itself is unstructured text (<output>-tag contract below); the schema
// documents/validates the parsed shape.
export const CompactionResultSchema = z.object({
  summary: z.string().describe("Consolidated narrative of the entire session"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Confidence score of the compaction quality"),
});

export type CompactionResult = z.infer<typeof CompactionResultSchema>;

/** REF createCompactionSystemPrompt() — verbatim. */
export const COMPACTION_SYSTEM_PROMPT = `A good butler keeps a lasting record of what was discussed, decided, and needs follow-up. You are compressing a conversation into that record. This compact:
1. **REPLACES** all original episodes - agents will ONLY see this summary, never the original conversations
2. Is viewable by the user as a document in their knowledge base

## STRUCTURE

**Single topic session:**
\`\`\`
**Context**: [What this was about - the situation, goal, or problem]
**Details**: [The substance - what was discussed, discovered, decided, done]
**Next**: [Open items, follow-ups - only if any exist]
\`\`\`

**Multi-topic session:**
\`\`\`
## [Topic 1 name]
**Context**: ...
**Details**: ...

## [Topic 2 name]
**Context**: ...
**Details**: ...

## Next
[Combined open items across all topics - only if any exist]
\`\`\`

## PRINCIPLES

- **Preserve everything important**: Agents only see this, not the original. Don't lose context.
- **Capture decision status**: Distinguish between what was decided/confirmed vs suggested/proposed. Use phrases like "User decided...", "Suggested...", "User confirmed...", "Recommended but not yet decided..."
- **Deduplicate**: If the same thing is discussed multiple times, consolidate into one mention with the final/correct state
- **Technical precision**: Keep exact values, code changes, file paths, error messages, specific numbers
- **Entity preservation**: Keep all names, projects, tools, files, URLs, dates exactly as mentioned
- **Proportional length**: Simple sessions = brief. Complex sessions = detailed.
- **No hallucination**: Only include what was actually discussed. Never invent facts, tasks, or conclusions.
- **Next section rules**: Only include items the user explicitly agreed to do or left open. Suggestions the user didn't respond to should stay in Details as "Suggested X (no response)", not in Next.

## EXAMPLES

**Simple session:**
<output>
**Context**: Scheduling team sync meeting
**Details**: User requested a team sync. Created calendar invite for **Team Sync**, Jan 25 2:00-2:30 PM. Attendees: john@company.com, sarah@company.com. User confirmed agenda: Q1 planning review.
</output>

**Health session:**
<output>
## Morning Headaches
**Context**: User reported recurring headaches for 2 weeks, throbbing pain behind eyes at 6-7am
**Details**: Possible causes discussed: screen time before bed, caffeine after 2pm, dehydration. Suggested tracking sleep and water intake - user agreed to try.

## Sleep Issues
**Context**: User mentioned taking 1+ hour to fall asleep, waking at 3am
**Details**: Current habits: phone until midnight, coffee at 4pm. Recommended: no screens after 10pm, caffeine cutoff at 2pm, 10-min meditation before bed. User will try the screen cutoff first.

## Next
- User to track sleep and headaches for 1 week
- Suggested magnesium 300mg before bed (user undecided)
</output>

**Technical debugging session:**
<output>
## Neo4j Datetime Filtering Fix
**Context**: Temporal queries returning 0 episodes despite data existing
**Details**: Investigated and found root cause: type mismatch - \`datetime($startTime)\` compared against ISO strings stored in \`e.createdAt\`. User confirmed the fix: compare strings directly using \`s.validAt >= $startTime\`, \`s.validAt <= $endTime\`, \`s.invalidAt > $now\` with \`new Date().toISOString()\`. Kept APOC \`datetime()\` for Event \`event_date\` (stored correctly). Fix implemented.

## Temporal Reranking
**Context**: Pure temporal queries like "get last 1 week episodes" losing all results after reranking
**Details**: Found reranker scored against meta-intent string which matched nothing, dropping results below 0.1 threshold. Proposed fix: skip reranking when \`Aspects: []\` and sort by recency instead. Queries with aspects like \`[Event, Relationship]\` still use reranker. User approved. Implemented with heuristic: \`hasTopic = entityHints.length > 0 || selectedLabels.length > 0\`.

## Next
- V1 fallback drops temporal constraints in \`memory.ts:167\` (not yet addressed)
- Add aspect filtering to \`handleEntityLookup\` (planned)
</output>

## OUTPUT FORMAT

Wrap in <output></output> tags. Markdown inside.

<output>
[Structured compact - detailed enough that an agent reading ONLY this has full context]
</output>`;

/** Minimal episode shape the user prompt renders (REF EpisodicNode subset). */
export interface CompactionEpisodeInput {
  validAt: string; // UTC ISO
  source: string;
  originalContent: string;
}

/** REF createCompactionUserPrompt() — verbatim structure. */
export function compactionUserPrompt(
  episodes: CompactionEpisodeInput[],
  existingSummary: string | null,
): string {
  let prompt = "";

  if (existingSummary) {
    prompt += `## EXISTING SUMMARY (from previous compaction)\n\n${existingSummary}\n\n`;
    prompt += `## NEW EPISODES (to merge into existing summary)\n\n`;
  } else {
    prompt += `## SESSION EPISODES (to compact)\n\n`;
  }

  episodes.forEach((episode, index) => {
    prompt += `### Episode ${index + 1} (${episode.validAt})\n`;
    prompt += `Source: ${episode.source}\n`;
    prompt += `Content:\n${episode.originalContent}\n\n`;
  });

  if (existingSummary) {
    prompt += `\n## INSTRUCTIONS\n\n`;
    prompt += `Merge the new episodes into the existing summary. Update facts, add new information, and maintain narrative coherence. Ensure the consolidated summary reflects the complete session including both old and new content.\n`;
  } else {
    prompt += `\n## INSTRUCTIONS\n\n`;
    prompt += `Create a compact summary of this entire session. Consolidate all information into a coherent narrative with deduplicated key facts.\n`;
  }

  return prompt;
}

/** Full message list for the compaction call. */
export function compactionMessages(
  episodes: CompactionEpisodeInput[],
  existingSummary: string | null,
): ChatMessage[] {
  return [
    { role: "system", content: COMPACTION_SYSTEM_PROMPT },
    { role: "user", content: compactionUserPrompt(episodes, existingSummary) },
  ];
}

/**
 * REF parseCompactionResponse() — <output>-tag extraction with raw-response
 * fallback (some local/self-hosted models won't follow the tag format).
 * PURE — exercised offline by smoke-compaction.mjs.
 */
export function parseCompactionResponse(response: string): CompactionResult {
  const outputMatch = response.match(/<output>([\s\S]*?)<\/output>/);
  const summaryText = outputMatch ? outputMatch[1].trim() : response.trim();
  if (!summaryText) {
    throw new Error(
      `empty compaction response (raw tail: …${response.slice(-200)})`,
    );
  }
  // Confidence defaults to 1.0 — REF stopped scoring.
  return { summary: summaryText, confidence: 1.0 };
}
