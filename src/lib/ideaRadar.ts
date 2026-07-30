// Idea Engine — Phase 2: the Trend Radar. Source adapters gather RawSignals
// (all keyless except Tavily, which reuses the outreach key), a cheap-tier
// clustering pass groups them into named candidates, and CODE — not a model —
// computes the candidate scores from signal metrics, so every score's inputs
// are stored (recipe invariant #3).
//
// A failed adapter degrades the scan (recorded in the scan report), it never
// blocks the others. Signals accumulate across scans with hash dedupe, so
// candidates gain evidence over time — Deal Desk's "leads accumulate" idiom.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { readSettings } from "./settings";
import { seatComplete, resolveKimiModel } from "./brainstorm";
import { cliComplete } from "./loopEngine";
import { IDEA_DIR } from "./ideaEngine";
import type { RawSignal, Score, TrendCandidate } from "./ideaEngineTypes";

const SIGNALS_FILE = path.join(IDEA_DIR, "signals.json");
const CANDIDATES_FILE = path.join(IDEA_DIR, "candidates.json");
const VENV_DIR = path.join(IDEA_DIR, "venv");

// ---- scan job state -------------------------------------------------------

export interface ScanJob {
  running: boolean;
  startedAt: number;
  finishedAt: number | null;
  /** adapter -> "ok: N signals" | "failed: reason" | "skipped: reason" */
  sources: Record<string, string>;
  newSignals: number;
  candidates: number;
  error: string | null;
}

const g = globalThis as unknown as { __ideaScan?: ScanJob };
const job: ScanJob = (g.__ideaScan ??= {
  running: false, startedAt: 0, finishedAt: null, sources: {}, newSignals: 0, candidates: 0, error: null,
});

export function scanStatus(): ScanJob { return { ...job }; }

// ---- persistence ----------------------------------------------------------

async function readJson<T>(p: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(p, "utf8")) as T; } catch { return fallback; }
}

export async function readSignals(): Promise<RawSignal[]> { return readJson<RawSignal[]>(SIGNALS_FILE, []); }
export async function readCandidates(): Promise<TrendCandidate[]> { return readJson<TrendCandidate[]>(CANDIDATES_FILE, []); }

export async function patchCandidate(id: string, patch: Partial<TrendCandidate>): Promise<TrendCandidate | null> {
  const all = await readCandidates();
  const c = all.find((x) => x.id === id);
  if (!c) return null;
  Object.assign(c, patch, { updatedAt: Date.now() });
  await writeFile(CANDIDATES_FILE, JSON.stringify(all, null, 1), "utf8");
  return c;
}

function sigId(source: string, term: string, url?: string): string {
  return createHash("sha1").update(`${source}|${term}|${url || ""}`).digest("hex").slice(0, 12);
}

// ---- adapters -------------------------------------------------------------

const UA = { "User-Agent": "AgentOS-IdeaEngine/1.0 (personal research tool)" };

async function fetchJson<T>(url: string, timeoutMs = 20_000): Promise<T> {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

const PAIN_PHRASES = ['"is there a tool"', '"why is there no"'];

// Reddit killed anonymous JSON in this network context (403 on www AND old,
// browser UA included — verified 2026-07-30). The RSS surface is still open but
// rate-limited: sequential fetches, 2s spacing, one 8s retry on 429.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchRss(url: string): Promise<string | null> {
  const ua = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" };
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(url, { headers: ua, signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (r?.ok) return r.text();
    if (r?.status === 429) { await sleep(8_000); continue; }
    return null;
  }
  return null;
}

function parseAtom(xml: string, painFlag: boolean): { title: string; link?: string; excerpt?: string; pain?: number }[] {
  const out: { title: string; link?: string; excerpt?: string; pain?: number }[] = [];
  for (const entry of xml.split("<entry>").slice(1)) {
    const title = (entry.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] || "").replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    const link = entry.match(/<link[^>]*href="([^"]+)"/)?.[1];
    const content = (entry.match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1] || "")
      .replace(/&lt;[^&]*&gt;|<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&quot;/g, "'").replace(/\s+/g, " ").trim();
    if (!title) continue;
    out.push({ title, link, excerpt: content.slice(0, 280) || undefined, ...(painFlag ? { pain: 1 } : {}) });
  }
  return out;
}

