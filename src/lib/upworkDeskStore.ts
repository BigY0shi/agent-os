"use client";

import { create } from "zustand";
import type { Deal, DealStatus } from "@/lib/upworkDesk";

interface Column { key: DealStatus; label: string; accent: string }

interface DeskStore {
  deals: Deal[];
  columns: Column[];
  loading: boolean;
  error: string | null;
  fetchDeals: () => Promise<void>;
  move: (id: string, status: DealStatus) => Promise<void>;
  saveNotes: (id: string, notes: string) => Promise<void>;
  toggleNeedsInfo: (id: string) => Promise<void>;
  savePitch: (id: string, pitch: string) => Promise<void>;
  draftProposal: (id: string) => Promise<string | null>;
  ask: (id: string, question: string) => Promise<string | null>;
  cookie: { set: boolean; hint: string };
  enriching: boolean;
  enrichResult: string | null;
  fetchCookie: () => Promise<void>;
  saveCookie: (cookie: string) => Promise<boolean>;
  enrichApproved: () => Promise<void>;
  refilling: boolean;
  refillResult: string | null;
  refill: () => Promise<void>;
  pullingFeeds: boolean;
  feedsResult: string | null;
  pullFeeds: () => Promise<void>;
}

async function post(action: string, id: string, value?: unknown): Promise<void> {
  await fetch("/api/deals/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, action, value }),
  });
}

export const useDesk = create<DeskStore>((set, get) => ({
  deals: [],
  columns: [],
  loading: false,
  error: null,
  cookie: { set: false, hint: "" },
  enriching: false,
  enrichResult: null,
  refilling: false,
  refillResult: null,
  pullingFeeds: false,
  feedsResult: null,

  fetchDeals: async () => {
    set({ loading: true, error: null });
    try {
      const r = await fetch("/api/deals/list", { cache: "no-store" });
      const j = await r.json();
      if (j.ok) set({ deals: j.deals, columns: j.columns });
      else set({ error: j.error || "Failed to load deals" });
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ loading: false });
    }
  },

  move: async (id, status) => {
    set((s) => ({ deals: s.deals.map((d) => (d.id === id ? { ...d, status } : d)) }));
    await post("status", id, status);
  },

  saveNotes: async (id, notes) => {
    set((s) => ({ deals: s.deals.map((d) => (d.id === id ? { ...d, notes } : d)) }));
    await post("notes", id, notes);
  },

  toggleNeedsInfo: async (id) => {
    let next = false;
    set((s) => ({
      deals: s.deals.map((d) => {
        if (d.id !== id) return d;
        next = !d.needsInfo;
        return { ...d, needsInfo: next };
      }),
    }));
    await post("needsInfo", id, next);
  },

  savePitch: async (id, pitch) => {
    set((s) => ({ deals: s.deals.map((d) => (d.id === id ? { ...d, pitch, editedPitch: pitch } : d)) }));
    await post("editPitch", id, pitch);
  },

  draftProposal: async (id) => {
    try {
      const r = await fetch("/api/deals/proposal", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
      });
      const j = await r.json();
      if (j.ok && j.proposal) {
        set((s) => ({ deals: s.deals.map((d) => (d.id === id ? { ...d, pitch: j.proposal, editedPitch: j.proposal } : d)) }));
        return j.proposal as string;
      }
      return null;
    } catch {
      return null;
    }
  },

  ask: async (id, question) => {
    try {
      const r = await fetch("/api/deals/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, question }),
      });
      const j = await r.json();
      if (j.ok) { await get().fetchDeals(); return j.answer as string; }
      return null;
    } catch {
      return null;
    }
  },

  fetchCookie: async () => {
    try {
      const r = await fetch("/api/deals/cookie", { cache: "no-store" });
      const j = await r.json();
      set({ cookie: { set: !!j.set, hint: j.hint || "" } });
    } catch { /* ignore */ }
  },

  saveCookie: async (cookie) => {
    try {
      const r = await fetch("/api/deals/cookie", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cookie }),
      });
      const j = await r.json();
      if (j.ok) { set({ cookie: { set: !!j.set, hint: j.hint || "" } }); return true; }
      return false;
    } catch { return false; }
  },

  enrichApproved: async () => {
    set({ enriching: true, enrichResult: null });
    try {
      const r = await fetch("/api/deals/enrich", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      });
      const j = await r.json();
      if (j.ok) {
        set({ enrichResult: `Enriched ${j.enriched}/${j.attempted}${j.stopped ? ` — stopped on ${j.stopped}` : ""}` });
        await get().fetchDeals();
      } else {
        set({ enrichResult: j.error || "Enrichment failed" });
      }
    } catch (e) {
      set({ enrichResult: (e as Error).message });
    } finally {
      set({ enriching: false });
    }
  },

  refill: async () => {
    set({ refilling: true, refillResult: null });
    try {
      const r = await fetch("/api/deals/refill", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: 20 }),
      });
      const j = await r.json();
      if (j.ok) {
        set({ refillResult: `Cleared ${j.dismissed} passed · added ${j.pitched} to New (target ${j.target})${j.pitchError ? " · pitch error" : ""}` });
        await get().fetchDeals();
      } else {
        set({ refillResult: j.error || "Refill failed" });
      }
    } catch (e) {
      set({ refillResult: (e as Error).message });
    } finally {
      set({ refilling: false });
    }
  },

  pullFeeds: async () => {
    set({ pullingFeeds: true, feedsResult: null });
    try {
      const r = await fetch("/api/deals/feeds", { method: "POST" });
      const j = await r.json();
      if (j.ok) {
        const bs = j.bySource || {};
        set({ feedsResult: `Pulled ${j.relevant} remote leads (RemoteOK ${bs.remoteok || 0} · WWR ${bs.wwr || 0} · Reddit ${bs.reddit || 0})` });
        await get().fetchDeals();
      } else {
        set({ feedsResult: j.error || "Feed pull failed" });
      }
    } catch (e) {
      set({ feedsResult: (e as Error).message });
    } finally {
      set({ pullingFeeds: false });
    }
  },
}));
