"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CheckCircle2, RefreshCw, ExternalLink, HelpCircle, Sparkles, X, AlertTriangle, Loader2, Settings, Zap, ListRestart, Rss, Download,
} from "lucide-react";
import { useDesk } from "@/lib/upworkDeskStore";
import type { Deal, DealStatus } from "@/lib/upworkDesk";

const fmtMoney = (n: number | null) => (n == null ? "?" : n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`);
const scoreColor = (n: number) =>
  n >= 8 ? "#86efac" : n >= 6 ? "#fbbf24" : n >= 4 ? "#fb923c" : "#f87171";

// Lead source → tab styling. Upwork leads carry no `source`, so they default to "upwork".
const SOURCE_META: Record<string, { label: string; color: string }> = {
  upwork: { label: "Upwork", color: "#34d399" },
  remoteok: { label: "RemoteOK", color: "#60a5fa" },
  wwr: { label: "WWR", color: "#c084fc" },
};
const srcKey = (d: Deal) => (d.source ? d.source.toLowerCase() : "upwork");
const srcLabel = (k: string) => SOURCE_META[k]?.label ?? k;

/** "3h ago" / "12d ago" — derived from an absolute instant, never from a stored phrase. */
function agoLabel(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); if (d < 7) return `${d}d ago`;
  const w = Math.round(d / 7); if (d < 60) return `${w}w ago`;
  return `${Math.round(d / 30)}mo ago`;
}

/**
 * Live "posted" label. The old card printed deal.posted verbatim, which for Upwork is a
 * phrase frozen at scrape time — a month-old lead kept insisting it was two hours old.
 * This re-derives from deal.postedAt and re-renders on a timer so it stays honest.
 */
function PostedAgo({ deal }: { deal: Deal }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (deal.postedAt == null) return;
    // A minute is finer than any label we render, so nothing can visibly go stale.
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, [deal.postedAt]);

  if (deal.postedAt == null) {
    // Unparseable — show the raw string rather than inventing a time.
    return <span className="opacity-70">{deal.posted || ""}</span>;
  }
  const days = (Date.now() - deal.postedAt) / 86_400_000;
  return (
    <span title={new Date(deal.postedAt).toLocaleString()} style={days > 21 ? { color: "#fb923c" } : undefined}>
      {agoLabel(deal.postedAt)}
    </span>
  );
}

function Chip({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-mono"
      style={{ background: "rgba(255,255,255,0.06)", color: scoreColor(value) }}>
      {label}{value}
    </span>
  );
}

function SourceTab({ label, count, active, color, onClick }: { label: string; count: number; active: boolean; color: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="px-2 py-0.5 rounded-md text-[10.5px] font-medium transition whitespace-nowrap"
      style={active
        ? { background: `${color}26`, color, border: `1px solid ${color}66` }
        : { background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.5)", border: "1px solid transparent" }}>
      {label} <span className="opacity-55">{count}</span>
    </button>
  );
}

function Card({ deal, onOpen }: { deal: Deal; onOpen: (d: Deal) => void }) {
  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", deal.id)}
      onClick={() => onOpen(deal)}
      className="panel p-3 cursor-pointer transition hover:brightness-110 mb-2"
      style={{ borderLeft: `3px solid ${scoreColor(deal.composite)}` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[13px] font-medium leading-snug line-clamp-2">{deal.title}</div>
        {deal.needsInfo && <AlertTriangle size={13} style={{ color: "#fbbf24", flexShrink: 0 }} />}
      </div>
      <div className="flex flex-wrap gap-1 mt-2 items-center">
        {deal.source && <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded font-semibold" style={{ background: "rgba(96,165,250,0.18)", color: "#60a5fa" }}>{deal.source}</span>}
        {deal.automatable && <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded font-semibold" style={{ background: "rgba(52,211,153,0.18)", color: "#34d399" }} title="Repetitive role — take-and-automate or pitch Launchworks">auto</span>}
        <Chip label="F" value={deal.effectiveFit} />
        <Chip label="E" value={deal.easiness} />
        <Chip label="W" value={deal.winnability} />
        <span className="text-[10px] text-white/40 font-mono ml-auto self-center">{deal.composite}</span>
      </div>
      <div className="flex items-center justify-between mt-2 text-[10.5px] text-white/45">
        <span>{deal.budget || "—"} {deal.jobType || ""}</span>
        <PostedAgo deal={deal} />
      </div>
      <div className="mt-1 text-[10.5px] text-white/40">
        {fmtMoney(deal.clientTotalSpent)} · {deal.clientRating ?? "?"}★ · {deal.clientHires ?? "?"}h
        {deal.enrichment?.proposals != null && <span style={{ color: "#22d3ee" }}> · {deal.enrichment.proposals} proposals</span>}
      </div>
    </div>
  );
}

function Drawer({ deal, onClose }: { deal: Deal; onClose: () => void }) {
  const { move, saveNotes, toggleNeedsInfo, savePitch, draftProposal, generateBrief, ask } = useDesk();
  const [notes, setNotes] = useState(deal.notes);
  const [pitch, setPitch] = useState(deal.pitch || "");
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [briefing, setBriefing] = useState(false);

  useEffect(() => { setNotes(deal.notes); setPitch(deal.pitch || ""); }, [deal.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitAsk = async () => {
    if (!question.trim()) return;
    setAsking(true);
    await ask(deal.id, question.trim());
    setQuestion("");
    setAsking(false);
  };

  const runBrief = async () => {
    setBriefing(true);
    await generateBrief(deal.id);
    setBriefing(false);
  };

  const draftFull = async () => {
    setDrafting(true);
    await saveNotes(deal.id, notes);             // persist your latest notes so the draft uses them
    const text = await draftProposal(deal.id);   // full ~120-word proposal, notes woven in
    if (text) setPitch(text);                    // drop it into the editable box
    setDrafting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div className="w-full max-w-[640px] h-full overflow-y-auto p-6" style={{ background: "var(--bg, #14101c)", borderLeft: "1px solid rgba(255,255,255,0.1)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <h2 className="text-lg font-semibold leading-snug">{deal.title}</h2>
          <button onClick={onClose} className="text-white/50 hover:text-white"><X size={18} /></button>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-3">
          <Chip label="Fit " value={deal.effectiveFit} />
          <Chip label="Easy " value={deal.easiness} />
          <Chip label="Win " value={deal.winnability} />
          <span className="text-[11px] text-white/45 font-mono self-center">composite {deal.composite}</span>
        </div>

        <div className="text-[12.5px] text-white/55 mb-1">
          {deal.budget || "—"} {deal.jobType || ""} · {deal.experienceLevel || ""} · {deal.posted || ""}
        </div>
        <div className="text-[12.5px] text-white/55 mb-3">
          Client: {fmtMoney(deal.clientTotalSpent)} spent · {deal.clientRating ?? "?"}★ · {deal.clientHires ?? "?"} hires · {deal.clientCountry || "?"}
          {deal.enrichment?.proposals != null && <span style={{ color: "#22d3ee" }}> · {deal.enrichment.proposals} proposals</span>}
        </div>

        <a href={deal.url} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[12.5px] mb-4" style={{ color: "#d4a574" }}>
          Open on Upwork <ExternalLink size={13} />
        </a>

        {/* Status + need-info */}
        <div className="flex items-center gap-2 mb-4">
          <select value={deal.status} onChange={(e) => move(deal.id, e.target.value as DealStatus)}
            className="panel px-2 py-1 text-[12px] bg-transparent">
            {["new", "reviewing", "approved", "ready", "sent", "parked", "denied"].map((s) => (
              <option key={s} value={s} style={{ background: "#14101c" }}>{s}</option>
            ))}
          </select>
          <button onClick={() => toggleNeedsInfo(deal.id)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] transition"
            style={{ background: deal.needsInfo ? "rgba(251,191,36,0.18)" : "rgba(255,255,255,0.05)", color: deal.needsInfo ? "#fbbf24" : "rgba(255,255,255,0.6)" }}>
            <AlertTriangle size={12} /> Need more info
          </button>
        </div>

        {/* Project summary — quick "what is this" read before the full listing */}
        {deal.summary && (
          <div className="rounded-lg p-3 mb-4" style={{ background: "rgba(245,158,11,0.08)", borderLeft: "3px solid rgba(245,158,11,0.55)" }}>
            <div className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#f59e0b" }}>Project summary</div>
            <p className="text-[13px] text-white/85 leading-relaxed">{deal.summary}</p>
          </div>
        )}

        {/* No analysis yet. Upwork leads get it from the offline pitch pass; RemoteOK
            and WWR leads never go through that, so offer to generate it on demand. */}
        {!deal.summary && (
          <div className="rounded-lg p-3 mb-4 flex items-center justify-between gap-3" style={{ background: "rgba(255,255,255,0.03)" }}>
            <span className="text-[12px] text-white/50">
              No analysis yet{deal.source ? ` — ${srcLabel(srcKey(deal))} leads aren't pre-pitched` : ""}.
            </span>
            <button onClick={runBrief} disabled={briefing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium disabled:opacity-40 shrink-0"
              style={{ background: "rgba(245,158,11,0.16)", color: "#f59e0b" }}
              title="Generate summary, fit rationale, approach and a crash course for this lead">
              {briefing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {briefing ? "Analysing…" : "Generate brief"}
            </button>
          </div>
        )}

        <Section title="Description">
          <div className="text-[12.5px] text-white/65 whitespace-pre-wrap leading-relaxed">{deal.description || "—"}</div>
        </Section>

        <Section title="Proposal (editable)">
          <button onClick={draftFull} disabled={drafting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 mb-2 rounded-lg text-[12px] font-medium disabled:opacity-40"
            style={{ background: "rgba(52,211,153,0.16)", color: "#34d399" }}
            title="Generate a full ~120-word proposal from the listing + your Notes below">
            {drafting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Draft full proposal (uses your Notes)
          </button>
          <textarea value={pitch} onChange={(e) => setPitch(e.target.value)} onBlur={() => savePitch(deal.id, pitch)}
            rows={8} className="w-full panel bg-transparent p-2 text-[12.5px] leading-relaxed resize-y" />
        </Section>

        {deal.approach && deal.approach !== "n/a" && (
          <Section title="Approach — how we'd do it">
            <p className="text-[12.5px] text-white/65 whitespace-pre-wrap leading-relaxed">{deal.approach}</p>
          </Section>
        )}

        {deal.crashCourse && deal.crashCourse !== "n/a" && (
          <Section title="Crash course — the stack">
            <p className="text-[12.5px] text-white/70 whitespace-pre-wrap leading-relaxed font-mono">{deal.crashCourse}</p>
          </Section>
        )}

        <Section title="Notes">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => saveNotes(deal.id, notes)}
            rows={3} placeholder="Your questions / observations…"
            className="w-full panel bg-transparent p-2 text-[12.5px] resize-y" />
        </Section>

        <Section title="Ask AI about this listing">
          <div className="flex gap-2">
            <input value={question} onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitAsk()}
              placeholder="e.g. how does JobNimbus' API auth work?"
              className="flex-1 panel bg-transparent px-2 py-1.5 text-[12.5px]" />
            <button onClick={submitAsk} disabled={asking}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium"
              style={{ background: "rgba(34,211,238,0.16)", color: "#22d3ee" }}>
              {asking ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Ask
            </button>
          </div>
          {deal.answers.length > 0 && (
            <div className="mt-3 space-y-3">
              {deal.answers.map((a, i) => (
                <div key={i} className="panel p-2.5">
                  <div className="text-[11.5px] text-white/45 mb-1 flex items-center gap-1.5"><HelpCircle size={12} /> {a.q}</div>
                  <div className="text-[12.5px] text-white/75 whitespace-pre-wrap leading-relaxed">{a.a}</div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-white/45 mb-1.5">{title}</div>
      {children}
    </div>
  );
}

function CookieModal({ onClose }: { onClose: () => void }) {
  const { cookie, saveCookie } = useDesk();
  const [val, setVal] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const save = async () => {
    setSaving(true);
    const ok = await saveCookie(val.trim());
    setMsg(ok ? "Saved." : "Couldn't save — check the cookie string.");
    setSaving(false);
    if (ok) setVal("");
  };
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-4" style={{ background: "rgba(0,0,0,0.55)" }} onClick={onClose}>
      <div className="w-full max-w-[560px] panel p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[15px] font-semibold">Upwork session cookie</h3>
          <button onClick={onClose} className="text-white/50 hover:text-white"><X size={16} /></button>
        </div>
        <p className="text-[12px] text-white/55 leading-relaxed mb-3">
          Used only by v2 enrichment to read real proposal counts on <b>approved</b> cards. Stored locally
          (mode 600), never sent to the browser. On a logged-in upwork.com tab: DevTools → Application →
          Cookies (or a Cookie-Editor extension), copy the <code>upwork.com</code> cookie string, paste below.
        </p>
        <textarea value={val} onChange={(e) => setVal(e.target.value)} rows={4}
          placeholder="master_access_token=…; oauth2_global_js_token=…; visitor_id=…"
          className="w-full panel bg-transparent p-2 text-[12px] font-mono resize-y" />
        <div className="flex items-center gap-3 mt-3">
          <button onClick={save} disabled={saving || val.trim().length < 20}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium disabled:opacity-40"
            style={{ background: "rgba(52,211,153,0.16)", color: "#34d399" }}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Save cookie
          </button>
          <span className="text-[11.5px] text-white/45">{msg || (cookie.set ? `Current: ${cookie.hint}` : "No cookie saved yet")}</span>
        </div>
        <p className="text-[11px] text-white/35 mt-3 leading-relaxed">
          ⚠️ Enrichment uses your real account — capped at 10 listings/run, paces like a human, hard-stops on any CAPTCHA. Keep volume low.
        </p>
      </div>
    </div>
  );
}

export default function DealDesk() {
  const { deals, columns, loading, error, fetchDeals, move, fetchCookie, cookie, enriching, enrichResult, enrichApproved, refill, refilling, refillResult, pullFeeds, pullingFeeds, feedsResult, startScrape, scraping, scrapeResult, pollScrape } = useDesk();
  const [open, setOpen] = useState<Deal | null>(null);
  const [showCookie, setShowCookie] = useState(false);
  const [srcTab, setSrcTab] = useState<string>("all"); // source filter for the first (New) column

  useEffect(() => { fetchDeals(); fetchCookie(); }, [fetchDeals, fetchCookie]);
  // A scrape runs for 10–20 minutes on the server, which easily outlives a page view.
  // Re-attach to one already in flight so a reload doesn't look like nothing happened.
  useEffect(() => { pollScrape(); }, [pollScrape]);

  const approvedCount = deals.filter((d) => d.status === "approved").length;

  const selected = open ? deals.find((d) => d.id === open.id) || open : null;

  // Main pipeline columns + a trailing Parked/Denied bucket.
  const allColumns = useMemo(() => {
    const extra = [{ key: "parked" as DealStatus, label: "Parked / Denied", accent: "#5a5d80" }];
    return [...columns, ...extra];
  }, [columns]);

  const byCol = (key: DealStatus) =>
    deals.filter((d) => (key === "parked" ? d.status === "parked" || d.status === "denied" : d.status === key));

  // Source tabs live on the first (New) column, where Upwork + remote feeds all land together.
  const firstKey = allColumns[0]?.key as DealStatus | undefined;
  const firstItems = firstKey ? byCol(firstKey) : [];
  const sourceCounts = firstItems.reduce<Record<string, number>>((a, d) => {
    const k = srcKey(d); a[k] = (a[k] || 0) + 1; return a;
  }, {});
  const presentSources = Object.keys(sourceCounts).sort((a, b) =>
    a === "upwork" ? -1 : b === "upwork" ? 1 : a.localeCompare(b));
  const effTab = srcTab !== "all" && !sourceCounts[srcTab] ? "all" : srcTab; // ignore a stale tab after reload

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-1">
        <div className="grid place-items-center w-9 h-9 rounded-xl" style={{ background: "rgba(245,158,11,0.14)", border: "1px solid rgba(245,158,11,0.4)", color: "#f59e0b" }}>
          <CheckCircle2 size={18} />
        </div>
        <h1 className="text-xl font-semibold">Deal Desk</h1>
        <span className="text-[12px] text-white/40">{deals.length} leads · {approvedCount} approved</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button onClick={enrichApproved} disabled={enriching || approvedCount === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium disabled:opacity-40"
            style={{ background: "rgba(34,211,238,0.16)", color: "#22d3ee" }}
            title={cookie.set ? "Pull real proposals / payment-verified on approved cards" : "Add your Upwork cookie first (gear)"}>
            {enriching ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />} Enrich approved
          </button>
          <button onClick={() => setShowCookie(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] panel hover:brightness-110"
            title="Upwork cookie settings">
            <Settings size={13} />{!cookie.set && <span className="text-[11px]" style={{ color: "#fbbf24" }}>set cookie</span>}
          </button>
          <button onClick={refill} disabled={refilling}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium disabled:opacity-40"
            style={{ background: "rgba(168,85,247,0.16)", color: "#c084fc" }}
            title="Dismiss leads you didn't approve, then pitch the next-best to refill the queue to 20">
            {refilling ? <Loader2 size={13} className="animate-spin" /> : <ListRestart size={13} />} Clear passed & refill
          </button>
          <button onClick={pullFeeds} disabled={pullingFeeds}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium disabled:opacity-40"
            style={{ background: "rgba(96,165,250,0.16)", color: "#60a5fa" }}
            title="Pull remote gig feeds (RemoteOK / We Work Remotely) into the desk">
            {pullingFeeds ? <Loader2 size={13} className="animate-spin" /> : <Rss size={13} />} Pull feeds
          </button>
          <button onClick={startScrape} disabled={scraping}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium disabled:opacity-40"
            style={{ background: "rgba(217,119,87,0.16)", color: "#d97757" }}
            title="Re-scrape Upwork and rebuild the board (opens a browser, takes 10–20 minutes)">
            {scraping ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Re-scrape Upwork
          </button>
          <button onClick={fetchDeals} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] panel hover:brightness-110">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Reload
          </button>
        </div>
      </div>
      <p className="text-sm text-white/45 mb-5">Upwork fast-wins — drag to move stages, open a card to review the pitch, approach, crash course, and notes before you bid.</p>

      {enrichResult && <div className="panel p-2.5 mb-4 text-[12.5px]" style={{ color: "#22d3ee" }}>{enrichResult}</div>}
      {refillResult && <div className="panel p-2.5 mb-4 text-[12.5px]" style={{ color: "#c084fc" }}>{refillResult}</div>}
      {feedsResult && <div className="panel p-2.5 mb-4 text-[12.5px]" style={{ color: "#60a5fa" }}>{feedsResult}</div>}
      {scrapeResult && <div className="panel p-2.5 mb-4 text-[12.5px]" style={{ color: "#d97757" }}>{scrapeResult}</div>}

      {error && <div className="panel p-3 mb-4 text-[12.5px]" style={{ color: "#f87171" }}>{error}</div>}
      {!loading && !error && deals.length === 0 && (
        <div className="panel p-6 text-center text-white/50 text-[13px]">No scored leads yet. Run the scraper pipeline to populate the board.</div>
      )}

      <div className="flex gap-3 overflow-x-auto pb-4">
        {allColumns.map((col) => {
          const isFirst = col.key === firstKey;
          const colItems = byCol(col.key);
          const items = isFirst && effTab !== "all" ? colItems.filter((d) => srcKey(d) === effTab) : colItems;
          return (
            <div key={col.key}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { const id = e.dataTransfer.getData("text/plain"); if (id) move(id, col.key === "parked" ? "parked" : col.key); }}
              className="flex-shrink-0 w-[260px]">
              <div className="flex items-center gap-2 mb-2 px-1">
                <span className="h-2 w-2 rounded-full" style={{ background: col.accent }} />
                <span className="text-[12px] font-semibold">{col.label}</span>
                <span className="text-[11px] text-white/35">{colItems.length}</span>
              </div>
              {isFirst && presentSources.length > 1 && (
                <div className="flex flex-wrap gap-1 mb-2 px-1">
                  <SourceTab label="All" count={colItems.length} active={effTab === "all"} color="#cbd5e1" onClick={() => setSrcTab("all")} />
                  {presentSources.map((k) => (
                    <SourceTab key={k} label={srcLabel(k)} count={sourceCounts[k]} active={effTab === k}
                      color={SOURCE_META[k]?.color ?? "#cbd5e1"} onClick={() => setSrcTab(k)} />
                  ))}
                </div>
              )}
              <div className="min-h-[120px] rounded-xl p-1.5" style={{ background: "rgba(255,255,255,0.02)" }}>
                {items.map((d) => <Card key={d.id} deal={d} onOpen={setOpen} />)}
              </div>
            </div>
          );
        })}
      </div>

      {selected && <Drawer deal={selected} onClose={() => setOpen(null)} />}
      {showCookie && <CookieModal onClose={() => setShowCookie(false)} />}
    </div>
  );
}
