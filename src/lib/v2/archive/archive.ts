// S24 Crew archive (_design/jarvis-v3-plan.md; NEXORA "Crew archive"): one searchable
// wall of everything the agents produced, read IN PLACE from the stores that already
// hold it. Nothing is copied; the archive is an index built at read time (cached 30 s).
//   mission / mission-step  ~/.agentic-os/missions/<id>/  (reports, each seat's answer)
//   oracle                  lib/oracle.readConsultations
//   news                    ~/.agentic-os/news/log.json   (the News Radar briefings)
//   deal / hire             lib/upworkDesk.listDeals, lib/hireDesk.listHireLeads (pitches)
//   jarvis                  lib/v2/jarvis/conversations (whole conversations)
//   brainstorm              lib/brainstorm.listSessions (council briefs)
// Each source is fenced: one that cannot be read lands in `errors`, the rest still show.

import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type ArchiveSource = "mission" | "mission-step" | "oracle" | "news" | "deal" | "hire" | "jarvis" | "brainstorm";
export const SOURCE_LABEL: Record<ArchiveSource, string> = {
  mission: "Mission report", "mission-step": "Mission step", oracle: "Oracle", news: "News Radar",
  deal: "Deal Desk pitch", hire: "Hire Engine pitch", jarvis: "Jarvis conversation", brainstorm: "Brainstorm brief",
};
export interface ArchiveDoc { id: string; source: ArchiveSource; title: string; author: string; words: number; at: number | null; href: string | null; preview: string }
interface Full extends ArchiveDoc { body: string; meta: Record<string, string> }

const words = (s: string) => (s.match(/\S+/g) ?? []).length;
const toMs = (v: unknown): number | null => (typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) || null : null);
const doc = (d: Omit<Full, "words" | "preview">): Full => ({ ...d, words: words(d.body), preview: d.body.replace(/\s+/g, " ").trim().slice(0, 220) });

type Reader = () => Promise<Full[]>;

