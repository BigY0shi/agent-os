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

/** Mock runtime numbers — replaced by real telemetry when the bridge is wired. */
function seedRuntime(c: ClientAgentConfig, i: number): Agent {
  const baseDate = Date.now() - (1 + i) * 3600_000;
  const status: AgentStatus =
    c.kind === "remote-http"
      ? "idle"
      : i === 0 || i === 1
        ? "running"
        : i === 2
          ? "paused"
          : i === 3
            ? "idle"
            : i === 4
              ? "error"
              : "completed";
  return {
    ...c,
    cwd: c.cwd ?? undefined,
    gateway: c.gateway,
    hasAuth: c.hasAuth,
    status,
    tokensIn: 12_000 + i * 21_000,
    tokensOut: 3_000 + i * 5_500,
    costUsd: +(0.12 + i * 0.31).toFixed(2),
    lastActivity: new Date(baseDate).toISOString(),
    createdAt: new Date(baseDate - 86_400_000).toISOString(),
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
      const agents = cfg.agents.map((c, i) => seedRuntime(c, i));
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
