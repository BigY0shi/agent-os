import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb, tx } from "../db";
import { now } from "../ids";
import { emit } from "../events";
import {
  getEpisode,
  getEpisodeUuidsForStatement,
  getStatementsForEpisode,
} from "./graph";
import { get as vectorGet, remove as vectorRemove } from "./vector";
import type { StatementNode, VoiceAspectNode } from "./types";

/**
 * A8.5 — cascade-EXILE for DELETE /api/v2/memory/episodes/[id].
 *
 * Semantics = REF deleteEpisodeWithRelatedNodes (neo4j/domains/episode.ts),
 * exile-flavored per SPEC-A A8.5 + §8.10 deletion policy:
 *  - statements whose ONLY provenance is this episode are removed; statements
 *    with other provenance are KEPT and merely lose this episode's provenance
 *    edge (REF DETACH DELETE episode);
 *  - entities referenced ONLY by the removed statements are removed (orphans);
 *  - voice aspects lose this episode from episode_uuids; ones left with an
 *    empty list are removed (voice analog of sole-provenance);
 *  - vec rows for every exiled row are removed (§8.10 sanctions this);
 *  - BEFORE any row is touched, the full bundle (episode, statements, entities,
 *    voice aspects, embeddings) is written to
 *    `~/.agentic-os/.exile/memory/<stamp>-<episodeUuid>.json` and its existence
 *    on disk is verified. No exile file ⇒ no deletion.
 */

export interface ExileCascadeResult {
  ok: true;
  episodeUuid: string;
  exiledTo: string;
  removed: {
    statements: number;
    entities: number;
    voiceAspects: number;
  };
  keptStatements: number;
}

interface VoiceHit {
  node: VoiceAspectNode;
  remaining: string[]; // episode_uuids minus the exiled episode
}

function exileDir(): string {
  return path.join(os.homedir(), ".agentic-os", ".exile", "memory");
}

function embeddingOrNull(ns: "episode" | "statement" | "entity" | "voice_aspect", uuid: string): number[] | null {
  try {
    const v = vectorGet(ns, uuid);
    return v ? Array.from(v) : null;
  } catch {
    return null;
  }
}