const READERS: Record<string, Reader> = {
  async missions() {
    const { listMissions } = await import("@/lib/v2/missions/store");
    const { readStepOutput } = await import("@/lib/v2/missions/store");
    const out: Full[] = [];
    for (const m of listMissions()) {
      if (m.result) out.push(doc({ id: `mission:${m.id}`, source: "mission", title: `${m.name}: report`, author: "Jarvis", at: m.finishedAt ?? m.createdAt, href: "/jarvis?tab=goals", body: m.result, meta: { Mission: m.name, Stage: m.stage } }));
      for (const s of m.plan?.steps ?? []) {
        if (s.status !== "done") continue;
        const body = readStepOutput(m.id, s.id, "md");
        if (!body.trim()) continue;
        const seat = m.seats.find((x) => x.id === s.seatId);
        out.push(doc({ id: `mission-step:${m.id}:${s.id}`, source: "mission-step", title: `${m.name}: ${s.title}`, author: seat ? `${seat.agent}${seat.model ? ` (${seat.model})` : ""}` : "unknown seat", at: s.finishedAt ?? null, href: "/jarvis?tab=goals", body, meta: { Mission: m.name, Step: s.title } }));
      }
    }
    return out;
  },
  async oracle() {
    const { readConsultations } = await import("@/lib/oracle");
    return (await readConsultations()).map((c) => doc({ id: `oracle:${c.at}`, source: "oracle", title: c.question.slice(0, 140), author: `Oracle (${c.agent})`, at: toMs(c.at), href: "/jarvis?tab=oracle", body: c.answer ?? "", meta: { Question: c.question, Agent: c.agent } }));
  },
  async news() {
    const file = path.join(os.homedir(), ".agentic-os", "news", "log.json");
    if (!existsSync(file)) return [];
    const j = JSON.parse(readFileSync(file, "utf8")) as { items?: { at: string; topic: string; overview?: string; merger?: string; items?: { headline?: string; summary?: string; url?: string; source?: string }[] }[] };
    return (j.items ?? []).map((b) => {
      const body = [b.overview ?? "", ...(b.items ?? []).map((i) => `- ${i.headline ?? ""}${i.summary ? `: ${i.summary}` : ""}${i.url ? ` (${i.url})` : ""}`)].join("\n").trim();
      return doc({ id: `news:${b.at}`, source: "news", title: b.topic, author: `News Radar${b.merger ? ` (${b.merger})` : ""}`, at: toMs(b.at), href: "/jarvis?tab=radar", body, meta: { Topic: b.topic, Items: String(b.items?.length ?? 0) } });
    });
  },
  async deals() {
    const { listDeals } = await import("@/lib/upworkDesk");
    return (await listDeals()).filter((d) => d.pitch && d.pitch.trim()).map((d) => doc({ id: `deal:${d.id}`, source: "deal", title: d.title, author: "Deal Desk", at: d.updatedAt ?? d.postedAt, href: "/deals", body: d.pitch!, meta: { Listing: d.url, Status: String(d.status) } }));
  },
  async hire() {
    const { listHireLeads } = await import("@/lib/hireDesk");
    return (await listHireLeads()).filter((l) => l.pitch && l.pitch.trim()).map((l) => doc({ id: `hire:${l.id}`, source: "hire", title: `${l.title}${l.company ? ` · ${l.company}` : ""}`, author: "Hire Engine", at: l.updatedAt ?? null, href: "/hire", body: l.pitch!, meta: { Company: l.company ?? "", Listing: l.url } }));
  },
  async jarvis() {
    const { ensureV2 } = await import("@/lib/v2/boot");
    ensureV2();
    const c = await import("@/lib/v2/jarvis/conversations");
    const out: Full[] = [];
    for (const conv of c.listConversations(200, { includeArchived: true })) {
      if (!conv.messageCount) continue;
      const body = c.listMessages(conv.id, 500).filter((m) => m.role !== "system").map((m) => `${m.role === "user" ? "You" : "Jarvis"}: ${m.content}`).join("\n\n");
      if (!body.trim()) continue;
      out.push(doc({ id: `jarvis:${conv.id}`, source: "jarvis", title: conv.title || "Untitled conversation", author: "Jarvis", at: toMs(conv.updatedAt), href: `/jarvis?c=${encodeURIComponent(conv.id)}`, body, meta: { Messages: String(conv.messageCount), Channel: String(conv.channel ?? "") } }));
    }
    return out;
  },
  async brainstorm() {
    const { listSessions } = await import("@/lib/brainstorm");
    return (await listSessions()).filter((s) => s.brief && String(s.brief).trim()).map((s) => doc({ id: `brainstorm:${s.id}`, source: "brainstorm", title: s.topic, author: "Brainstorm council", at: s.updatedAt ?? s.createdAt ?? null, href: "/brainstorm", body: String(s.brief), meta: { Topic: s.topic } }));
  },
};

let cache: { at: number; docs: Full[]; errors: Record<string, string> } | null = null;

async function all(fresh = false): Promise<{ docs: Full[]; errors: Record<string, string> }> {
  if (!fresh && cache && Date.now() - cache.at < 30_000) return cache;
  const errors: Record<string, string> = {};
  const parts = await Promise.all(Object.entries(READERS).map(async ([k, r]) => {
    try { return await r(); } catch (e) { errors[k] = String((e as Error)?.message ?? e).slice(0, 300); return []; }
  }));
  const docs = parts.flat().sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  cache = { at: Date.now(), docs, errors };
  return cache;
}

export async function listArchive(opts: { q?: string; source?: string; fresh?: boolean } = {}): Promise<{ docs: ArchiveDoc[]; total: number; bySource: Record<string, number>; errors: Record<string, string> }> {
  const { docs, errors } = await all(opts.fresh);
  const bySource: Record<string, number> = {};
  for (const d of docs) bySource[d.source] = (bySource[d.source] ?? 0) + 1;
  const q = (opts.q ?? "").trim().toLowerCase();
  const hits = docs.filter((d) => (!opts.source || d.source === opts.source) && (!q || d.title.toLowerCase().includes(q) || d.author.toLowerCase().includes(q) || d.body.toLowerCase().includes(q)));
  return { docs: hits.map(({ body: _b, meta: _m, ...rest }) => rest), total: docs.length, bySource, errors }; // eslint-disable-line @typescript-eslint/no-unused-vars
}

export async function readArchiveDoc(id: string): Promise<(ArchiveDoc & { body: string; meta: Record<string, string> }) | null> {
  const { docs } = await all();
  return docs.find((d) => d.id === id) ?? (await all(true)).docs.find((d) => d.id === id) ?? null;
}

export function __resetArchiveCacheForTests(): void { cache = null; }
