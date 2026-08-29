import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getDb, tx } from "../db";
import { uuid as newUuid, now } from "../ids";
import { emit } from "../events";
import { contentHash } from "./chunker";
import { getEmbeddings } from "./embed";
import { upsert as vectorUpsert } from "./vector";
import { saveEpisode } from "./graph";
import { addEpisodeLabels, resolveLabelNames } from "./labels";
import { addToQueue } from "./queue";

/**
 * A9 — one-shot legacy migration (SPEC-A §7 A9.1/A9.2).
 *
 * Four importers over the pre-V2 memory stores. Every importer is READ-ONLY
 * against the legacy files (they stay live until the retirement decision,
 * CONVENTIONS §11 — read-only 2 weeks post-A9, then decide):
 *
 *   memsearch  .memsearch/memory/YYYY-MM-DD.md        (repo)   — `### HH:MM`
 *              blocks, each followed by a `<!-- session:… turn:… -->` comment
 *              (stripped into metadata) and bullet lines.
 *   jarvis     ~/.agentic-os/jarvis-memory.jsonl               — {id, ts, text}
 *              per line (src/lib/jarvisMemory.ts). ALSO drains the two
 *              CONVENTIONS §2 pending files if they somehow exist
 *              (~/.agentic-os/jarvis-pending-episodes.jsonl and
 *              ~/.agentic-os/anynotes/pending-ingest.jsonl) — A9 owns the drain.
 *   agents     ~/.agentic-os/agents/<id>/memory/*.md           — facts.md is a
 *              bullet list (one episode), journal.md has `## <date> (run, id)`
 *              sections (one episode each). Agent id → episodes.agent_id +
 *              metadata.agentId, NEVER endUserId (endUserId = counterparties).
 *   remember   .remember/{now,recent,archive,core-memories}.md,
 *              today-*.md, archive-*.md                (repo)  — `## …`
 *              sections; dates from filenames/headings.
 *
 * Modes:
 *   dry-run       parse only — NO DB access, nothing written.
 *   raw (default) episodes DIRECTLY: saveEpisode (content = original_content =
 *                 verbatim text) + episode embedding + 'legacy'/'legacy:<src>'
 *                 labels. ZERO LLM calls (A9 raw-mode decision: hundreds of
 *                 entries × the 6–8-call pipeline is not worth it for legacy).
 *   full          opt-in flag: items ride addToQueue → the full pipeline.
 *
 * Idempotency: content_hash + source dedupe — re-running an import never
 * duplicates. Parsing is defensive: unparseable entries are counted as
 * skipped, never thrown out of the importer.
 */

export const MIGRATION_SOURCES = ["memsearch", "jarvis", "agents", "remember"] as const;
export type MigrationSource = (typeof MIGRATION_SOURCES)[number];

/** Path overrides so smoke tests can point importers at fixture trees. */
export interface MigratePaths {
  repoRoot?: string; // default process.cwd() (.memsearch / .remember live here)
  homeDir?: string; // default os.homedir() (~/.agentic-os lives here)
}

export interface MigrationItem {
  episodeBody: string;
  referenceTime: string; // ISO — from filename dates/entry timestamps, else file mtime
  source: string; // 'migration:<source>' ('migration:anynotes' for the anynotes drain)
  sessionId: string; // per-file or per-day bucket
  labels: string[]; // label NAMES, resolved via the labels.ts ladder
  metadata: Record<string, string | number | boolean>; // originFile, ...
  agentId?: string; // agents source only
}

export interface CollectResult {
  items: MigrationItem[];
  skipped: number; // unparseable/empty entries dropped (never thrown)
  filesScanned: number;
}

