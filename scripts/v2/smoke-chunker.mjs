// A2.3 smoke: chunker thresholds/bounds + hash stability + short-text pass-through.
// Pure compute (no DB, no network). Run: npx tsx scripts/v2/smoke-chunker.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// Temp env BEFORE imports — never touch the live DB/settings (house rule).
const tmp = path.join(os.tmpdir(), `agentos-smoke-chunker-${Date.now()}.db`);
process.env.AGENTIC_OS_DB = tmp;
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-chunker-"));
process.env.AGENTIC_OS_SETTINGS = path.join(settingsDir, "settings.json");

const { needsChunking, chunkEpisode, countTokens, compareChunkHashes } = await import(
  "../../src/lib/v2/memory/chunker.ts"
);
const { CHUNK_MAX_TOKENS, CHUNK_MIN_TOKENS } = await import("../../src/lib/v2/memory/constants.ts");

let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
};

// --- Fixture: deterministic ~3k-token text in ~100-token paragraphs ---
const sentence =
  "The ingestion pipeline normalizes each raw episode into enriched statements, extracts world and voice facts in parallel, and stores every triple in the knowledge graph for later recall.";
const paragraph = (i) => `Paragraph ${i}: ${sentence} ${sentence} ${sentence}`;
const paragraphs = [];
let text = "";
for (let i = 1; countTokens(text) < 3000; i++) {
  paragraphs.push(paragraph(i));
  text = paragraphs.join("\n\n");
}
const totalTokens = countTokens(text);
console.log(`      fixture: ${paragraphs.length} paragraphs, ${totalTokens} tokens`);

// --- needsChunking gate ---
check("short text does NOT need chunking", !needsChunking("Yoshi moved to LA."));
check(`3k-token text needs chunking (>= ${CHUNK_MAX_TOKENS})`, needsChunking(text));

// --- Chunk the 3k-token text ---
const result = chunkEpisode(text);
const tokenCounts = result.chunks.map((c) => countTokens(c.content));
console.log(`      chunks: ${result.totalChunks} — token counts [${tokenCounts.join(", ")}]`);
check("3k-token text -> 2-3 chunks", result.totalChunks >= 2 && result.totalChunks <= 3);
check(
  `every chunk <= max (${CHUNK_MAX_TOKENS})`,
  tokenCounts.every((t) => t <= CHUNK_MAX_TOKENS),
);
check(
  `every non-final chunk >= min (${CHUNK_MIN_TOKENS})`,
  tokenCounts.slice(0, -1).every((t) => t >= CHUNK_MIN_TOKENS),
);
check("chunkHashes match chunks", result.chunkHashes.length === result.totalChunks);
check(
  "hashes are 16-hex",
  [result.contentHash, ...result.chunkHashes].every((h) => /^[0-9a-f]{16}$/.test(h)),
);
check("chunk indices sequential", result.chunks.every((c, i) => c.chunkIndex === i));
check("no chunk content lost (all content non-empty)", result.chunks.every((c) => c.content.trim().length > 0));

// --- Hash stability across runs ---
const again = chunkEpisode(text);
check("contentHash stable across runs", again.contentHash === result.contentHash);
check(
  "chunkHashes stable across runs",
  JSON.stringify(again.chunkHashes) === JSON.stringify(result.chunkHashes),
);
const diff = compareChunkHashes(result.chunkHashes, again.chunkHashes);
check("compareChunkHashes reports zero drift", diff.changedIndices.length === 0 && diff.changePercentage === 0);

// --- Short text passes through unchunked, verbatim ---
const short = "Yoshi runs a Proxmox homelab and prefers Opera over Chrome.";
const single = chunkEpisode(short);
check("short text -> exactly 1 chunk", single.totalChunks === 1);
check("short text content verbatim (not trimmed/mutated)", single.chunks[0].content === short);
check("short text chunkHash == contentHash", single.chunkHashes[0] === single.contentHash);

// --- Changed content changes hashes ---
const changed = chunkEpisode(text + "\n\nParagraph extra: something new happened today.");
check("changed content -> different contentHash", changed.contentHash !== result.contentHash);

try {
  fs.rmSync(settingsDir, { recursive: true, force: true });
} catch {}
console.log(failures === 0 ? "\nsmoke-chunker: ALL PASS" : `\nsmoke-chunker: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
