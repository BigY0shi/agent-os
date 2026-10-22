"use client";

// S24 Crew archive (_design/jarvis-v3-plan.md; NEXORA "Crew archive"): one searchable,
// filterable wall of everything the agents produced, each card with its source, author,
// word count and date, and a reader with the document's metadata. Read-only; every
// document is read in place from the store that holds it.

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search, Loader2, X, ExternalLink, RefreshCw } from "lucide-react";

type Source = "mission" | "mission-step" | "oracle" | "news" | "deal" | "hire" | "jarvis" | "brainstorm";
interface Doc { id: string; source: Source; title: string; author: string; words: number; at: number | null; href: string | null; preview: string }
interface Listing { docs: Doc[]; total: number; bySource: Record<string, number>; errors: Record<string, string> }
const LABEL: Record<Source, string> = {
  mission: "Mission reports", "mission-step": "Mission steps", oracle: "Oracle", news: "News Radar",
  deal: "Deal Desk pitches", hire: "Hire Engine pitches", jarvis: "Jarvis conversations", brainstorm: "Brainstorm briefs",
};
const TINT: Record<Source, string> = { mission: "#3b95ff", "mission-step": "#6d63f5", oracle: "#e9ecf4", news: "#f2b441", deal: "#34d399", hire: "#22d3ee", jarvis: "#8b5cf6", brainstorm: "#f472b6" };
const date = (t: number | null) => (t ? new Date(t).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "undated");

