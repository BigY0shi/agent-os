"use client";

// S35 Agent faces: one shared client cache of the stored seeds and the detail setting,
// so a page with forty avatars makes one request, not forty. Any component that draws a
// generated mark subscribes through useAgentFaces(); "New shape" / "Reset" update the
// cache from the server's answer so every avatar for that id redraws at once.
//
// Until the first answer arrives the cache is empty, so a mark draws from its id-derived
// seed and then switches to the stored one. That is the honest intermediate state (the
// id-derived shape is a real shape), not a letter or a blank.

import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_FACE_DETAIL, normalizeFaceDetail, type AgentMark, type FaceDetail } from "./agentFaces";

export interface AgentFacesSnapshot {
  loaded: boolean;
  detail: FaceDetail;
  seeds: Record<string, number>;
  error: string | null;
}

const INITIAL: AgentFacesSnapshot = { loaded: false, detail: DEFAULT_FACE_DETAIL, seeds: {}, error: null };
let snap: AgentFacesSnapshot = INITIAL;
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function set(next: Partial<AgentFacesSnapshot>) {
  snap = { ...snap, ...next };
  for (const l of listeners) l();
}

export function refreshAgentFaces(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const r = await fetch("/api/v2/agent-faces", { cache: "no-store" });
      const j = await r.json().catch(() => ({})) as { ok?: boolean; detail?: unknown; seeds?: Record<string, unknown>; error?: string };
      if (!r.ok || !j.ok) throw new Error(j.error ?? `request failed (${r.status})`);
      const seeds: Record<string, number> = {};
      for (const [id, v] of Object.entries(j.seeds ?? {})) if (typeof v === "number" && Number.isFinite(v)) seeds[id] = v;
      set({ loaded: true, detail: normalizeFaceDetail(j.detail), seeds, error: null });
    } catch (e) {
      set({ loaded: true, error: e instanceof Error ? e.message : String(e) });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (!snap.loaded && !inflight) void refreshAgentFaces();
  return () => { listeners.delete(l); };
}
const getSnapshot = () => snap;
const getServerSnapshot = () => INITIAL;

async function post(id: string, action: "reroll" | "reset"): Promise<AgentMark> {
  const r = await fetch("/api/v2/agent-faces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action }) });
  const j = await r.json().catch(() => ({})) as { ok?: boolean; seed?: number | null; mark?: AgentMark; error?: string };
  if (!r.ok || !j.ok || !j.mark) throw new Error(j.error ?? `request failed (${r.status})`);
  const seeds = { ...snap.seeds };
  if (typeof j.seed === "number") seeds[id] = j.seed; else delete seeds[id];
  set({ seeds, error: null });
  return j.mark;
}

export function useAgentFaces() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const reroll = useCallback((id: string) => post(id, "reroll"), []);
  const reset = useCallback((id: string) => post(id, "reset"), []);
  return { ...s, reroll, reset, refresh: refreshAgentFaces };
}
