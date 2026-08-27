import crypto from "node:crypto";
import { encode } from "gpt-tokenizer";
import {
  CHUNK_MAX_TOKENS,
  CHUNK_MIN_PARAGRAPH_TOKENS,
  CHUNK_MIN_TOKENS,
  CHUNK_TARGET_TOKENS,
} from "./constants";

/**
 * A2.3 — episode chunker. Port of REF apps/webapp/app/services/
 * episodeChunker.server.ts (class EpisodeChunker), flattened to functions in
 * house style. Logic is kept verbatim: markdown/HTML/Setext header detection →
 * natural boundaries → token-count fallback; paragraph-boundary optimal split;
 * sha256(16 hex) content + per-chunk hashes for change detection. Thresholds
 * live in constants.ts (1800 needs / 1250 target / 750 min / 100 min-paragraph).
 */

export interface EpisodeChunk {
  content: string;
  chunkIndex: number;
  title?: string;
  context?: string;
  startPosition: number;
  endPosition: number;
  contentHash: string; // hash for change detection
}

export interface ChunkedEpisode {
  chunks: EpisodeChunk[];
  totalChunks: number;
  contentHash: string; // hash of the entire episode
  chunkHashes: string[]; // per-chunk hashes for change detection
}

interface Section {
  content: string;
  title?: string;
  startPosition: number;
  endPosition: number;
}

/** sha256 truncated to 16 hex chars — REF generateContentHash. */
export function contentHash(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex").substring(0, 16);
}

/** Token count for threshold decisions — REF getDocumentSizeInTokens. */
export function countTokens(content: string): number {
  return encode(content).length;
}

/** True when the text is at/above the chunking threshold (REF needsChunking: tokens >= maxChunkSize). */
export function needsChunking(content: string): boolean {
  return encode(content).length >= CHUNK_MAX_TOKENS;
}

/**
 * Split an episode into semantic chunks with natural boundaries.
 * Short text passes through as a single chunk (identical hashes).
 */
export function chunkEpisode(originalContent: string): ChunkedEpisode {
  if (!needsChunking(originalContent)) {
    const hash = contentHash(originalContent);
    return {
      chunks: [
        {
          content: originalContent,
          chunkIndex: 0,
          startPosition: 0,
          endPosition: originalContent.length,
          contentHash: hash,
        },
      ],
      totalChunks: 1,
      contentHash: hash,
      chunkHashes: [hash],
    };
  }

  const fullHash = contentHash(originalContent);
  const majorSections = splitByMajorSections(originalContent);

  const chunks: EpisodeChunk[] = [];
  let currentChunk = "";
  let currentChunkStart = 0;
  let chunkIndex = 0;

  for (const section of majorSections) {
    const sectionTokens = encode(section.content).length;
    const currentChunkTokens = encode(currentChunk).length;

    // If adding this section would exceed max size, finalize current chunk
    if (currentChunkTokens > 0 && currentChunkTokens + sectionTokens > CHUNK_MAX_TOKENS) {
      if (currentChunkTokens >= CHUNK_MIN_TOKENS) {
        chunks.push(
          createChunk(currentChunk, chunkIndex, currentChunkStart, currentChunkStart + currentChunk.length, section.title),
        );
        chunkIndex++;
        currentChunk = "";
        currentChunkStart = section.startPosition;
      }
    }

    // Add section to current chunk
    if (currentChunk) {
      currentChunk += "\n\n" + section.content;
    } else {
      currentChunk = section.content;
      currentChunkStart = section.startPosition;
    }

    // If current chunk is large enough and we have a natural break, consider chunking
    const updatedChunkTokens = encode(currentChunk).length;
    if (updatedChunkTokens >= CHUNK_TARGET_TOKENS) {
      const paragraphs = splitIntoParagraphs(section.content);
      if (paragraphs.length > 1) {
        const optimalSplit = findOptimalParagraphSplit(currentChunk);
        if (optimalSplit) {
          chunks.push(
            createChunk(
              optimalSplit.beforeSplit,
              chunkIndex,
              currentChunkStart,
              currentChunkStart + optimalSplit.beforeSplit.length,
              section.title,
            ),
          );
          chunkIndex++;
          currentChunk = optimalSplit.afterSplit;
          currentChunkStart = currentChunkStart + optimalSplit.beforeSplit.length;
        }
      }
    }
  }

  // Add remaining content as final chunk
  if (currentChunk.trim()) {
    chunks.push(createChunk(currentChunk, chunkIndex, currentChunkStart, originalContent.length));
  }

  return {
    chunks,
    totalChunks: chunks.length,
    contentHash: fullHash,
    chunkHashes: chunks.map((c) => c.contentHash),
  };
}