export function exileEpisodeCascade(episodeUuid: string): ExileCascadeResult {
  const db = getDb();
  const episode = getEpisode(episodeUuid);
  if (!episode) throw new Error(`episode ${episodeUuid} not found`);

  // ---- Plan the cascade (reads only) ----
  const allStatements = getStatementsForEpisode(episodeUuid, { includeInvalidated: true });
  const statementsToRemove: StatementNode[] = [];
  const statementsKept: StatementNode[] = [];
  for (const st of allStatements) {
    const otherProvenance = getEpisodeUuidsForStatement(st.uuid).filter(
      (u) => u !== episodeUuid,
    );
    if (otherProvenance.length === 0) statementsToRemove.push(st);
    else statementsKept.push(st);
  }
  const removeSet = statementsToRemove.map((s) => s.uuid);

  // Entities touched by the removed statements; orphaned = no statement OUTSIDE
  // the remove set references them (REF orphanedEntities logic).
  let entitiesToRemove: { uuid: string; name: string; type: string | null; attributes: string }[] = [];
  if (removeSet.length > 0) {
    const ph = removeSet.map(() => "?").join(",");
    const candidateUuids = (
      db
        .prepare(
          `SELECT DISTINCT to_uuid AS uuid FROM edges
           WHERE type IN ('subject','predicate','object') AND from_uuid IN (${ph})`,
        )
        .all(...removeSet) as { uuid: string }[]
    ).map((r) => r.uuid);
    for (const entUuid of candidateUuids) {
      const outside = db
        .prepare(
          `SELECT COUNT(*) AS c FROM edges
           WHERE type IN ('subject','predicate','object') AND to_uuid = ?
             AND from_uuid NOT IN (${ph})`,
        )
        .get(entUuid, ...removeSet) as { c: number };
      if (outside.c === 0) {
        const row = db
          .prepare("SELECT uuid, name, type, attributes FROM entities WHERE uuid = ?")
          .get(entUuid) as { uuid: string; name: string; type: string | null; attributes: string } | undefined;
        if (row) entitiesToRemove.push(row);
      }
    }
  }

  // Voice aspects referencing this episode (episode_uuids JSON array).
  const voiceHits: VoiceHit[] = [];
  const voiceRows = db
    .prepare("SELECT * FROM voice_aspects WHERE episode_uuids LIKE ?")
    .all(`%${episodeUuid}%`) as {
    uuid: string;
    fact: string;
    aspect: string;
    episode_uuids: string;
    user_id: string;
    created_at: string;
    valid_at: string;
    invalid_at: string | null;
    invalidated_by: string | null;
  }[];
  for (const r of voiceRows) {
    let list: string[] = [];
    try {
      list = JSON.parse(r.episode_uuids) as string[];
    } catch {
      /* malformed tolerated */
    }
    if (!Array.isArray(list) || !list.includes(episodeUuid)) continue; // LIKE false positive
    voiceHits.push({
      node: {
        uuid: r.uuid,
        fact: r.fact,
        aspect: r.aspect as VoiceAspectNode["aspect"],
        episodeUuids: list,
        userId: r.user_id,
        createdAt: r.created_at,
        validAt: r.valid_at,
        invalidAt: r.invalid_at,
        invalidatedBy: r.invalidated_by,
      },
      remaining: list.filter((u) => u !== episodeUuid),
    });
  }
  const voiceToRemove = voiceHits.filter((v) => v.remaining.length === 0);
  const voiceToUpdate = voiceHits.filter((v) => v.remaining.length > 0);

  // Labels on the episode (id + name for the bundle).
  const labelRows =
    episode.labelIds.length > 0
      ? (db
          .prepare(
            `SELECT id, name, color FROM labels WHERE id IN (${episode.labelIds.map(() => "?").join(",")})`,
          )
          .all(...episode.labelIds) as { id: string; name: string; color: string }[])
      : [];

  // ---- Write the exile bundle FIRST (no bundle on disk ⇒ no deletion) ----
  const dir = exileDir();
  fs.mkdirSync(dir, { recursive: true });
  const stamp = now().slice(0, 19).replace(/:/g, "-").replace("T", "_");
  const exilePath = path.join(dir, `${stamp}-${episodeUuid}.json`);
  const bundle = {
    exiledAt: now(),
    kind: "episode-cascade-exile",
    episode,
    labels: labelRows,
    statements: {
      removed: statementsToRemove,
      // Kept statements lose only this episode's provenance edge — recorded so
      // the bundle can restore the edge if ever needed.
      keptProvenanceDetached: statementsKept.map((s) => ({ uuid: s.uuid, fact: s.fact })),
    },
    entitiesRemoved: entitiesToRemove.map((e) => ({
      uuid: e.uuid,
      name: e.name,
      type: e.type,
      attributes: e.attributes,
    })),
    voiceAspects: {
      removed: voiceToRemove.map((v) => v.node),
      episodeUnlinked: voiceToUpdate.map((v) => ({ uuid: v.node.uuid, fact: v.node.fact })),
    },
    embeddings: {
      episode: embeddingOrNull("episode", episodeUuid),
      statements: Object.fromEntries(
        removeSet.map((u) => [u, embeddingOrNull("statement", u)]),
      ),
      entities: Object.fromEntries(
        entitiesToRemove.map((e) => [e.uuid, embeddingOrNull("entity", e.uuid)]),
      ),
      voiceAspects: Object.fromEntries(
        voiceToRemove.map((v) => [v.node.uuid, embeddingOrNull("voice_aspect", v.node.uuid)]),
      ),
    },
  };
  fs.writeFileSync(exilePath, JSON.stringify(bundle, null, 2), "utf8");

  // Hard gate: verify the export landed before ANY row is removed.
  if (!fs.existsSync(exilePath) || fs.statSync(exilePath).size === 0) {
    throw new Error(
      `exile export did not land at ${exilePath} — aborting delete (nothing was removed)`,
    );
  }

  // ---- Remove rows (single transaction) ----
  const entityUuids = entitiesToRemove.map((e) => e.uuid);
  tx((d) => {
    // Episode's provenance edges (to kept AND removed statements).
    d.prepare("DELETE FROM edges WHERE type = 'provenance' AND from_uuid = ?").run(
      episodeUuid,
    );
    if (removeSet.length > 0) {
      const ph = removeSet.map(() => "?").join(",");
      // Statement→entity edges + any residual provenance edges to them.
      d.prepare(
        `DELETE FROM edges WHERE from_uuid IN (${ph}) AND type IN ('subject','predicate','object')`,
      ).run(...removeSet);
      d.prepare(`DELETE FROM edges WHERE type = 'provenance' AND to_uuid IN (${ph})`).run(
        ...removeSet,
      );
      d.prepare(`DELETE FROM statements WHERE uuid IN (${ph})`).run(...removeSet);
    }
    if (entityUuids.length > 0) {
      const ph = entityUuids.map(() => "?").join(",");
      d.prepare(`DELETE FROM edges WHERE to_uuid IN (${ph})`).run(...entityUuids);
      d.prepare(`DELETE FROM entities WHERE uuid IN (${ph})`).run(...entityUuids);
    }
    for (const v of voiceToUpdate) {
      d.prepare("UPDATE voice_aspects SET episode_uuids = ? WHERE uuid = ?").run(
        JSON.stringify(v.remaining),
        v.node.uuid,
      );
    }
    if (voiceToRemove.length > 0) {
      const ph = voiceToRemove.map(() => "?").join(",");
      d.prepare(`DELETE FROM voice_aspects WHERE uuid IN (${ph})`).run(
        ...voiceToRemove.map((v) => v.node.uuid),
      );
    }
    d.prepare("DELETE FROM episode_labels WHERE episode_uuid = ?").run(episodeUuid);
    d.prepare("DELETE FROM episodes WHERE uuid = ?").run(episodeUuid);
  });

  // ---- Vec rows for exiled rows (§8.10) — after the tx, best-effort ----
  try {
    vectorRemove("episode", episodeUuid);
    for (const u of removeSet) vectorRemove("statement", u);
    for (const u of entityUuids) vectorRemove("entity", u);
    for (const v of voiceToRemove) vectorRemove("voice_aspect", v.node.uuid);
  } catch (err) {
    console.warn(
      "[v2/memory/exile] vec cleanup incomplete (rows already exiled):",
      err instanceof Error ? err.message : err,
    );
  }

  const result: ExileCascadeResult = {
    ok: true,
    episodeUuid,
    exiledTo: exilePath,
    removed: {
      statements: removeSet.length,
      entities: entityUuids.length,
      voiceAspects: voiceToRemove.length,
    },
    keptStatements: statementsKept.length,
  };

  emit(
    "memory.exiled",
    {
      episodeUuid,
      exiledTo: exilePath,
      ...result.removed,
      keptStatements: statementsKept.length,
    },
    "memory",
  );

  return result;
}
