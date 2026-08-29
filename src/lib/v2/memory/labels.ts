import { getDb, tx } from "../db";
import { uuid as newUuid, now } from "../ids";
import { getEmbedding } from "./embed";
import { search as vectorSearch, upsert as vectorUpsert } from "./vector";
import { modelCall } from "./llm";
import {
  labelAssignmentPrompt,
  LabelExtractionSchema,
} from "./prompts/label-assignment";
import { LABEL_SEMANTIC_MATCH_THRESHOLD } from "./constants";

/**
 * A2.7 — labels: exact → 0.85-semantic → create ladder, ported from
 * REF apps/webapp/app/jobs/labels/label-assignment.logic.ts. Adaptations:
 *  - Prisma label table → labels + episode_labels/document_labels junctions
 *  - vector provider LABEL namespace → vector.ts 'label' ns (no metadata
 *    filter — single-user store)
 *  - "Persona" label is excluded from assignment (REF behavior kept)
 *  - label embeddings are best-effort on create: resolveLabelNames must work
 *    with Ollama down (ingestFromModule enqueues offline), so an embed failure
 *    logs a warning instead of failing the create.
 */

export interface LabelRow {
  id: string;
  name: string;
  description: string | null;
  color: string;
  createdAt: string;
}

interface RawLabelRow {
  id: string;
  name: string;
  description: string | null;
  color: string;
  created_at: string;
}

function fromRow(r: RawLabelRow): LabelRow {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    color: r.color,
    createdAt: r.created_at,
  };
}

/** Random OKLCH label color — verbatim port of REF color-utils generateOklchColor. */
export function generateOklchColor(): string {
  const hue = Math.floor(Math.random() * (360 - 30 + 1)) + 30;
  return `oklch(66% 0.1835 ${hue})`;
}

export function listLabels(): LabelRow[] {
  const rows = getDb()
    .prepare("SELECT * FROM labels ORDER BY name COLLATE NOCASE ASC")
    .all() as RawLabelRow[];
  return rows.map(fromRow);
}

export function getLabel(id: string): LabelRow | null {
  const row = getDb().prepare("SELECT * FROM labels WHERE id = ?").get(id) as
    | RawLabelRow
    | undefined;
  return row ? fromRow(row) : null;
}

/** Case-insensitive exact-name lookup (labels.name is UNIQUE COLLATE NOCASE). */
export function getLabelByName(name: string): LabelRow | null {
  const row = getDb()
    .prepare("SELECT * FROM labels WHERE name = ? COLLATE NOCASE LIMIT 1")
    .get(name) as RawLabelRow | undefined;
  return row ? fromRow(row) : null;
}

/**
 * Create a label (auto OKLCH color). Race/duplicate-safe: an existing
 * NOCASE-equal name returns the existing row (REF "already exists" recovery).
 * Embeds "name: description" into the label namespace best-effort so the
 * 0.85 semantic ladder can match it later.
 */