/** Compare chunk hashes to detect changes — REF compareChunkHashes. */
export function compareChunkHashes(
  oldHashes: string[],
  newHashes: string[],
): { changedIndices: number[]; changePercentage: number } {
  const maxLength = Math.max(oldHashes.length, newHashes.length);
  const changedIndices: number[] = [];
  for (let i = 0; i < maxLength; i++) {
    if (oldHashes[i] !== newHashes[i]) changedIndices.push(i);
  }
  return {
    changedIndices,
    changePercentage: maxLength > 0 ? (changedIndices.length / maxLength) * 100 : 0,
  };
}

// ---------------------------------------------------------------------------
// Section splitting (verbatim REF logic)
// ---------------------------------------------------------------------------

function splitByMajorSections(content: string): Section[] {
  const sections: Section[] = [];
  const headerMatches = findAllHeaders(content);

  if (headerMatches.length === 0) {
    // No headers found, try to split by natural boundaries
    return splitByNaturalBoundaries(content);
  }

  let lastIndex = 0;
  for (let i = 0; i < headerMatches.length; i++) {
    const match = headerMatches[i];
    const nextMatch = headerMatches[i + 1];

    const sectionStart = lastIndex;
    const sectionEnd = nextMatch ? nextMatch.startIndex : content.length;
    const sectionContent = content.slice(sectionStart, sectionEnd).trim();

    if (sectionContent) {
      sections.push({
        content: sectionContent,
        title: match.title,
        startPosition: sectionStart,
        endPosition: sectionEnd,
      });
    }
    lastIndex = match.endIndex;
  }
  return sections;
}

function findAllHeaders(content: string): Array<{ title: string; startIndex: number; endIndex: number; level: number }> {
  const headers: Array<{ title: string; startIndex: number; endIndex: number; level: number }> = [];

  // Markdown headers (# ## ### etc.)
  const markdownRegex = /^(#{1,6})\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = markdownRegex.exec(content)) !== null) {
    headers.push({
      title: match[2].trim(),
      startIndex: match.index,
      endIndex: match.index + match[0].length,
      level: match[1].length,
    });
  }

  // HTML headers (<h1>, <h2>, etc.)
  const htmlRegex = /<h([1-6])[^>]*>(.*?)<\/h[1-6]>/gi;
  while ((match = htmlRegex.exec(content)) !== null) {
    const textContent = match[2].replace(/<[^>]*>/g, "").trim();
    if (textContent) {
      headers.push({
        title: textContent,
        startIndex: match.index,
        endIndex: match.index + match[0].length,
        level: parseInt(match[1]),
      });
    }
  }

  // Underlined headers (Setext-style)
  const setextRegex = /^(.+)\n(={3,}|-{3,})$/gm;
  while ((match = setextRegex.exec(content)) !== null) {
    const level = match[2].startsWith("=") ? 1 : 2;
    headers.push({
      title: match[1].trim(),
      startIndex: match.index,
      endIndex: match.index + match[0].length,
      level,
    });
  }

  return headers.sort((a, b) => a.startIndex - b.startIndex);
}

function splitByNaturalBoundaries(content: string): Section[] {
  const sections: Section[] = [];

  // Look for natural boundaries: double line breaks, HTML block elements, etc.
  const boundaryPatterns = [
    /\n\s*\n\s*\n/g, // Triple line breaks (strong boundary)
    /<\/(?:div|section|article|main|p)>\s*<(?:div|section|article|main|p)/gi, // HTML block boundaries
    /\n\s*[-=*]{4,}\s*\n/g, // Horizontal rules
  ];

  let boundaries: number[] = [0];
  for (const pattern of boundaryPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      boundaries.push(match.index);
    }
  }
  boundaries.push(content.length);
  boundaries = [...new Set(boundaries)].sort((a, b) => a - b);

  // If no natural boundaries found, split by token count
  if (boundaries.length <= 2) {
    return splitByTokenCount(content);
  }

  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i];
    const end = boundaries[i + 1];
    const sectionContent = content.slice(start, end).trim();
    if (sectionContent && encode(sectionContent).length >= CHUNK_MIN_PARAGRAPH_TOKENS) {
      sections.push({ content: sectionContent, startPosition: start, endPosition: end });
    }
  }

  return sections.length > 0 ? sections : splitByTokenCount(content);
}

