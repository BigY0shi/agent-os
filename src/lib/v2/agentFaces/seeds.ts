// S35 Agent faces: the per-agent seed store behind "New shape" / "Reset".
//
// Seeds live in the runtime settings store (settings.agents.faces.seeds, rule 16: a
// gear setting, read per request, survives reloads and server restarts, redirected by
// AGENTIC_OS_SETTINGS in smokes). A stored seed replaces the id-derived one; Reset
// writes null, which the reader treats as "no override" (deepMerge cannot drop keys).
// Nothing here fabricates: an id without a stored seed draws its id-derived shape.

import { randomInt } from "node:crypto";
import { readSettings, writeSettings } from "@/lib/settings";
import { generateMark, hashId, normalizeFaceDetail, type AgentMark, type FaceDetail } from "@/lib/agentFaces";

/** Agent ids are UUIDs (agentsStore), CLI keys ("claude") or room/profile slugs. */
export const FACE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;

export function isFaceId(id: unknown): id is string {
  return typeof id === "string" && FACE_ID_RE.test(id);
}

export function readFaceDetail(): FaceDetail {
  return normalizeFaceDetail(readSettings().agents?.faces?.detail);
}

/** Only finite numbers count; null (a Reset) and junk read as "no override". */
export function readFaceSeeds(): Record<string, number> {
  const raw = readSettings().agents?.faces?.seeds ?? {};
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(raw)) {
    if (typeof v === "number" && Number.isFinite(v)) out[id] = Math.floor(v) >>> 0;
  }
  return out;
}

export function markFor(id: string): AgentMark {
  return generateMark(id, { seed: readFaceSeeds()[id] ?? null, detail: readFaceDetail() });
}

/** A fresh seed that differs from the current shape's seed, persisted. */
export function rerollFaceSeed(id: string): { seed: number; mark: AgentMark } {
  const current = readFaceSeeds()[id] ?? hashId(id);
  let seed = randomInt(0, 0xffffffff);
  while (seed === current) seed = randomInt(0, 0xffffffff);
  writeSettings({ agents: { faces: { seeds: { [id]: seed } } } });
  return { seed, mark: markFor(id) };
}

/** Back to the id-derived shape. */
export function resetFaceSeed(id: string): { seed: null; mark: AgentMark } {
  writeSettings({ agents: { faces: { seeds: { [id]: null } } } });
  return { seed: null, mark: markFor(id) };
}