export interface MigrateResult {
  source: MigrationSource;
  dryRun: boolean;
  full: boolean;
  found: number;
  queued: number; // full mode: rows enqueued
  imported: number; // raw mode: episodes created
  skipped: number; // parse skips + content_hash duplicates
  sample: Array<{ source: string; referenceTime: string; bytes: number; originFile: string }>;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const MIN_BODY_CHARS = 8; // raw floor; full mode additionally needs ≥20 (zod)

function safeMtimeIso(file: string): string {
  try {
    return fs.statSync(file).mtime.toISOString();
  } catch {
    return now();
  }
}

function readTextSafe(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function listFilesSafe(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/** `YYYY-MM-DD` + optional `HH:MM` → ISO string (UTC-naive — lexical order is
 * what matters; legacy files carry no timezone). */
function dateToIso(date: string, hhmm?: string): string {
  const time = hhmm && /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : "00:00";
  return `${date}T${time}:00.000Z`;
}

const DATE_RE = /(\d{4}-\d{2}-\d{2})/;

// ---------------------------------------------------------------------------
// (a) memsearch — .memsearch/memory/YYYY-MM-DD.md
// ---------------------------------------------------------------------------

function collectMemsearch(repoRoot: string): CollectResult {
  const dir = path.join(repoRoot, ".memsearch", "memory");
  const items: MigrationItem[] = [];
  let skipped = 0;
  const files = listFilesSafe(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));

  for (const file of files.sort()) {
    const fileDate = file.slice(0, 10);
    const full = path.join(dir, file);
    const raw = readTextSafe(full);
    if (raw === null) {
      skipped++;
      continue;
    }
    const originFile = path.join(".memsearch", "memory", file);

    // Split into `### HH:MM` blocks; `## Session HH:MM` headers are structure only.
    const blockRe = /^### (\d{2}:\d{2})[^\n]*$/gm;
    const blocks: Array<{ time: string; start: number; end: number }> = [];
    for (let m = blockRe.exec(raw); m; m = blockRe.exec(raw)) {
      if (blocks.length > 0) blocks[blocks.length - 1].end = m.index;
      blocks.push({ time: m[1], start: m.index + m[0].length, end: raw.length });
    }

    if (blocks.length === 0) {
      // Defensive: a file with content but no ### blocks becomes one episode.
      const body = raw
        .split(/\r?\n/)
        .filter((l) => !/^#{1,3}\s/.test(l) && !/^<!--.*-->\s*$/.test(l))
        .join("\n")
        .trim();
      if (body.length >= MIN_BODY_CHARS) {
        items.push({
          episodeBody: body,
          referenceTime: dateToIso(fileDate),
          source: "migration:memsearch",
          sessionId: `memsearch-${fileDate}`,
          labels: ["legacy", "legacy:memsearch"],
          metadata: { originFile },
        });
      } else if (raw.trim().length > 0) {
        skipped++;
      }
      continue;
    }

    for (const block of blocks) {
      let body = raw.slice(block.start, block.end);
      const metadata: Record<string, string | number | boolean> = { originFile };
      // Strip the session/turn comment into metadata (session_id stays the
      // per-file-date bucket per SPEC A9.1a).
      const comment = /<!--\s*session:(\S+)\s+turn:(\S+)[\s\S]*?-->/.exec(body);
      if (comment) {
        metadata.sessionUuid = comment[1];
        metadata.turnUuid = comment[2];
      }
      body = body.replace(/<!--[\s\S]*?-->/g, "").trim();
      if (body.length < MIN_BODY_CHARS) {
        skipped++;
        continue;
      }
      items.push({
        episodeBody: body,
        referenceTime: dateToIso(fileDate, block.time),
        source: "migration:memsearch",
        sessionId: `memsearch-${fileDate}`,
        labels: ["legacy", "legacy:memsearch"],
        metadata,
      });
    }
  }
  return { items, skipped, filesScanned: files.length };
}

// ---------------------------------------------------------------------------
// (b) jarvis — ~/.agentic-os/jarvis-memory.jsonl (+ CONVENTIONS §2 pending drains)
// ---------------------------------------------------------------------------

function jsonlItems(
  file: string,
  originFile: string,
  source: string,
  labels: string[],
  sessionPrefix: string,
): CollectResult {
  const raw = readTextSafe(file);
  if (raw === null) return { items: [], skipped: 0, filesScanned: 0 };
  const items: MigrationItem[] = [];
  let skipped = 0;
  const mtime = safeMtimeIso(file);

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line) as Record<string, unknown>;
    } catch {
      skipped++;
      continue;
    }
    // Known shape: {id, ts, text}; pending files are drained defensively.
    const text =
      typeof rec.text === "string"
        ? rec.text
        : typeof rec.episodeBody === "string"
          ? rec.episodeBody
          : typeof rec.body === "string"
            ? rec.body
            : typeof rec.content === "string"
              ? rec.content
              : null;
    if (!text || text.trim().length < MIN_BODY_CHARS) {
      skipped++;
      continue;
    }
    let referenceTime = mtime;
    if (typeof rec.ts === "number" && Number.isFinite(rec.ts)) {
      referenceTime = new Date(rec.ts).toISOString();
    } else if (typeof rec.referenceTime === "string" && rec.referenceTime) {
      referenceTime = rec.referenceTime;
    } else if (typeof rec.createdAt === "string" && rec.createdAt) {
      referenceTime = rec.createdAt;
    }
    const metadata: Record<string, string | number | boolean> = { originFile };
    if (typeof rec.id === "string") metadata.legacyId = rec.id;
    items.push({
      episodeBody: text.trim(),
      referenceTime,
      source,
      sessionId: `${sessionPrefix}-${referenceTime.slice(0, 10)}`,
      labels,
      metadata,
    });
  }
  return { items, skipped, filesScanned: 1 };
}

