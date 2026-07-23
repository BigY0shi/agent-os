"use client";

import { create } from "zustand";
import { seedKanban, seedTimeline } from "./mock-data";
import type {
  Agent,
  AgentStatus,
  KanbanCard,
  KanbanColumnId,
  TimelineEvent,
} from "./types";

interface FleetState {
  agents: Agent[];
  agentsLoaded: boolean;
  /** Where the agent definitions came from on disk (for the UI badge). */
  configSources: string[];
  /** Operator's display name from config. */
  operatorName: string;
  vaultPath: string;
  events: TimelineEvent[];
  cards: KanbanCard[];
  setStatus: (id: string, status: AgentStatus) => void;
  pushEvent: (e: TimelineEvent) => void;
  moveCard: (id: string, to: KanbanColumnId) => void;
  addCard: (c: KanbanCard) => void;
  hydrateFromConfig: () => Promise<void>;
}

interface ClientAgentConfig {
  id: string;
  name: string;
  role: string;
  tagline?: string;
  kind: Agent["kind"];
  model: string;
  glyph: Agent["glyph"];
  accent: Agent["accent"];
  cwd: string | null;
  gateway: string | null;
  hasAuth: boolean;
}

/**
 * Honest runtime values. There is no live telemetry bridge yet, so we do NOT
 * fabricate status/tokens/cost (the old version assigned them by array index —
 * agent #4 was always "error", costs were a formula). Every configured agent is
 * shown as idle with zeroed usage until a real /api/fleet/runtime feed exists.
 * Auth state is surfaced separately via `hasAuth`.
 */
function seedRuntime(c: ClientAgentConfig): Agent {
  const now = new Date().toISOString();
  return {
    ...c,
    cwd: c.cwd ?? undefined,
    gateway: c.gateway,
    hasAuth: c.hasAuth,
    status: "idle" as AgentStatus,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastActivity: now,
    createdAt: now,
  };
}

export const useFleet = create<FleetState>((set, get) => ({
  agents: [],
  agentsLoaded: false,
  configSources: [],
  operatorName: "Operator",
  vaultPath: "",
  events: seedTimeline,
  cards: seedKanban,
  setStatus: (id, status) =>
    set((s) => ({
      agents: s.agents.map((a) =>
        a.id === id ? { ...a, status, lastActivity: new Date().toISOString() } : a,
      ),
    })),
  pushEvent: (e) => set((s) => ({ events: [e, ...s.events].slice(0, 200) })),
  moveCard: (id, to) =>
    set((s) => ({
      cards: s.cards.map((c) => (c.id === id ? { ...c, column: to } : c)),
    })),
  addCard: (c) => set((s) => ({ cards: [c, ...s.cards] })),
  hydrateFromConfig: async () => {
    if (get().agentsLoaded) return;
    try {
      const res = await fetch("/api/config", { cache: "no-store" });
      const j = await res.json();
      if (!j.ok || !j.config) {
        set({ agentsLoaded: true });
        return;
      }
      const cfg = j.config as {
        operator: { name: string };
        vault: { dir: string };
        agents: ClientAgentConfig[];
        meta: { sources: string[] };
      };
      const agents = cfg.agents.map((c) => seedRuntime(c));
      set({
        agents,
        agentsLoaded: true,
        configSources: cfg.meta.sources,
        operatorName: cfg.operator.name,
        vaultPath: cfg.vault.dir,
      });
    } catch {
      set({ agentsLoaded: true });
    }
  },
}));
