import { getDb } from "../db";
import { uuid as newUuid, now } from "../ids";

/**
 * A2.8 — ingestion rules (CONVENTIONS §1.7: this table is owned by SPEC-A;
 * SPEC-D writes rows here with source = <integration account id>). The single
 * cross-spec seam is getActiveRuleTexts(source): active rules whose source is
 * NULL (all sources) or equals the given source, formatted for injection into
 * the normalize prompt (REF knowledgeGraph.server.ts getIngestionRulesForSource).
 */

export interface IngestionRule {
  id: string;
  name: string | null;
  text: string;
  source: string | null;
  preFilterJson: string | null;
  isActive: boolean;
  createdAt: string;
}

interface RuleRow {
  id: string;
  name: string | null;
  text: string;
  source: string | null;
  pre_filter_json: string | null;
  is_active: number;
  created_at: string;
}

function fromRow(r: RuleRow): IngestionRule {
  return {
    id: r.id,
    name: r.name,
    text: r.text,
    source: r.source,
    preFilterJson: r.pre_filter_json,
    isActive: r.is_active === 1,
    createdAt: r.created_at,
  };
}

/**
 * Formatted active rules for a source (or null when none) — the string the
 * normalize prompt's <ingestion_rules> block receives. NULL-source rules apply
 * to every source. Format per REF: "Name: text" / "Rule N: text", oldest-first.
 */
export function getActiveRuleTexts(source?: string): string | null {
  const db = getDb();
  const rows = (
    source
      ? db
          .prepare(
            `SELECT * FROM ingestion_rules
             WHERE is_active = 1 AND (source IS NULL OR source = ?)
             ORDER BY created_at ASC`,
          )
          .all(source)
      : db
          .prepare(
            `SELECT * FROM ingestion_rules WHERE is_active = 1 AND source IS NULL
             ORDER BY created_at ASC`,
          )
          .all()
  ) as RuleRow[];
  if (rows.length === 0) return null;
  return rows
    .map((r, i) => `${r.name ? `${r.name}: ` : `Rule ${i + 1}: `}${r.text}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// CRUD (consumed by /api/v2/memory/rules later)
// ---------------------------------------------------------------------------

export function listRules(opts: { source?: string; activeOnly?: boolean } = {}): IngestionRule[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.activeOnly) where.push("is_active = 1");
  if (opts.source !== undefined) {
    where.push("(source IS NULL OR source = ?)");
    args.push(opts.source);
  }
  const rows = getDb()
    .prepare(
      `SELECT * FROM ingestion_rules ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY created_at ASC`,
    )
    .all(...args) as RuleRow[];
  return rows.map(fromRow);
}

export function createRule(input: {
  text: string;
  name?: string | null;
  source?: string | null;
  preFilterJson?: string | null;
  isActive?: boolean;
}): IngestionRule {
  if (!input.text || !input.text.trim()) {
    throw new Error("ingestion rule text is required");
  }
  const id = newUuid();
  getDb()
    .prepare(
      `INSERT INTO ingestion_rules (id, name, text, source, pre_filter_json, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name ?? null,
      input.text.trim(),
      input.source ?? null,
      input.preFilterJson ?? null,
      input.isActive === false ? 0 : 1,
      now(),
    );
  return getRule(id)!;
}

export function getRule(id: string): IngestionRule | null {
  const row = getDb()
    .prepare("SELECT * FROM ingestion_rules WHERE id = ?")
    .get(id) as RuleRow | undefined;
  return row ? fromRow(row) : null;
}

/** Patch a rule. Rules are never deleted — deactivate instead (isActive: false). */
export function updateRule(
  id: string,
  patch: {
    text?: string;
    name?: string | null;
    source?: string | null;
    preFilterJson?: string | null;
    isActive?: boolean;
  },
): IngestionRule {
  const existing = getRule(id);
  if (!existing) throw new Error(`ingestion rule ${id} not found`);
  getDb()
    .prepare(
      `UPDATE ingestion_rules SET name = ?, text = ?, source = ?, pre_filter_json = ?, is_active = ?
       WHERE id = ?`,
    )
    .run(
      patch.name !== undefined ? patch.name : existing.name,
      patch.text !== undefined ? patch.text : existing.text,
      patch.source !== undefined ? patch.source : existing.source,
      patch.preFilterJson !== undefined ? patch.preFilterJson : existing.preFilterJson,
      patch.isActive !== undefined ? (patch.isActive ? 1 : 0) : existing.isActive ? 1 : 0,
      id,
    );
  return getRule(id)!;
}
