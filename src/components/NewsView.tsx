"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FaceStage } from "@/components/faces/FaceStage";
import { Newspaper, Search, Loader2, Clock, X, ArrowUpRight, Globe, History as HistoryIcon } from "lucide-react";

// NEWS DIGEST — ask "what's new in <anything>" and get a briefing: your CLI agents fan out
// to search recent coverage, then a manager summarizes the hot news + the stories behind it.

interface Item { headline: string; summary: string; url: string; source: string; posted: string; }
interface Briefing { at: string; topic: string; overview: string; items: Item[]; scouts: string[]; merger: string; }

const EXAMPLES = [
  "What's new in AI",
  "Latest on Nvidia",
  "This week in Formula 1",
  "What's happening in self-hosting",
];

const STATUS = [
  "Sending out the scouts…",
  "Searching the web…",
  "Reading recent coverage…",
  "Cross-checking sources…",
  "Rounding up the hot stories…",
  "Writing your briefing…",
];

function ago(iso: string): string {
  const s = Math.floor((Date.now() - Date.parse(iso)) / 1000);
  if (isNaN(s)) return "";
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

export default function NewsView() {
  const [topic, setTopic] = useState("");
  const [merger, setMerger] = useState<"claude" | "ollama">("claude");
  const [busy, setBusy] = useState(false);
  const [statusIdx, setStatusIdx] = useState(0);
  const [result, setResult] = useState<Briefing | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState<Briefing[]>([]);
  const outRef = useRef<HTMLDivElement>(null);

  const loadHistory = useCallback(() => {
    fetch("/api/news", { cache: "no-store" }).then((r) => r.json())
      .then((j) => setHistory(Array.isArray(j.items) ? j.items : [])).catch(() => {});
  }, []);
  useEffect(() => { loadHistory(); }, [loadHistory]);
  useEffect(() => { const m = localStorage.getItem("newsMerger"); if (m === "ollama" || m === "claude") setMerger(m); }, []);

  useEffect(() => {
    if (!busy) return;
    const i = setInterval(() => setStatusIdx((n) => (n + 1) % STATUS.length), 3400);
    return () => clearInterval(i);
  }, [busy]);

  const run = useCallback(async (q: string) => {
    const t = q.trim();
    if (!t || busy) return;
    setBusy(true); setErr(null); setResult(null); setStatusIdx(0);
    try {
      const r = await fetch("/api/news", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic: t, merger }),
      });
      const d = await r.json();
      if (!d.ok) { setErr(d.error || "Couldn't pull a briefing. Try again."); setBusy(false); return; }
      setResult(d); setBusy(false); loadHistory();
      setTimeout(() => outRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    } catch (e) {
      setErr(String((e as Error)?.message || e)); setBusy(false);
    }
  }, [busy, merger, loadHistory]);

  const recall = (b: Briefing) => {
    setResult(b); setTopic(b.topic); setErr(null);
    setTimeout(() => outRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  return (
    <div className="nws">
      <style>{`
        .nws{ --cy:#22d3ee; --tl:#34d399; --am:#fbbf24; --ink:#dbeafe; --dim:#6b7a8d;
          color:var(--ink); font-family:var(--font-sans),system-ui,sans-serif; }
        .nws-grid{ display:grid; grid-template-columns:1fr 260px; gap:22px; align-items:start; }
        @media(max-width:1040px){ .nws-grid{ grid-template-columns:1fr; } }

        .nws-ask{ position:relative; border:1px solid rgba(34,211,238,.22); border-radius:16px; overflow:hidden; padding:20px;
          background:radial-gradient(circle at 50% 0%, rgba(34,211,238,.08), rgba(4,7,12,0) 60%), linear-gradient(180deg,#081018,#060a10); }
        .nws-eyebrow{ display:flex; align-items:center; gap:9px; font-family:var(--font-mono),monospace; font-size:.6rem;
          letter-spacing:.26em; text-transform:uppercase; color:var(--cy); margin-bottom:12px; }
        .nws-inputrow{ display:flex; gap:10px; align-items:stretch; flex-wrap:wrap; }
        .nws-input{ flex:1; min-width:240px; display:flex; align-items:center; gap:10px; background:rgba(4,8,14,.7);
          border:1px solid rgba(34,211,238,.25); border-radius:12px; padding:0 14px; transition:border-color .15s, box-shadow .15s; }
        .nws-input:focus-within{ border-color:rgba(34,211,238,.6); box-shadow:0 0 0 3px rgba(34,211,238,.1); }
        .nws-input input{ flex:1; background:none; border:0; outline:none; color:var(--ink); font-size:1.02rem; padding:13px 0;
          font-family:var(--font-sans),sans-serif; }
        .nws-input input::placeholder{ color:#5f6b7a; }
        .nws-go{ display:inline-flex; align-items:center; gap:9px; cursor:pointer; border:0; font-family:var(--font-display),sans-serif;
          font-weight:800; font-size:.94rem; color:#04121a; background:var(--cy); padding:0 22px; border-radius:12px;
          box-shadow:0 0 24px rgba(34,211,238,.4); transition:transform .15s, box-shadow .2s, opacity .2s; white-space:nowrap; }
        .nws-go:hover{ transform:translateY(-1px); box-shadow:0 0 34px rgba(34,211,238,.62); }
        .nws-go:disabled{ opacity:.6; cursor:default; transform:none; }

        .nws-sub{ display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-top:13px; }
        .nws-chip{ font-size:.78rem; color:#bfe9f5; background:rgba(34,211,238,.06); border:1px solid rgba(34,211,238,.22);
          border-radius:999px; padding:5px 12px; cursor:pointer; transition:border-color .15s, background .15s; }
        .nws-chip:hover{ border-color:var(--cy); background:rgba(34,211,238,.12); }
        .nws-merger{ margin-left:auto; display:inline-flex; align-items:center; gap:7px; font-family:var(--font-mono),monospace; font-size:.66rem; color:var(--dim); }
        .nws-merger select{ background:rgba(4,8,14,.7); color:var(--ink); border:1px solid rgba(34,211,238,.25); border-radius:8px; padding:5px 8px; font-family:var(--font-mono),monospace; font-size:.66rem; cursor:pointer; }

        .nws-think{ margin-top:22px; display:flex; flex-direction:column; align-items:center; gap:14px; padding:24px 0; }
        .nws-radar{ width:64px; height:64px; border-radius:50%; position:relative;
          background:conic-gradient(from 0deg, rgba(34,211,238,0), rgba(34,211,238,.5)); animation:nws-spin 1.4s linear infinite; }
        .nws-radar::after{ content:""; position:absolute; inset:6px; border-radius:50%; background:#060a10; border:1px solid rgba(34,211,238,.3); }
        @keyframes nws-spin{ to{ transform:rotate(360deg); } }
        .nws-think .line{ font-family:var(--font-mono),monospace; font-size:.82rem; color:var(--cy); }

        .nws-out{ margin-top:22px; animation:nws-rise .45s cubic-bezier(.16,1,.3,1); }
        @keyframes nws-rise{ from{ opacity:0; transform:translateY(10px); } to{ opacity:1; transform:none; } }
        .nws-topic{ font-family:var(--font-display),sans-serif; font-weight:800; font-size:1.5rem; color:#eafdff; margin:0 0 4px; }
        .nws-cred{ font-family:var(--font-mono),monospace; font-size:.64rem; color:var(--dim); margin-bottom:16px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        .nws-overview{ font-size:1.06rem; line-height:1.7; color:#e6f1fb; background:rgba(34,211,238,.05);
          border:1px solid rgba(34,211,238,.16); border-left:3px solid var(--cy); border-radius:0 12px 12px 0; padding:16px 20px; margin-bottom:20px; }

        .nws-list{ display:flex; flex-direction:column; gap:12px; }
        .nws-item{ border:1px solid rgba(34,211,238,.14); border-radius:13px; background:rgba(34,211,238,.03); padding:15px 18px;
          transition:border-color .15s, transform .15s; }
        .nws-item:hover{ border-color:rgba(34,211,238,.4); transform:translateY(-1px); }
        .nws-item h4{ font-family:var(--font-display),sans-serif; font-weight:700; font-size:1.08rem; color:#eafdff; margin:0 0 5px; line-height:1.25; }
        .nws-item p{ font-size:.94rem; line-height:1.55; color:#c3d3e6; margin:0 0 10px; }
        .nws-item .meta{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
        .nws-src{ font-family:var(--font-mono),monospace; font-size:.64rem; color:var(--cy); background:rgba(34,211,238,.08);
          border:1px solid rgba(34,211,238,.2); border-radius:999px; padding:3px 9px; display:inline-flex; align-items:center; gap:5px; }
        .nws-posted{ font-family:var(--font-mono),monospace; font-size:.64rem; color:var(--dim); }
        .nws-read{ margin-left:auto; display:inline-flex; align-items:center; gap:5px; text-decoration:none; font-family:var(--font-mono),monospace;
          font-size:.7rem; font-weight:700; color:#fff; background:linear-gradient(180deg,#1d2735,#0b1118); border:1px solid rgba(120,200,255,.4);
          border-radius:8px; padding:6px 12px; transition:transform .15s, box-shadow .2s; }
        .nws-read:hover{ transform:translateY(-1px); box-shadow:0 0 18px rgba(34,211,238,.35); }

        .nws-err{ margin-top:18px; border:1px solid rgba(251,113,133,.4); background:rgba(251,113,133,.08); color:#fecdd3;
          border-radius:12px; padding:12px 16px; font-size:.9rem; display:flex; gap:10px; align-items:flex-start; }

        .nws-hist{ border:1px solid rgba(34,211,238,.16); border-radius:16px; padding:16px; background:rgba(6,10,16,.6); }
        .nws-hist h4{ display:flex; align-items:center; gap:8px; font-family:var(--font-mono),monospace; font-size:.6rem;
          letter-spacing:.2em; text-transform:uppercase; color:var(--dim); margin:0 0 12px; }
        .nws-hist-empty{ font-size:.82rem; color:var(--dim); line-height:1.5; }
        .nws-hist-item{ display:block; width:100%; text-align:left; background:rgba(34,211,238,.04); border:1px solid rgba(34,211,238,.14);
          border-radius:11px; padding:10px 12px; margin-bottom:9px; cursor:pointer; transition:border-color .15s, background .15s; }
        .nws-hist-item:hover{ border-color:var(--cy); background:rgba(34,211,238,.09); }
        .nws-hist-item .t{ font-size:.85rem; color:var(--ink); line-height:1.35; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
        .nws-hist-item .m{ margin-top:6px; font-family:var(--font-mono),monospace; font-size:.6rem; color:var(--dim); }
      `}</style>

      <FaceStage
        variant="radar"
        name="News Radar"
        subtitle="What's new in anything"
        state={err ? "error" : busy ? "working" : "idle"}
        detail={busy ? "Scouts are out gathering; the merger writes the digest when they return" : err ?? undefined}
        height={260}
      />
      <div className="nws-grid">
        <div>
          <div className="nws-ask">
            <div className="nws-eyebrow"><Newspaper size={13} /> News Radar · what&apos;s new in anything</div>
            <div className="nws-inputrow">
              <label className="nws-input">
                <Search size={16} style={{ color: "var(--cy)" }} />
                <input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") run(topic); }}
                  placeholder="What's new in… (AI, Nvidia, F1, your city, a company, a hobby — anything)"
                  disabled={busy}
                />
              </label>
              <button className="nws-go" onClick={() => run(topic)} disabled={busy || !topic.trim()}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                {busy ? "Searching…" : "What's new?"}
              </button>
            </div>
            <div className="nws-sub">
              {!busy && EXAMPLES.map((ex) => (
                <button key={ex} className="nws-chip" onClick={() => { setTopic(ex); run(ex); }}>{ex}</button>
              ))}
              <label className="nws-merger" title="Who summarizes the scouts' findings">
                summarize&nbsp;with
                <select value={merger} onChange={(e) => { const m = e.target.value === "ollama" ? "ollama" : "claude"; setMerger(m); localStorage.setItem("newsMerger", m); }} disabled={busy}>
                  <option value="claude">Claude</option>
                  <option value="ollama">Ollama (local)</option>
                </select>
              </label>
            </div>
          </div>

          {busy && (
            <div className="nws-think">
              <div className="nws-radar" />
              <div className="line">{STATUS[statusIdx]}</div>
            </div>
          )}

          {err && <div className="nws-err"><X size={16} style={{ marginTop: 2 }} /><div>{err}</div></div>}

          {result && !busy && (
            <div className="nws-out" ref={outRef}>
              <h3 className="nws-topic">{result.topic}</h3>
              <div className="nws-cred">
                {result.at && <><Clock size={11} /> {ago(result.at)}</>}
                {result.scouts?.length ? <span>· searched via {result.scouts.join(" · ")}{result.merger ? ` → summarized by ${result.merger}` : ""}</span> : null}
              </div>
              {result.overview && <div className="nws-overview">{result.overview}</div>}
              <div className="nws-list">
                {result.items.map((it, i) => (
                  <div className="nws-item" key={`${it.url}-${i}`}>
                    <h4>{it.headline}</h4>
                    {it.summary && <p>{it.summary}</p>}
                    <div className="meta">
                      {(it.source || domainOf(it.url)) && <span className="nws-src"><Globe size={10} /> {it.source || domainOf(it.url)}</span>}
                      {it.posted && <span className="nws-posted">{it.posted}</span>}
                      {it.url && <a className="nws-read" href={it.url} target="_blank" rel="noopener noreferrer">Read <ArrowUpRight size={12} /></a>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="nws-hist">
          <h4><HistoryIcon size={12} /> Past briefings</h4>
          {history.length === 0 ? (
            <div className="nws-hist-empty">Your briefings are kept here — ask what&apos;s new and it&apos;s remembered.</div>
          ) : history.map((b, i) => (
            <button key={`${b.at}-${i}`} className="nws-hist-item" onClick={() => recall(b)}>
              <div className="t">{b.topic}</div>
              <div className="m">{ago(b.at)}{b.items?.length ? ` · ${b.items.length} stories` : ""}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