function collectJarvis(homeDir: string): CollectResult {
  const base = path.join(homeDir, ".agentic-os");
  const parts: CollectResult[] = [
    jsonlItems(
      path.join(base, "jarvis-memory.jsonl"),
      "~/.agentic-os/jarvis-memory.jsonl",
      "migration:jarvis",
      ["legacy", "legacy:jarvis"],
      "jarvis",
    ),
    // CONVENTIONS §2: if a pending-JSONL somehow shipped, A9's importer drains it.
    jsonlItems(
      path.join(base, "jarvis-pending-episodes.jsonl"),
      "~/.agentic-os/jarvis-pending-episodes.jsonl",
      "migration:jarvis",
      ["legacy", "legacy:jarvis"],
      "jarvis-pending",
    ),
    jsonlItems(
      path.join(base, "anynotes", "pending-ingest.jsonl"),
      "~/.agentic-os/anynotes/pending-ingest.jsonl",
      "migration:anynotes",
      ["legacy", "legacy:anynotes"],
      "anynotes-pending",
    ),
  ];
  return {
    items: parts.flatMap((p) => p.items),
    skipped: parts.reduce((s, p) => s + p.skipped, 0),
    filesScanned: parts.reduce((s, p) => s + p.filesScanned, 0),
  };
}

// ---------------------------------------------------------------------------
// Markdown section splitter (agents journal + .remember files)
// ---------------------------------------------------------------------------

interface MdSection {
  heading: string; // without the leading `## ` ("" for pre-heading content)
  body: string;
}

function splitMdSections(raw: string): MdSection[] {
  const headRe = /^## +([^\n]+)$/gm;
  const sections: Array<{ heading: string; start: number; end: number }> = [];
  let first = raw.length;
  for (let m = headRe.exec(raw); m; m = headRe.exec(raw)) {
    if (sections.length === 0) first = m.index;
    else sections[sections.length - 1].end = m.index;
    sections.push({ heading: m[1].trim(), start: m.index + m[0].length, end: raw.length });
  }
  const out: MdSection[] = [];
  const pre = raw
    .slice(0, first)
    .replace(/^# [^\n]*$/gm, "")
    .trim();
  if (pre) out.push({ heading: "", body: pre });
  for (const s of sections) out.push({ heading: s.heading, body: raw.slice(s.start, s.end).trim() });
  return out;
}

// ---------------------------------------------------------------------------
// (c) agents — ~/.agentic-os/agents/<id>/memory/*.md
// ---------------------------------------------------------------------------

function collectAgents(homeDir: string): CollectResult {
  const base = path.join(homeDir, ".agentic-os", "agents");
  const items: MigrationItem[] = [];
  let skipped = 0;
  let filesScanned = 0;

  let agentDirs: string[] = [];
  try {
    agentDirs = fs
      .readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name);
  } catch {
    return { items, skipped, filesScanned };
  }

  for (const agentId of agentDirs) {
    const memDir = path.join(base, agentId, "memory");
    for (const file of listFilesSafe(memDir).filter((f) => f.toLowerCase().endsWith(".md"))) {
      filesScanned++;
      const full = path.join(memDir, file);
      const raw = readTextSafe(full);
      if (raw === null || raw.trim().length === 0) continue;
      const originFile = `~/.agentic-os/agents/${agentId}/memory/${file}`;
      const baseName = file.replace(/\.md$/i, "");
      const mtime = safeMtimeIso(full);

      for (const section of splitMdSections(raw)) {
        const body = (
          section.heading ? `${section.heading}\n${section.body}` : section.body
        ).trim();
        if (body.length < MIN_BODY_CHARS) {
          if (section.heading || section.body) skipped++;
          continue;
        }
        const dateMatch = DATE_RE.exec(section.heading);
        items.push({
          episodeBody: body,
          referenceTime: dateMatch ? dateToIso(dateMatch[1]) : mtime,
          source: "migration:agents",
          sessionId: `agent-${agentId}-${baseName}`,
          labels: ["legacy", "legacy:agents"],
          metadata: { originFile, agentId },
          agentId,
        });
      }
    }
  }
  return { items, skipped, filesScanned };
}