async function redditAdapter(subs: string[]): Promise<RawSignal[]> {
  const out: RawSignal[] = [];
  for (const sub of subs.slice(0, 6)) {
    // Top of the week: what the community itself upvoted (RSS carries no vote
    // counts — pain scoring leans on phrase-hit counts instead).
    const top = await fetchRss(`https://www.reddit.com/r/${encodeURIComponent(sub)}/top.rss?t=week&limit=15`);
    for (const e of top ? parseAtom(top, false) : []) {
      out.push({
        id: sigId("reddit", e.title, e.link), source: "reddit", term: e.title, url: e.link,
        metrics: { sub: sub as unknown as number }, excerpt: e.excerpt, capturedAt: Date.now(),
      });
    }
    await sleep(2_000);
    for (const phrase of PAIN_PHRASES) {
      const q = await fetchRss(`https://www.reddit.com/r/${encodeURIComponent(sub)}/search.rss?q=${encodeURIComponent(phrase)}&restrict_sr=1&t=month&limit=8`);
      for (const e of q ? parseAtom(q, true) : []) {
        out.push({
          id: sigId("reddit", e.title, e.link), source: "reddit", term: e.title, url: e.link,
          metrics: { pain: 1 }, excerpt: e.excerpt, capturedAt: Date.now(),
        });
      }
      await sleep(2_000);
    }
  }
  return out;
}

async function hnAdapter(seeds: string[]): Promise<RawSignal[]> {
  const out: RawSignal[] = [];
  interface HnHit { title?: string; url?: string; points?: number; num_comments?: number; objectID?: string }
  // Front-page-grade stories from the last week + seed searches.
  const queries = ["", ...seeds.slice(0, 4)];
  for (const q of queries) {
    const u = `https://hn.algolia.com/api/v1/search?tags=story&numericFilters=points>80,created_at_i>${Math.floor(Date.now() / 1000) - 7 * 86400}${q ? `&query=${encodeURIComponent(q)}` : ""}&hitsPerPage=12`;
    const j = await fetchJson<{ hits?: HnHit[] }>(u).catch(() => null);
    for (const h of j?.hits ?? []) {
      if (!h.title) continue;
      out.push({
        id: sigId("hn", h.title, h.objectID), source: "hn", term: h.title,
        url: h.objectID ? `https://news.ycombinator.com/item?id=${h.objectID}` : h.url,
        metrics: { points: h.points ?? 0, comments: h.num_comments ?? 0 },
        capturedAt: Date.now(),
      });
    }
  }
  return out;
}