export default function ArchiveTab() {
  const [data, setData] = useState<Listing | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [source, setSource] = useState<Source | "">("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<(Doc & { body: string; meta: Record<string, string> }) | null>(null);
  const [reading, setReading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (fresh = false) => {
    setBusy(true);
    try {
      const qs = new URLSearchParams({ ...(q.trim() ? { q: q.trim() } : {}), ...(source ? { source } : {}), ...(fresh ? { fresh: "1" } : {}) });
      const r = await fetch(`/api/v2/archive?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `failed (${r.status})`);
      setData(j); setErr(null);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }, [q, source]);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(), 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [load]);

  const read = async (d: Doc) => {
    setReading(true);
    try {
      const r = await fetch(`/api/v2/archive?id=${encodeURIComponent(d.id)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `failed (${r.status})`);
      setOpen(j.doc);
    } catch (e) { setErr((e as Error).message); } finally { setReading(false); }
  };

  const sources = Object.keys(LABEL) as Source[];
  return (
    <div className="space-y-4" data-archive-tab>
      <section className="glass-strong px-6 py-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="glass-eyebrow">Crew archive</div>
            <h2 className="type-display mt-1 text-[26px] leading-tight">{data ? `${data.total} document${data.total === 1 ? "" : "s"} the crew produced` : "Reading every store…"}</h2>
            <p className="mt-1 text-[12.5px] text-[var(--fg-dim)]">Read where they live: nothing here is a copy.</p>
          </div>
          <button type="button" onClick={() => void load(true)} disabled={busy} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] glass disabled:opacity-50">{busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Re-read</button>
        </div>
        <label className="mt-4 flex items-center gap-2 rounded-xl px-3 py-2 glass-inset">
          <Search size={14} className="text-[var(--fg-dimmer)]" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles, authors and the text itself" aria-label="Search the archive" className="w-full bg-transparent text-[13px] outline-none placeholder:text-[var(--fg-dimmer)]" />
        </label>
        <div role="group" aria-label="Filter by source" className="mt-3 flex flex-wrap gap-1.5">
          <button type="button" aria-pressed={source === ""} onClick={() => setSource("")} className={`rounded-lg px-2.5 py-1 text-[11.5px] ${source === "" ? "glass neon-ring" : "glass-inset text-[var(--fg-dim)]"}`}>All <span className="opacity-60">{data?.total ?? ""}</span></button>
          {sources.filter((s) => data?.bySource[s]).map((s) => (
            <button key={s} type="button" aria-pressed={source === s} onClick={() => setSource(s)} className={`rounded-lg px-2.5 py-1 text-[11.5px] ${source === s ? "glass neon-ring" : "glass-inset text-[var(--fg-dim)]"}`}>
              <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: TINT[s] }} />{LABEL[s]} <span className="opacity-60">{data?.bySource[s]}</span>
            </button>
          ))}
        </div>
        {data && Object.keys(data.errors).length > 0 && <p className="mt-2 text-[11.5px] text-amber-300">Could not read: {Object.entries(data.errors).map(([k, v]) => `${k} (${v})`).join("; ")}</p>}
      </section>
      {err && <p role="alert" className="text-[13px] text-red-300">{err}</p>}

      <div className={`grid gap-3 ${open ? "xl:grid-cols-[1fr_480px]" : ""}`}>
        <div className="grid grid-cols-1 content-start gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {data && data.docs.length === 0 && <p className="text-[13px] text-[var(--fg-dimmer)]">{q || source ? "Nothing matches." : "Nothing produced yet."}</p>}
          {(data?.docs ?? []).slice(0, 300).map((d) => (
            <button key={d.id} type="button" onClick={() => void read(d)} aria-pressed={open?.id === d.id} className={`rounded-2xl px-4 py-3 text-left glass ${open?.id === d.id ? "neon-ring" : ""}`}>
              <div className="flex items-center gap-1.5 text-[10.5px] text-[var(--fg-dimmer)]"><span className="h-2 w-2 rounded-full" style={{ background: TINT[d.source] }} />{LABEL[d.source]}</div>
              <div className="mt-1 line-clamp-2 text-[13.5px]">{d.title}</div>
              <p className="mt-1 line-clamp-3 text-[11.5px] text-[var(--fg-dim)]">{d.preview}</p>
              <div className="mt-2 flex justify-between text-[10.5px] text-[var(--fg-dimmer)]"><span className="truncate">{d.author}</span><span className="shrink-0">{d.words.toLocaleString()} words · {date(d.at)}</span></div>
            </button>
          ))}
          {data && data.docs.length > 300 && <p className="text-[11.5px] text-[var(--fg-dimmer)]">Showing the newest 300 of {data.docs.length}; search to narrow it.</p>}
        </div>

        {(open || reading) && (
          <aside className="glass-strong sticky top-4 flex max-h-[80vh] flex-col self-start px-5 py-4" aria-label="Reader">
            {reading && !open && <Loader2 size={16} className="animate-spin" />}
            {open && (<>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10.5px] text-[var(--fg-dimmer)]">{LABEL[open.source]}</div>
                  <h3 className="type-display mt-0.5 text-[18px] leading-snug">{open.title}</h3>
                </div>
                <button type="button" aria-label="Close" onClick={() => setOpen(null)} className="rounded-lg p-1.5 hover:bg-white/5"><X size={15} /></button>
              </div>
              <dl className="mt-3 grid grid-cols-[88px_1fr] gap-y-1 text-[11.5px]">
                <dt className="text-[var(--fg-dimmer)]">Author</dt><dd>{open.author}</dd>
                <dt className="text-[var(--fg-dimmer)]">Date</dt><dd>{open.at ? new Date(open.at).toLocaleString() : "undated"}</dd>
                <dt className="text-[var(--fg-dimmer)]">Words</dt><dd>{open.words.toLocaleString()}</dd>
                {Object.entries(open.meta).filter(([, v]) => v).map(([k, v]) => <Fragment key={k}><dt className="text-[var(--fg-dimmer)]">{k}</dt><dd className="truncate" title={v}>{v}</dd></Fragment>)}
              </dl>
              {open.href && <Link href={open.href} className="mt-2 inline-flex items-center gap-1 text-[11.5px] text-[#3b95ff] hover:underline"><ExternalLink size={11} /> Open where it lives</Link>}
              <pre className="mt-3 flex-1 overflow-auto whitespace-pre-wrap rounded-xl p-3 text-[12.5px] leading-relaxed glass-inset">{open.body}</pre>
            </>)}
          </aside>
        )}
      </div>
    </div>
  );
}
