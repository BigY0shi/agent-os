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
  /** Fill summary/why/approach/crashCourse for a lead that has none (feed leads never get pitched offline). */
  generateBrief: (id: string) => Promise<boolean>;
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
  scraping: boolean;
  scrapeResult: string | null;
  startScrape: () => Promise<void>;
  pollScrape: () => Promise<void>;
  briefingBatch: boolean;
  briefBatchResult: string | null;
  briefTop: () => Promise<void>;
  pollBriefs: () => Promise<void>;
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
  scraping: false,
  scrapeResult: null,
  briefingBatch: false,
  briefBatchResult: null,
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

  generateBrief: async (id) => {
    try {
      const r = await fetch("/api/deals/brief", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
      });
      const j = await r.json();
      // Refetch rather than patching locally: the server merges the brief with the
      // pitch pass, and that precedence is its call to make, not the client's.
      if (j.ok) { await get().fetchDeals(); return true; }
      return false;
    } catch {
      return false;
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
        // Refill now also tops up the feed side by briefing unanalysed leads. That runs
        // server-side for ~a minute after this response, so follow it.
        if (j.briefing) { set({ briefingBatch: true, briefBatchResult: `Analysing ${j.briefing} feed leads…` }); get().pollBriefs(); }
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

  // Upwork re-scrape. Unlike the other actions this is a long job (10–20 min of real
  // browser work), so POST only starts it and we poll GET until it settles.
  startScrape: async () => {
    set({ scrapeResult: null });
    try {
      const r = await fetch("/api/deals/scrape", { method: "POST" });
      const j = await r.json();
      if (!j.ok) { set({ scrapeResult: j.error || "Could not start the scrape" }); return; }
      set({ scraping: true, scrapeResult: "Scraping Upwork… this takes 10–20 minutes." });
      get().pollScrape();
    } catch (e) {
      set({ scrapeResult: (e as Error).message });
    }
  },

  pollScrape: async () => {
    // Self-rescheduling rather than setInterval: one request in flight at a time, and
    // it stops itself the moment the job settles.
    const tick = async () => {
      try {
        const r = await fetch("/api/deals/scrape", { cache: "no-store" });
        const j = await r.json();
        if (j.running) {
          set({ scraping: true, scrapeResult: `${j.stage === "scoring" ? "Scoring" : "Scraping"}… ${j.scraped} jobs captured (${Math.round(j.elapsedMs / 60000)}m)` });
          setTimeout(tick, 5000);
          return;
        }
        // "idle" means no scrape has run this server lifetime — that is the normal
        // state on a page load, so say nothing rather than reporting a phantom failure.
        if (j.stage === "idle") { set({ scraping: false }); return; }
        set({
          scraping: false,
          scrapeResult: j.stage === "done"
            ? `Board rebuilt from ${j.scraped} freshly scraped jobs.`
            : j.error || "Scrape stopped unexpectedly.",
        });
        if (j.stage === "done") await get().fetchDeals();
      } catch {
        set({ scraping: false, scrapeResult: "Lost contact with the scrape job." });
      }
    };
    tick();
  },

  briefTop: async () => {
    try {
      const r = await fetch("/api/deals/brief-batch", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      });
      const j = await r.json();
      if (!j.ok) { set({ briefBatchResult: j.error || "Could not start the brief pass" }); return; }
      if (!j.started) { set({ briefBatchResult: "Every lead already has a brief." }); return; }
      set({ briefingBatch: true, briefBatchResult: `Analysing ${j.total} leads…` });
      get().pollBriefs();
    } catch (e) {
      set({ briefBatchResult: (e as Error).message });
    }
  },

  pollBriefs: async () => {
    const tick = async () => {
      try {
        const j = await (await fetch("/api/deals/brief-batch", { cache: "no-store" })).json();
        if (j.running) {
          set({ briefingBatch: true, briefBatchResult: `Analysing leads… ${j.done}/${j.total}` });
          setTimeout(tick, 4000);
          return;
        }
        // Never ran this server lifetime — stay quiet rather than report a phantom result.
        if (!j.total) { set({ briefingBatch: false }); return; }
        set({
          briefingBatch: false,
          briefBatchResult: `Analysed ${j.succeeded} of ${j.total} leads${j.failed ? ` · ${j.failed} failed` : ""}.`,
        });
        await get().fetchDeals();
      } catch {
        set({ briefingBatch: false });
      }
    };
    tick();
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
        // The pull now kicks off a brief pass server-side; follow it so the cards
        // visibly fill in rather than appearing blank and silently changing later.
        if (j.briefing) { set({ briefingBatch: true, briefBatchResult: `Analysing ${j.briefing} new leads…` }); get().pollBriefs(); }
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