export async function createLabel(input: {
  name: string;
  description?: string | null;
  color?: string;
}): Promise<LabelRow> {
  const name = input.name.trim();
  if (!name) throw new Error("label name is required");
  const existing = getLabelByName(name);
  if (existing) return existing;

  const id = newUuid();
  try {
    getDb()
      .prepare(
        "INSERT INTO labels (id, name, description, color, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, name, input.description ?? null, input.color || generateOklchColor(), now());
  } catch (err) {
    // UNIQUE race — someone else created it between lookup and insert
    const raced = getLabelByName(name);
    if (raced) return raced;
    throw err;
  }

  // Best-effort embedding (requires Ollama; label creation must not).
  try {
    const labelText = input.description ? `${name}: ${input.description}` : name;
    const embedding = await getEmbedding(labelText);
    vectorUpsert("label", id, embedding);
  } catch (err) {
    console.warn(
      `[v2/memory/labels] could not embed label "${name}" (semantic matching degraded until re-embed):`,
      err instanceof Error ? err.message : err,
    );
  }

  return getLabel(id)!;
}

/**
 * Patch a label (name/description/color) — /api/v2/memory/labels PATCH.
 * Re-embeds best-effort when name/description change (semantic ladder parity
 * with createLabel); a failed embed degrades matching, never the update.
 */
export async function updateLabel(
  id: string,
  patch: { name?: string; description?: string | null; color?: string },
): Promise<LabelRow> {
  const existing = getLabel(id);
  if (!existing) throw new Error(`label ${id} not found`);

  const name = patch.name !== undefined ? patch.name.trim() : existing.name;
  if (!name) throw new Error("label name is required");
  if (patch.name !== undefined && name.toLowerCase() !== existing.name.toLowerCase()) {
    const clash = getLabelByName(name);
    if (clash && clash.id !== id) throw new Error(`label "${name}" already exists`);
  }
  const description =
    patch.description !== undefined ? patch.description : existing.description;
  const color = patch.color !== undefined && patch.color ? patch.color : existing.color;

  getDb()
    .prepare("UPDATE labels SET name = ?, description = ?, color = ? WHERE id = ?")
    .run(name, description, color, id);

  if (patch.name !== undefined || patch.description !== undefined) {
    try {
      const labelText = description ? `${name}: ${description}` : name;
      vectorUpsert("label", id, await getEmbedding(labelText));
    } catch (err) {
      console.warn(
        `[v2/memory/labels] could not re-embed label "${name}" (semantic matching degraded until re-embed):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return getLabel(id)!;
}

/**
 * CONVENTIONS §4 ladder for label NAMES coming from other modules
 * (ingestFromModule labelNames): exact NOCASE match, else create.
 * Returns deduped label ids in input order.
 */
export async function resolveLabelNames(names: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const label = getLabelByName(name) ?? (await createLabel({ name }));
    if (!out.includes(label.id)) out.push(label.id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Junction writes
// ---------------------------------------------------------------------------

/** MERGE label ids onto one episode (episode_labels junction). */
export function addEpisodeLabels(episodeUuid: string, labelIds: string[]): void {
  if (labelIds.length === 0) return;
  tx((db) => {
    const insert = db.prepare(
      "INSERT OR IGNORE INTO episode_labels (episode_uuid, label_id) VALUES (?, ?)",
    );
    for (const id of labelIds) insert.run(episodeUuid, id);
  });
}

/** MERGE label ids onto every episode of a session (REF updateEpisodeLabels). */
export function addSessionEpisodeLabels(sessionId: string, labelIds: string[]): number {
  if (labelIds.length === 0) return 0;
  return tx((db) => {
    const episodes = (
      db.prepare("SELECT uuid FROM episodes WHERE session_id = ?").all(sessionId) as {
        uuid: string;
      }[]
    ).map((r) => r.uuid);
    const insert = db.prepare(
      "INSERT OR IGNORE INTO episode_labels (episode_uuid, label_id) VALUES (?, ?)",
    );
    for (const ep of episodes) for (const id of labelIds) insert.run(ep, id);
    return episodes.length;
  });
}

// ---------------------------------------------------------------------------
// LLM label assignment (REF processLabelAssignment)
// ---------------------------------------------------------------------------

interface ExtractedLabel {
  name: string;
  description: string;
  isNew: boolean;
  labelId?: string;
}

/**
 * Extract labels from an episode — matches existing labels (exact name, then
 * 0.85 label-ns semantic) or marks new ones (REF extractLabelsFromEpisode).
 */
export async function extractLabelsFromEpisode(
  episodeBody: string,
  availableLabels: Array<{ id: string; name: string; description: string | null }>,
  sessionContext?: string,
): Promise<ExtractedLabel[]> {
  const messages = labelAssignmentPrompt(episodeBody, availableLabels, sessionContext);

  const response = await modelCall(messages, "medium", {
    schema: LabelExtractionSchema,
    temperature: 0.3, // REF: low temperature for consistent label extraction
  });

  const labelMap = new Map(availableLabels.map((l) => [l.name.toLowerCase(), l]));
  const extracted: ExtractedLabel[] = [];

  for (const raw of response.labels) {
    // Step 1: exact name match (case-insensitive)
    const exactMatch = labelMap.get(raw.name.toLowerCase());
    if (exactMatch) {
      extracted.push({
        name: exactMatch.name,
        description: raw.description,
        isNew: false,
        labelId: exactMatch.id,
      });
      continue;
    }

    // Step 2: semantic similarity over the label namespace
    try {
      const labelText = `${raw.name}: ${raw.description}`;
      const embedding = await getEmbedding(labelText);
      const similar = vectorSearch("label", embedding, {
        limit: 1,
        threshold: LABEL_SEMANTIC_MATCH_THRESHOLD,
      });
      if (similar.length > 0 && Number.isFinite(similar[0].score)) {
        const matched = availableLabels.find((l) => l.id === similar[0].uuid);
        if (matched) {
          extracted.push({
            name: matched.name,
            description: raw.description,
            isNew: false,
            labelId: matched.id,
          });
          continue;
        }
      }
    } catch (err) {
      console.warn(
        `[v2/memory/labels] semantic label match failed for "${raw.name}" — treating as new:`,
        err instanceof Error ? err.message : err,
      );
    }

    // Step 3: no match — new label
    extracted.push({ name: raw.name, description: raw.description, isNew: true });
  }

  return extracted;
}

export interface AssignLabelsResult {
  assignedLabelIds: string[];
  createdLabelIds: string[];
}

/**
 * LLM label assignment for a completed ingestion (REF processLabelAssignment).
 * Skipped by the queue when labelIds were explicitly provided. Writes:
 *  - ingestion_queue.label_ids
 *  - episode_labels for every episode of the session
 *  - document_labels when a session document already exists (compaction A5)
 * "Persona" is excluded from candidates and never auto-assigned.
 */
export async function assignLabels(queueId: string): Promise<AssignLabelsResult> {
  const db = getDb();
  const queue = db
    .prepare("SELECT * FROM ingestion_queue WHERE id = ?")
    .get(queueId) as
    | { id: string; data: string; title: string | null; session_id: string | null; label_ids: string }
    | undefined;
  if (!queue) throw new Error(`ingestion queue ${queueId} not found`);
  if (queue.title === "Persona") return { assignedLabelIds: [], createdLabelIds: [] };

  let body: { episodeBody?: string } = {};
  try {
    body = JSON.parse(queue.data);
  } catch {
    /* fall through to the empty-body guard */
  }
  const episodeBody = body.episodeBody || "";
  if (!episodeBody) throw new Error(`no episode body found for queue ${queueId}`);

  // Existing labels + session context from the session document (if compacted)
  let existingLabelIds: string[] = [];
  let sessionContext: string | undefined;
  let documentId: string | null = null;
  if (queue.session_id) {
    const doc = db
      .prepare("SELECT id, content FROM documents WHERE session_id = ?")
      .get(queue.session_id) as { id: string; content: string } | undefined;
    if (doc) {
      documentId = doc.id;
      sessionContext = doc.content;
      existingLabelIds = (
        db
          .prepare("SELECT label_id FROM document_labels WHERE document_id = ?")
          .all(doc.id) as { label_id: string }[]
      ).map((r) => r.label_id);
    }
  }

  const availableLabels = listLabels()
    .filter((l) => l.name !== "Persona")
    .map((l) => ({ id: l.id, name: l.name, description: l.description }));

  const extracted = await extractLabelsFromEpisode(episodeBody, availableLabels, sessionContext);

  const matchedLabelIds = extracted
    .filter((l) => !l.isNew && l.labelId)
    .map((l) => l.labelId as string);

  const createdLabelIds: string[] = [];
  for (const suggested of extracted.filter((l) => l.isNew)) {
    try {
      const label = await createLabel({
        name: suggested.name,
        description: suggested.description,
      });
      createdLabelIds.push(label.id);
    } catch (err) {
      console.warn(
        `[v2/memory/labels] failed to create label "${suggested.name}":`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const allLabelIds = Array.from(
    new Set([...existingLabelIds, ...matchedLabelIds, ...createdLabelIds]),
  );

  // Write-back: queue row, session document, session episodes
  db.prepare("UPDATE ingestion_queue SET label_ids = ? WHERE id = ?").run(
    JSON.stringify(allLabelIds),
    queueId,
  );
  if (documentId) {
    tx((d) => {
      const insert = d.prepare(
        "INSERT OR IGNORE INTO document_labels (document_id, label_id) VALUES (?, ?)",
      );
      for (const id of allLabelIds) insert.run(documentId!, id);
    });
  }
  if (queue.session_id) addSessionEpisodeLabels(queue.session_id, allLabelIds);

  return { assignedLabelIds: allLabelIds, createdLabelIds };
}