async function autocompleteAdapter(seeds: string[]): Promise<RawSignal[]> {
  const out: RawSignal[] = [];
  const expansions = ["", " for", " software", " alternative", " problems"];
  for (const seed of seeds.slice(0, 5)) {
    for (const ext of expansions.slice(0, 3)) {
      const u = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(seed + ext)}`;
      const j = await fetchJson<[string, string[]]>(u).catch(() => null);
      for (const s of j?.[1] ?? []) {
        out.push({
          id: sigId("autocomplete", s), source: "autocomplete", term: s,
          metrics: { seed: seed as unknown as number }, capturedAt: Date.now(),
        });
      }
    }
  }
  return out;
}

async function productHuntAdapter(): Promise<RawSignal[]> {
  // RSS is the stable public surface; the GraphQL API needs a token (later).
  const r = await fetch("https://www.producthunt.com/feed", { headers: UA, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const xml = await r.text();
  const out: RawSignal[] = [];
  const items = xml.split("<entry>").slice(1, 21);
  for (const it of items) {
    const title = (it.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] || "").replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    const link = it.match(/<link[^>]*href="([^"]+)"/)?.[1];
    if (!title) continue;
    out.push({ id: sigId("producthunt", title, link), source: "producthunt", term: title, url: link, metrics: {}, capturedAt: Date.now() });
  }
  return out;
}

async function tavilyAdapter(seeds: string[]): Promise<RawSignal[]> {
  const cfgPath = path.join(os.homedir(), ".agentic-os", "outreach", "config.json");
  let key = process.env.TAVILY_API_KEY || "";
  if (!key) {
    try { key = (JSON.parse(await readFile(cfgPath, "utf8")) as { tavilyKey?: string }).tavilyKey || ""; } catch { /* no config */ }
  }
  if (!key) throw new Error("no Tavily key (outreach config or TAVILY_API_KEY)");
  const out: RawSignal[] = [];
  for (const seed of seeds.slice(0, 3)) {
    const r = await fetch("https://api.tavily.com/search", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: key, query: `${seed} trend 2026`, topic: "news", max_results: 6, days: 30 }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json() as { results?: { title?: string; url?: string; content?: string; score?: number }[] };
    for (const res of j.results ?? []) {
      if (!res.title) continue;
      out.push({
        id: sigId("tavily", res.title, res.url), source: "tavily", term: res.title, url: res.url,
        metrics: { relevance: res.score ?? 0 }, excerpt: (res.content || "").slice(0, 240) || undefined, capturedAt: Date.now(),
      });
    }
  }
  return out;
}

// ---- Google Trends via pytrends (own venv, auto-provisioned) --------------

function venvPython(): string {
  return process.platform === "win32" ? path.join(VENV_DIR, "Scripts", "python.exe") : path.join(VENV_DIR, "bin", "python3");
}

function sh(cmd: string, args: string[], timeoutMs: number): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { timeout: timeoutMs });
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("close", (code) => resolve({ ok: code === 0, out, err }));
    child.on("error", (e) => resolve({ ok: false, out: "", err: String(e) }));
  });
}

async function ensureVenv(): Promise<string> {
  const py = venvPython();
  if (existsSync(py)) return py;
  // One-time provision: own venv so we never contaminate the outreach env.
  await mkdir(IDEA_DIR, { recursive: true });
  const sys = process.platform === "win32" ? "python" : "python3";
  const mk = await sh(sys, ["-m", "venv", VENV_DIR], 120_000);
  if (!mk.ok) throw new Error(`venv create failed: ${(mk.err || mk.out).slice(-160)}`);
  const pip = await sh(py, ["-m", "pip", "install", "--quiet", "pytrends"], 240_000);
  if (!pip.ok) throw new Error(`pytrends install failed: ${(pip.err || pip.out).slice(-160)}`);
  return py;
}

async function gtrendsAdapter(seeds: string[]): Promise<RawSignal[]> {
  const py = await ensureVenv();
  const script = path.join(process.cwd(), "scripts", "idea-gtrends.py");
  const r = await sh(py, [script, ...seeds.slice(0, 6)], 240_000);
  if (!r.ok) throw new Error((r.err || r.out).slice(-200) || "gtrends script failed");
  const j = JSON.parse((r.out.match(/\{[\s\S]*\}/) || ["{}"])[0]) as {
    ok?: boolean; error?: string;
    terms?: Record<string, { growth_pct?: number; latest?: number; rising?: string[] }>;
  };
  if (!j.ok) throw new Error(j.error || "gtrends returned not-ok");
  const out: RawSignal[] = [];
  for (const [term, t] of Object.entries(j.terms ?? {})) {
    out.push({
      id: sigId("gtrends", term), source: "gtrends", term,
      url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(term)}`,
      metrics: { growth_pct: t.growth_pct ?? 0, latest: t.latest ?? 0 }, capturedAt: Date.now(),
    });
    for (const rq of t.rising ?? []) {
      out.push({
        id: sigId("gtrends", rq), source: "gtrends", term: rq,
        url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(rq)}`,
        metrics: { rising: 1, parent: term as unknown as number }, capturedAt: Date.now(),
      });
    }
  }
  return out;
}

// ---- clustering (cheap tier) + code-computed scores ----------------------

function clusterPrompt(signals: RawSignal[], existing: TrendCandidate[]): string {
  const sigLines = signals.map((s) => `${s.id} [${s.source}] ${s.term}${s.excerpt ? ` — ${s.excerpt.slice(0, 120)}` : ""}`).join("\n");
  const existingLines = existing.map((c) => `${c.id}: ${c.topic}`).join("\n") || "(none)";
  return (
    "You cluster raw market signals into business-opportunity candidates for a solo RevOps/automation " +
    "consultant. Group the signals below into 3-8 coherent OPPORTUNITY topics (not categories — each topic " +
    "should be a specific, buildable direction). Assign signals to existing candidates when they genuinely " +
    "fit; create new ones otherwise. Ignore noise signals that fit nothing.\n\n" +
    `EXISTING CANDIDATES:\n${existingLines}\n\nNEW SIGNALS:\n${sigLines.slice(0, 14000)}\n\n` +
    "Return ONLY minified JSON:\n" +
    '{"assign":[{"candidateId":"existing id","signalIds":["..."]}],' +
    '"create":[{"topic":"specific opportunity name","thesis":"1-2 sentences: the opportunity and who pays","signalIds":["..."]}]}'
  );
}

function computeScores(sigs: RawSignal[]): TrendCandidate["scores"] {
  const inputs = (pairs: [string, string | number][]) => pairs.map(([name, value]) => ({ name, value: String(value) }));
  const gtGrowth = Math.max(0, ...sigs.filter((s) => s.source === "gtrends").map((s) => Number(s.metrics.growth_pct) || 0));
  const hnPts = sigs.filter((s) => s.source === "hn").reduce((a, s) => a + (Number(s.metrics.points) || 0), 0);
  const news = sigs.filter((s) => s.source === "tavily").length;
  const painSigs = sigs.filter((s) => s.source === "reddit" && s.metrics.pain);
  // RSS carries no vote counts — volume of community discussion is the proxy.
  const redditCount = sigs.filter((s) => s.source === "reddit").length;
  const phShips = sigs.filter((s) => s.source === "producthunt").length;
  const clamp = (n: number) => Math.max(1, Math.min(10, Math.round(n)));

  const momentum: Score = {
    value: clamp(1 + (gtGrowth > 0 ? Math.min(4, gtGrowth / 15) : 0) + Math.min(3, hnPts / 250) + Math.min(2, news)),
    scale: [1, 10],
    inputs: inputs([["gtrends_max_growth_pct", gtGrowth], ["hn_points_sum", hnPts], ["news_hits_30d", news]]),
    method: "computed: growth/15 (cap4) + hnPts/250 (cap3) + newsHits (cap2) + 1",
  };
  const pain: Score = {
    value: clamp(1 + Math.min(5, painSigs.length * 1.5) + Math.min(4, redditCount / 3)),
    scale: [1, 10],
    inputs: inputs([["pain_phrase_hits", painSigs.length], ["reddit_signal_count", redditCount]]),
    method: "computed: painHits*1.5 (cap5) + redditSignals/3 (cap4) + 1",
  };
  const builders: Score = {
    value: clamp(1 + Math.min(5, phShips * 1.2) + Math.min(4, sigs.filter((s) => s.source === "hn").length)),
    scale: [1, 10],
    inputs: inputs([["producthunt_ships", phShips], ["hn_stories", sigs.filter((s) => s.source === "hn").length]]),
    method: "computed: phShips*1.2 (cap5) + hnStories (cap4) + 1",
  };
  return { momentum, pain, builders };
}

// ---- the scan -------------------------------------------------------------

export async function startScan(): Promise<{ started: boolean; reason?: string }> {
  if (job.running) return { started: false, reason: "already running" };
  Object.assign(job, { running: true, startedAt: Date.now(), finishedAt: null, sources: {}, newSignals: 0, error: null });

  void (async () => {
    try {
      const s = readSettings().ideaEngine;
      const subs = (s.redditSubs || "").split(",").map((x) => x.trim()).filter(Boolean);
      const seeds = (s.seedTerms || "").split(",").map((x) => x.trim()).filter(Boolean);

      const adapters: [string, () => Promise<RawSignal[]>][] = [
        ["reddit", () => redditAdapter(subs)],
        ["hn", () => hnAdapter(seeds)],
        ["autocomplete", () => autocompleteAdapter(seeds)],
        ["producthunt", () => productHuntAdapter()],
        ["tavily", () => tavilyAdapter(seeds)],
        ["gtrends", () => gtrendsAdapter(seeds)],
      ];

      const gathered: RawSignal[] = [];
      await Promise.all(adapters.map(async ([name, fn]) => {
        try {
          const sigs = await fn();
          gathered.push(...sigs);
          job.sources[name] = `ok: ${sigs.length} signals`;
        } catch (e) {
          job.sources[name] = `failed: ${String((e as Error)?.message || e).slice(0, 120)}`;
        }
      }));

      // Dedupe against history, persist.
      const known = await readSignals();
      const knownIds = new Set(known.map((x) => x.id));
      const fresh = gathered.filter((x) => !knownIds.has(x.id));
      job.newSignals = fresh.length;
      const allSignals = [...known, ...fresh].slice(-3000);
      await mkdir(IDEA_DIR, { recursive: true });
      await writeFile(SIGNALS_FILE, JSON.stringify(allSignals, null, 1), "utf8");

      // Cluster the fresh signals (cheap tier: kimi, codex fallback).
      const candidates = await readCandidates();
      if (fresh.length >= 5) {
        const prompt = clusterPrompt(fresh, candidates);
        let raw: string;
        try {
          const km = await resolveKimiModel(s.kimiModel);
          raw = await seatComplete("kimi", prompt, km);
        } catch {
          raw = await cliComplete("codex", prompt, { timeoutMs: 240_000 });
        }
        interface ClusterOut { assign?: { candidateId?: string; signalIds?: string[] }[]; create?: { topic?: string; thesis?: string; signalIds?: string[] }[] }
        let plan: ClusterOut = {};
        try { plan = JSON.parse((raw.match(/\{[\s\S]*\}/) || ["{}"])[0]) as ClusterOut; }
        catch { job.sources.cluster = "failed: unparseable clustering output"; }

        const byId = new Map(allSignals.map((x) => [x.id, x]));
        for (const a of plan.assign ?? []) {
          const c = candidates.find((x) => x.id === a.candidateId);
          if (!c || !Array.isArray(a.signalIds)) continue;
          c.signalIds = [...new Set([...c.signalIds, ...a.signalIds.filter((i) => byId.has(i))])];
          c.scores = computeScores(c.signalIds.map((i) => byId.get(i)!).filter(Boolean));
          c.updatedAt = Date.now();
        }
        for (const n of plan.create ?? []) {
          if (!n.topic || !Array.isArray(n.signalIds) || !n.signalIds.length) continue;
          const sigs = n.signalIds.filter((i) => byId.has(i));
          if (!sigs.length) continue;
          candidates.push({
            id: randomUUID().slice(0, 10), topic: n.topic.slice(0, 120), thesis: (n.thesis || "").slice(0, 400),
            status: "new", signalIds: sigs,
            scores: computeScores(sigs.map((i) => byId.get(i)!)),
            firstSeen: Date.now(), updatedAt: Date.now(),
          });
        }
        await writeFile(CANDIDATES_FILE, JSON.stringify(candidates, null, 1), "utf8");
      }
      job.candidates = candidates.length;
    } catch (e) {
      job.error = String((e as Error)?.message || e);
    } finally {
      job.running = false;
      job.finishedAt = Date.now();
    }
  })();

  return { started: true };
}
