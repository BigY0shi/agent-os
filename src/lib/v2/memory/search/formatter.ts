import { countTokens } from "../chunker";
import { TOKEN_BUDGET_DEFAULT } from "../constants";
import type { RecallResult } from "../types";

/**
 * A4.4 — markdown formatter for recall results. Port of REF
 * apps/webapp/app/services/search-v2/formatter.ts formatRecallAsMarkdown —
 * section order, headings, and the 📦 (session compact) / 📄 (document)
 * markers kept verbatim, including the Invalidated Facts section (fed by
 * graph.getEpisodesInvalidFacts through the handlers) and the token-budget
 * truncation warning. Dates arrive as ISO strings (house rule) and render
 * through toLocaleDateString/toLocaleString exactly as upstream.
 *
 * The structured output path needs no formatter — RecallResult (types.ts) is
 * already the client-safe ISO-string shape (REF's formatForV1Compatibility
 * existed only to map Dates; searchV2 returns the RecallResult directly).
 */

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Format recall result as markdown for LLM consumption
 * (matches the v1 format with entity support added — REF verbatim).
 */
export function formatRecallAsMarkdown(
  result: RecallResult,
  tokenBudget: number = TOKEN_BUDGET_DEFAULT,
): string {
  const sections: string[] = [];

  // Facets section (for temporal_facets queries)
  if (result.facets) {
    const { facets } = result;
    const startDate = fmtDate(facets.dateRange.startTime);
    const endDate = facets.dateRange.endTime ? fmtDate(facets.dateRange.endTime) : "now";
    sections.push(`## Memory Overview (${startDate} – ${endDate})\n`);

    if (facets.topics && facets.topics.length > 0) {
      sections.push("### Topics");
      facets.topics.forEach((t) => {
        sections.push(
          `- **${t.labelName}** (${t.episodeCount} episode${t.episodeCount !== 1 ? "s" : ""})`,
        );
      });
      sections.push("");
    }

    if (facets.entities && facets.entities.length > 0) {
      sections.push("### People & Entities");
      facets.entities.forEach((e) => {
        sections.push(
          `- **${e.entityName}** (${e.mentionCount} mention${e.mentionCount !== 1 ? "s" : ""})`,
        );
      });
      sections.push("");
    }

    if (facets.aspects && facets.aspects.length > 0) {
      sections.push("### By Aspect");
      facets.aspects.forEach((a) => {
        sections.push(
          `\n**${a.aspect}** (${a.statementCount} statement${a.statementCount !== 1 ? "s" : ""})`,
        );
        a.statements.forEach((s) => {
          sections.push(
            `- ${s.fact} _(${fmtDate(s.validAt)})_ \`ep:${s.episodeUuid.slice(0, 8)}\``,
          );
        });
      });
      sections.push("");
    }

    if (facets.compactSessions && facets.compactSessions.length > 0) {
      sections.push("### Conversation Highlights");
      facets.compactSessions.forEach((s) => {
        sections.push(`\n**${s.labelName}**`);
        sections.push(s.content);
      });
      sections.push("");
    }

    if (facets.stats) {
      const { totalEpisodes, newFacts, activeTopics } = facets.stats;
      sections.push(
        `*${totalEpisodes} conversation${totalEpisodes !== 1 ? "s" : ""} · ${newFacts} new fact${newFacts !== 1 ? "s" : ""} · ${activeTopics} topic${activeTopics !== 1 ? "s" : ""}*\n`,
      );
    }

    if (!facets.topics?.length && !facets.entities?.length && !facets.aspects?.length) {
      sections.push("*No data found in the requested time range.*\n");
    }

    return truncateAtTokenBudget(sections.join("\n"), tokenBudget);
  }

  // Entity section (typically entity_lookup queries)
  if (result.entity) {
    sections.push("## Entity Information\n");
    sections.push(`**Name**: ${result.entity.name}`);
    sections.push(`**UUID**: ${result.entity.uuid}`);
    if (result.entity.attributes && Object.keys(result.entity.attributes).length > 0) {
      sections.push("\n**Attributes**:");
      for (const [key, value] of Object.entries(result.entity.attributes)) {
        sections.push(`- ${key}: ${value}`);
      }
    }
    sections.push("");
  }

  // Voice aspects (user's voice: directives, preferences, habits, beliefs, goals)
  if (result.voiceAspects && result.voiceAspects.length > 0) {
    sections.push("## Voice Aspects\n");
    result.voiceAspects.forEach((va) => {
      sections.push(`- [${va.aspect}] ${va.fact}`);
    });
    sections.push("");
  }

  // Statements (entity_lookup, relationship queries)
  if (result.statements && result.statements.length > 0) {
    sections.push("## Statements\n");
    result.statements.forEach((stmt) => {
      const aspectTag = stmt.aspect ? `[${stmt.aspect}] ` : "";
      sections.push(`- ${aspectTag}${stmt.fact} _(${fmtDate(stmt.validAt)})_`);
    });
    sections.push("");
  }

  // Episodes / compacts / documents
  if (result.episodes.length > 0) {
    sections.push("## Recalled Relevant Context\n");
    result.episodes.forEach((episode, index) => {
      const date = fmtDateTime(episode.createdAt);
      if (episode.isCompact) {
        sections.push(`### 📦 Session Compact`);
        sections.push(`**UUID**: ${episode.uuid}`);
        sections.push(`**Created**: ${date}`);
        if (episode.relevanceScore !== undefined) {
          sections.push(`**Relevance**: ${episode.relevanceScore.toFixed(3)}`);
        }
        sections.push("");
        sections.push(episode.content);
        sections.push("");
      } else if (episode.isDocument) {
        sections.push(`### 📄 Document ${index + 1}`);
        sections.push(`**UUID**: ${episode.uuid}`);
        sections.push(`**Created**: ${date}`);
        if (episode.relevanceScore !== undefined) {
          sections.push(`**Relevance**: ${episode.relevanceScore.toFixed(3)}`);
        }
        if (episode.labelIds.length > 0) {
          sections.push(`**Labels**: ${episode.labelIds.join(", ")}`);
        }
        sections.push("");
        sections.push(episode.content);
        sections.push("");
      } else {
        sections.push(`### Episode ${index + 1}`);
        sections.push(`**UUID**: ${episode.uuid}`);
        sections.push(`**Created**: ${date}`);
        if (episode.relevanceScore !== undefined) {
          sections.push(`**Relevance**: ${episode.relevanceScore.toFixed(3)}`);
        }
        if (episode.labelIds.length > 0) {
          sections.push(`**Labels**: ${episode.labelIds.join(", ")}`);
        }
        sections.push("");
        sections.push(episode.content);
        sections.push("");
      }
    });
  }

  // Invalidated facts (facts that are no longer valid — A3 surfacing)
  if (result.invalidatedFacts && result.invalidatedFacts.length > 0) {
    sections.push("## Invalidated Facts\n");
    result.invalidatedFacts.forEach((fact) => {
      const validDate = fmtDate(fact.validAt);
      const invalidDate = fact.invalidAt ? fmtDate(fact.invalidAt) : "";
      sections.push(`- ${fact.fact}`);
      sections.push(`  *Valid: ${validDate} → Invalidated: ${invalidDate}*`);
    });
    sections.push("");
  }

  // Empty result
  if (
    result.episodes.length === 0 &&
    (!result.statements || result.statements.length === 0) &&
    (!result.voiceAspects || result.voiceAspects.length === 0) &&
    (!result.invalidatedFacts || result.invalidatedFacts.length === 0) &&
    !result.entity
  ) {
    sections.push("*No relevant memories found.*\n");
  }

  return truncateAtTokenBudget(sections.join("\n"), tokenBudget);
}

/**
 * Truncate to the token budget on line boundaries with the REF warning footer.
 */
function truncateAtTokenBudget(text: string, budget: number): string {
  if (countTokens(text) <= budget) return text;

  const lines = text.split("\n");
  const kept: string[] = [];
  let tokens = 0;
  for (const line of lines) {
    const lineTokens = countTokens(line + "\n");
    if (tokens + lineTokens > budget) break;
    kept.push(line);
    tokens += lineTokens;
  }

  kept.push(
    "\n---",
    "> **There is more data in this time range that was not shown.** Reduce the date range (e.g. last 3 days instead of last week) to see complete results.",
  );
  return kept.join("\n");
}