// ---------------------------------------------------------------------------
// (d) remember — .remember/*.md
// ---------------------------------------------------------------------------

function collectRemember(repoRoot: string): CollectResult {
  const dir = path.join(repoRoot, ".remember");
  const items: MigrationItem[] = [];
  let skipped = 0;

  const wanted = listFilesSafe(dir).filter(
    (f) =>
      /^(now|recent|archive|core-memories)\.md$/.test(f) ||
      /^today-\d{4}-\d{2}-\d{2}(\.done)?\.md$/.test(f) ||
      /^archive-\d{4}-\d{2}-\d{2}.*\.md$/.test(f),
  );

  for (const file of wanted.sort()) {
    const full = path.join(dir, file);
    const raw = readTextSafe(full);
    if (raw === null || raw.trim().length === 0) continue; // empty now.md etc — nothing to import
    const originFile = path.join(".remember", file);
    const fileDateMatch = DATE_RE.exec(file);
    const fileDate = fileDateMatch ? fileDateMatch[1] : null;
    const mtime = safeMtimeIso(full);
    const baseName = file.replace(/\.md$/i, "").replace(/\.done$/i, "");
    const sessionId = fileDate ? `remember-${fileDate}` : `remember-${baseName}`;

    for (const section of splitMdSections(raw)) {
      const body = (section.heading ? `${section.heading}\n${section.body}` : section.body).trim();
      if (body.length < MIN_BODY_CHARS) {
        if (section.heading || section.body) skipped++;
        continue;
      }
      // Reference time ladder: heading date (`## 2026-08-26`, `## Week of …`)
      // → heading time on a dated today-file (`## 05:02 | main`) → file date
      // → file mtime.
      let referenceTime = fileDate ? dateToIso(fileDate) : mtime;
      const headingDate = DATE_RE.exec(section.heading);
      const headingTime = /^(\d{2}:\d{2})/.exec(section.heading);
      if (headingDate) referenceTime = dateToIso(headingDate[1]);
      else if (fileDate && headingTime) referenceTime = dateToIso(fileDate, headingTime[1]);
      items.push({
        episodeBody: body,
        referenceTime,
        source: "migration:remember",
        sessionId,
        labels: ["legacy", "legacy:remember"],
        metadata: { originFile },
      });
    }
  }
  return { items, skipped, filesScanned: wanted.length };
}

// ---------------------------------------------------------------------------
// Collector dispatch (pure — NO DB access; dry-run rides this alone)
// ---------------------------------------------------------------------------