function splitByTokenCount(content: string): Section[] {
  const sections: Section[] = [];
  const totalTokens = encode(content).length;
  const numSections = Math.ceil(totalTokens / CHUNK_TARGET_TOKENS);
  const charsPerSection = Math.ceil(content.length / numSections);

  for (let i = 0; i < numSections; i++) {
    const start = i * charsPerSection;
    const end = Math.min((i + 1) * charsPerSection, content.length);

    // Try to break at word boundaries
    let actualEnd = end;
    if (end < content.length) {
      const nextSpace = content.indexOf(" ", end);
      const nextNewline = content.indexOf("\n", end);
      const nextBoundary = Math.min(
        nextSpace === -1 ? Infinity : nextSpace,
        nextNewline === -1 ? Infinity : nextNewline,
      );
      if (nextBoundary !== Infinity && nextBoundary - end < 100) {
        actualEnd = nextBoundary;
      }
    }

    const sectionContent = content.slice(start, actualEnd).trim();
    if (sectionContent) {
      sections.push({ content: sectionContent, startPosition: start, endPosition: actualEnd });
    }
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Paragraph splitting + optimal split (verbatim REF logic)
// ---------------------------------------------------------------------------

function splitIntoParagraphs(content: string): string[] {
  // Handle HTML paragraphs first
  if (content.includes("<p") || content.includes("<div") || content.includes("<section")) {
    return splitHtmlParagraphs(content);
  }
  // Split by double newlines (paragraph breaks) for text/markdown
  return content
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function splitHtmlParagraphs(content: string): string[] {
  const paragraphs: string[] = [];
  const blockElements = ["p", "div", "section", "article", "li", "blockquote", "pre"];
  const blockRegex = new RegExp(`<(${blockElements.join("|")})[^>]*>.*?</\\1>`, "gis");

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(content)) !== null) {
    // Add content before this block element
    if (match.index > lastIndex) {
      const beforeContent = content.slice(lastIndex, match.index).trim();
      if (beforeContent) paragraphs.push(beforeContent);
    }
    // Add the block element content (strip tags for text content)
    const blockContent = match[0].replace(/<[^>]*>/g, " ").trim();
    if (blockContent) paragraphs.push(blockContent);
    lastIndex = match.index + match[0].length;
  }

  // Add remaining content
  if (lastIndex < content.length) {
    const remainingContent = content.slice(lastIndex).trim();
    if (remainingContent) {
      const cleaned = remainingContent.replace(/<[^>]*>/g, " ").trim();
      if (cleaned) {
        paragraphs.push(...cleaned.split(/\n\s*\n/).filter((p) => p.trim().length > 0));
      }
    }
  }

  return paragraphs.length > 0 ? paragraphs : splitTextParagraphs(content);
}

function splitTextParagraphs(content: string): string[] {
  return content
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function findOptimalParagraphSplit(content: string): { beforeSplit: string; afterSplit: string } | null {
  const paragraphs = splitIntoParagraphs(content);
  if (paragraphs.length < 2) return null;

  let bestSplitIndex = -1;
  let bestScore = 0;

  // Find the split that gets us closest to target size
  for (let i = 1; i < paragraphs.length; i++) {
    const beforeSplit = paragraphs.slice(0, i).join("\n\n");
    const afterSplit = paragraphs.slice(i).join("\n\n");

    const beforeTokens = encode(beforeSplit).length;
    const afterTokens = encode(afterSplit).length;

    // Score based on how close we get to target, avoiding too small chunks
    if (beforeTokens >= CHUNK_MIN_TOKENS && afterTokens >= CHUNK_MIN_PARAGRAPH_TOKENS) {
      const beforeDistance = Math.abs(beforeTokens - CHUNK_TARGET_TOKENS);
      const score = 1 / (1 + beforeDistance); // higher score for closer to target
      if (score > bestScore) {
        bestScore = score;
        bestSplitIndex = i;
      }
    }
  }

  if (bestSplitIndex > 0) {
    return {
      beforeSplit: paragraphs.slice(0, bestSplitIndex).join("\n\n"),
      afterSplit: paragraphs.slice(bestSplitIndex).join("\n\n"),
    };
  }
  return null;
}

function createChunk(
  content: string,
  chunkIndex: number,
  startPosition: number,
  endPosition: number,
  title?: string,
): EpisodeChunk {
  // Generate a concise context/title if not provided
  const context = title || generateChunkContext(content);
  const hash = contentHash(content.trim());
  return {
    content: content.trim(),
    chunkIndex,
    title: context,
    context: `Chunk ${chunkIndex + 1}${context ? `: ${context}` : ""}`,
    startPosition,
    endPosition,
    contentHash: hash,
  };
}

function generateChunkContext(content: string): string {
  // Clean content from HTML tags and markup
  const cleanContent = content
    .replace(/<[^>]*>/g, " ") // remove HTML tags
    .replace(/#{1,6}\s+/g, "") // remove markdown headers
    .replace(/[=-]{3,}/g, "") // remove underline headers
    .replace(/\s+/g, " ") // normalize whitespace
    .trim();

  if (!cleanContent) return "Document content";

  // Find first substantial sentence or line
  const sentences = cleanContent
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const sentence of sentences.slice(0, 2)) {
    if (sentence.length > 20) {
      return sentence.substring(0, 100) + (sentence.length > 100 ? "..." : "");
    }
  }

  // Fallback to first meaningful chunk
  const words = cleanContent.split(/\s+/).slice(0, 15).join(" ");
  return words.substring(0, 100) + (words.length > 100 ? "..." : "");
}
