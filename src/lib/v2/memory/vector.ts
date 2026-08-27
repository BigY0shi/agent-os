import { getDb } from "../db";
import { VEC_NAMESPACES, type VecNamespace } from "../dbSchema";

/**
 * Vector provider over sqlite-vec vec0 tables (one per namespace) with sibling
 * vecmap_* tables binding rowid <-> domain uuid.
 *
 * Verified on this machine (scripts/v2/smoke-db.mjs): vec0 0.1.9 supports
 * distance_metric=cosine, distance in [0,2], similarity = 1 - distance.
 * Gotcha: vec0 rowid binds must be BigInt through better-sqlite3.
 */

export interface VectorHit {
  uuid: string;
  score: number; // cosine similarity in [-1, 1]
}

export interface VectorSearchOpts {
  limit: number;
  threshold?: number; // minimum similarity; filtered OUTSIDE the KNN (no pushdown)
  excludeUuids?: string[];
}

/** The one place the distance→similarity constant lives (SPEC-A §2.4). */
export function distToSim(distance: number): number {
  return 1 - distance;
}

function assertNs(ns: string): asserts ns is VecNamespace {
  if (!(VEC_NAMESPACES as readonly string[]).includes(ns)) {
    throw new Error(`Unknown vector namespace: ${ns}`);
  }
}

function toBuf(embedding: number[] | Float32Array): Buffer {
  const f = embedding instanceof Float32Array ? embedding : new Float32Array(embedding);
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength);
}

export function upsert(ns: VecNamespace, uuid: string, embedding: number[] | Float32Array): void {
  assertNs(ns);
  const db = getDb();
  const buf = toBuf(embedding);
  const doUpsert = db.transaction(() => {
    const existing = db
      .prepare(`SELECT rowid FROM vecmap_${ns} WHERE uuid = ?`)
      .get(uuid) as { rowid: number | bigint } | undefined;
    if (existing) {
      const rid = BigInt(existing.rowid);
      db.prepare(`DELETE FROM vec_${ns} WHERE rowid = ?`).run(rid);
      db.prepare(`INSERT INTO vec_${ns}(rowid, embedding) VALUES (?, ?)`).run(rid, buf);
    } else {
      const info = db.prepare(`INSERT INTO vecmap_${ns}(uuid) VALUES (?)`).run(uuid);
      db.prepare(`INSERT INTO vec_${ns}(rowid, embedding) VALUES (?, ?)`).run(
        BigInt(info.lastInsertRowid),
        buf,
      );
    }
  });
  doUpsert();
}

export function remove(ns: VecNamespace, uuid: string): void {
  assertNs(ns);
  const db = getDb();
  const doRemove = db.transaction(() => {
    const existing = db
      .prepare(`SELECT rowid FROM vecmap_${ns} WHERE uuid = ?`)
      .get(uuid) as { rowid: number | bigint } | undefined;
    if (!existing) return;
    db.prepare(`DELETE FROM vec_${ns} WHERE rowid = ?`).run(BigInt(existing.rowid));
    db.prepare(`DELETE FROM vecmap_${ns} WHERE rowid = ?`).run(BigInt(existing.rowid));
  });
  doRemove();
}

export function get(ns: VecNamespace, uuid: string): Float32Array | null {
  assertNs(ns);
  const db = getDb();
  const row = db
    .prepare(
      `SELECT v.embedding AS e FROM vec_${ns} v
       JOIN vecmap_${ns} m ON m.rowid = v.rowid WHERE m.uuid = ?`,
    )
    .get(uuid) as { e: Buffer } | undefined;
  if (!row) return null;
  return new Float32Array(row.e.buffer, row.e.byteOffset, row.e.byteLength / 4);
}

/**
 * Two-stage KNN (port of upstream pgvector CTE pattern): over-fetch
 * expandedLimit = max(limit*2, 100), then threshold/exclusion filters OUTSIDE
 * the KNN — sqlite-vec has the same no-threshold-pushdown property as HNSW.
 */
export function search(
  ns: VecNamespace,
  embedding: number[] | Float32Array,
  opts: VectorSearchOpts,
): VectorHit[] {
  assertNs(ns);
  const db = getDb();
  const expandedLimit = Math.max(opts.limit * 2, 100);
  const rows = db
    .prepare(
      `SELECT m.uuid AS uuid, v.distance AS distance FROM vec_${ns} v
       JOIN vecmap_${ns} m ON m.rowid = v.rowid
       WHERE v.embedding MATCH ? AND k = ?
       ORDER BY v.distance`,
    )
    .all(toBuf(embedding), BigInt(expandedLimit)) as { uuid: string; distance: number }[];

  const exclude = opts.excludeUuids?.length ? new Set(opts.excludeUuids) : null;
  const out: VectorHit[] = [];
  for (const r of rows) {
    const score = distToSim(r.distance);
    if (Number.isNaN(score)) continue;
    if (exclude?.has(r.uuid)) continue;
    if (opts.threshold !== undefined && score < opts.threshold) continue;
    out.push({ uuid: r.uuid, score });
    if (out.length >= opts.limit) break;
  }
  return out;
}

/** Score a specific uuid set against a query embedding (rerank primitive). */
export function batchScore(
  ns: VecNamespace,
  embedding: number[] | Float32Array,
  uuids: string[],
): Map<string, number> {
  assertNs(ns);
  const result = new Map<string, number>();
  if (uuids.length === 0) return result;
  const db = getDb();
  const buf = toBuf(embedding);
  const CHUNK = 200;
  for (let i = 0; i < uuids.length; i += CHUNK) {
    const slice = uuids.slice(i, i + CHUNK);
    const placeholders = slice.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT m.uuid AS uuid, vec_distance_cosine(v.embedding, ?) AS distance
         FROM vec_${ns} v JOIN vecmap_${ns} m ON m.rowid = v.rowid
         WHERE m.uuid IN (${placeholders})`,
      )
      .all(buf, ...slice) as { uuid: string; distance: number }[];
    for (const r of rows) {
      const score = distToSim(r.distance);
      if (!Number.isNaN(score)) result.set(r.uuid, score);
    }
  }
  return result;
}

/** Count vectors in a namespace (stats/diagnostics). */
export function count(ns: VecNamespace): number {
  assertNs(ns);
  const row = getDb().prepare(`SELECT COUNT(*) AS c FROM vecmap_${ns}`).get() as { c: number };
  return row.c;
}