export function collectItems(source: MigrationSource, paths?: MigratePaths): CollectResult {
  const repoRoot = paths?.repoRoot ?? process.cwd();
  const homeDir = paths?.homeDir ?? os.homedir();
  switch (source) {
    case "memsearch":
      return collectMemsearch(repoRoot);
    case "jarvis":
      return collectJarvis(homeDir);
    case "agents":
      return collectAgents(homeDir);
    case "remember":
      return collectRemember(repoRoot);
    default: {
      const never: never = source;
      throw new Error(`unknown migration source: ${String(never)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Import runners
// ---------------------------------------------------------------------------

const EMBED_BATCH = 16;

function episodeExists(hash: string, source: string): boolean {
  return !!getDb()
    .prepare("SELECT uuid FROM episodes WHERE content_hash = ? AND source = ? LIMIT 1")
    .get(hash, source);
}

/** One COMPLETED queue row per raw run so the Logs tab shows the migration. */
function recordRawRunInQueue(
  source: MigrationSource,
  episodeUuids: string[],
  counts: { found: number; imported: number; skipped: number },
): void {
  if (episodeUuids.length === 0) return;
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO ingestion_queue (id, data, output, status, stage, source, title, session_id, graph_ids, created_at, processed_at)
       VALUES (?, ?, ?, 'COMPLETED', 'migration', ?, ?, NULL, ?, ?, ?)`,
    )
    .run(
      newUuid(),
      JSON.stringify({ mode: "raw", source }),
      JSON.stringify(counts),
      `migration:${source}`,
      `Legacy import: ${source}`,
      JSON.stringify(episodeUuids),
      ts,
      ts,
    );
}

/**
 * RAW mode: verbatim episodes + embeddings + legacy labels. Embeddings are
 * fetched BEFORE any rows are written (per batch), so an unreachable embedder
 * aborts cleanly and the untouched remainder imports on the next run.
 */
async function importRaw(
  source: MigrationSource,
  items: MigrationItem[],
): Promise<{ imported: number; skipped: number; episodeUuids: string[] }> {
  let imported = 0;
  let skipped = 0;
  const episodeUuids: string[] = [];

  // Resolve/create the label sets once (label create embeds best-effort).
  const labelIdCache = new Map<string, string[]>();
  for (const item of items) {
    const key = item.labels.join("|");
    if (!labelIdCache.has(key)) labelIdCache.set(key, await resolveLabelNames(item.labels));
  }

  // Idempotency: drop content_hash+source duplicates (DB and intra-run).
  const seen = new Set<string>();
  const fresh: Array<MigrationItem & { hash: string }> = [];
  for (const item of items) {
    const hash = contentHash(item.episodeBody);
    const key = `${item.source} ${hash}`;
    if (seen.has(key) || episodeExists(hash, item.source)) {
      skipped++;
      continue;
    }
    seen.add(key);
    fresh.push({ ...item, hash });
  }

  for (let i = 0; i < fresh.length; i += EMBED_BATCH) {
    const batch = fresh.slice(i, i + EMBED_BATCH);
    const embeddings = await getEmbeddings(batch.map((b) => b.episodeBody));
    tx(() => {
      for (let j = 0; j < batch.length; j++) {
        const item = batch[j];
        const episodeUuid = saveEpisode({
          content: item.episodeBody, // raw mode: content == original_content
          originalContent: item.episodeBody,
          metadata: item.metadata,
          source: item.source,
          type: "CONVERSATION",
          sessionId: item.sessionId,
          contentHash: item.hash,
          agentId: item.agentId ?? null,
          endUserId: null,
          validAt: item.referenceTime,
        });
        addEpisodeLabels(episodeUuid, labelIdCache.get(item.labels.join("|")) ?? []);
        vectorUpsert("episode", episodeUuid, embeddings[j]);
        episodeUuids.push(episodeUuid);
        imported++;
      }
    });
  }
  return { imported, skipped, episodeUuids };
}

/** FULL mode: route items through addToQueue → the 6–8-LLM-call pipeline. */
async function importFull(
  items: MigrationItem[],
): Promise<{ queued: number; skipped: number }> {
  let queued = 0;
  let skipped = 0;
  const labelIdCache = new Map<string, string[]>();
  const seen = new Set<string>();

  for (const item of items) {
    const hash = contentHash(item.episodeBody);
    const key = `${item.source} ${hash}`;
    if (seen.has(key) || episodeExists(hash, item.source) || item.episodeBody.length < 20) {
      skipped++; // <20 chars would fail the IngestBody zod floor
      continue;
    }
    seen.add(key);
    const labelKey = item.labels.join("|");
    if (!labelIdCache.has(labelKey)) {
      labelIdCache.set(labelKey, await resolveLabelNames(item.labels));
    }
    addToQueue({
      episodeBody: item.episodeBody,
      referenceTime: item.referenceTime,
      metadata: item.metadata,
      source: item.source,
      labelIds: labelIdCache.get(labelKey),
      sessionId: item.sessionId,
      agentId: item.agentId,
    });
    queued++;
  }
  return { queued, skipped };
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export async function runMigration(opts: {
  source: MigrationSource;
  dryRun?: boolean;
  full?: boolean;
  paths?: MigratePaths;
}): Promise<MigrateResult> {
  const { source, paths } = opts;
  const dryRun = opts.dryRun === true;
  const full = opts.full === true;

  const collected = collectItems(source, paths);
  const sample = collected.items.slice(0, 5).map((item) => ({
    source: item.source,
    referenceTime: item.referenceTime,
    bytes: Buffer.byteLength(item.episodeBody, "utf8"),
    originFile: String(item.metadata.originFile ?? ""),
  }));

  const result: MigrateResult = {
    source,
    dryRun,
    full,
    found: collected.items.length,
    queued: 0,
    imported: 0,
    skipped: collected.skipped,
    sample,
  };
  if (dryRun) return result;

  if (full) {
    const { queued, skipped } = await importFull(collected.items);
    result.queued = queued;
    result.skipped += skipped;
  } else {
    const { imported, skipped, episodeUuids } = await importRaw(source, collected.items);
    result.imported = imported;
    result.skipped += skipped;
    recordRawRunInQueue(source, episodeUuids, {
      found: result.found,
      imported,
      skipped: result.skipped,
    });
    if (imported > 0) {
      emit(
        "memory.migrated",
        { source: `migration:${source}`, imported, skipped: result.skipped },
        `migration:${source}`,
      );
    }
  }
  return result;
}
