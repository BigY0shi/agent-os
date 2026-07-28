"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  CalendarDays, Loader2, RefreshCw, Sparkles, X, Trash2, BarChart3, ExternalLink, PenLine,
} from "lucide-react";
import { CHANNELS, type Channel, type ContentItem, type EngineState, type ItemStatus } from "@/lib/contentEngineTypes";

// Content Engine — plan a posting calendar, generate the materials, log how the
// posts performed, and let the analyst read the numbers. Server: /api/content-engine/*.

const CHANNEL_COLOR: Record<Channel, string> = {
  x: "#cbd5e1", linkedin: "#60a5fa", youtube: "#ef4444", tiktok: "#f472b6",
  instagram: "#e879f9", blog: "#34d399", reddit: "#fb923c", substack: "#fbbf24",
};
const STATUS_COLOR: Record<ItemStatus, string> = {
  planned: "#a855f7", drafted: "#22d3ee", posted: "#34d399", skipped: "#5a5d80",
};

function weekOf(dateISO: string): string {
  const d = new Date(dateISO + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "Unscheduled";
  const day = (d.getDay() + 6) % 7; // Monday-start
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-white/45 mb-1.5">{title}</div>
      {children}
    </div>
  );
}

export default function ContentEngineView() {
  const [state, setState] = useState<EngineState>({ plan: null, items: [], insights: null });
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showPlanner, setShowPlanner] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  // Planner form
  const [goals, setGoals] = useState("");
  const [channels, setChannels] = useState<Channel[]>(["x", "linkedin"]);
  const [perWeek, setPerWeek] = useState(5);
  const [weeks, setWeeks] = useState(2);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const j = await (await fetch("/api/content-engine/list", { cache: "no-store" })).json();
      if (j.ok) {
        setState(j.state);
        if (j.state.plan) { setGoals(j.state.plan.goals); setChannels(j.state.plan.channels); setPerWeek(j.state.plan.perWeek); setWeeks(j.state.plan.weeks); }
      }
    } catch { /* empty state covers it */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function planCalendar() {
    if (!goals.trim() || !channels.length) { setNote("Give the planner goals and at least one channel."); return; }
    setPlanning(true);
    setNote("Planning the calendar… (Claude, ~1 min)");
    try {
      const j = await (await fetch("/api/content-engine/plan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goals: goals.trim(), channels, perWeek, weeks }),
      })).json();
      if (j.ok) { setNote(`Planned ${j.added} slots${j.kept ? ` · kept ${j.kept} in-flight items` : ""}`); setShowPlanner(false); await load(); }
      else setNote(j.error || "Planning failed");
    } catch (e) { setNote((e as Error).message); }
    setPlanning(false);
  }

  async function analyze() {
    setAnalyzing(true);
    setNote("Reading the numbers…");
    try {
      const j = await (await fetch("/api/content-engine/action", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "insights" }),
      })).json();
      if (j.ok) { setNote(null); await load(); }
      else setNote(j.error || "Analysis failed");
    } catch (e) { setNote((e as Error).message); }
    setAnalyzing(false);
  }

  const postedCount = state.items.filter((i) => i.status === "posted").length;
  const withMetrics = state.items.filter((i) => i.metrics).length;
  const selected = openId ? state.items.find((i) => i.id === openId) || null : null;

  // Group by Monday-start week.
  const byWeek = new Map<string, ContentItem[]>();
  for (const it of state.items) {
    const w = weekOf(it.date);
    (byWeek.get(w) ?? byWeek.set(w, []).get(w)!).push(it);
  }
  const weekKeys = [...byWeek.keys()].sort();

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3 flex-wrap mb-1">
        <div className="grid place-items-center w-9 h-9 rounded-xl" style={{ background: "rgba(232,121,249,0.14)", border: "1px solid rgba(232,121,249,0.4)", color: "#e879f9" }}>
          <CalendarDays size={18} />
        </div>
        <h1 className="text-xl font-semibold">Content Engine</h1>
        <span className="text-[12px] text-white/40">{state.items.length} slots · {postedCount} posted · {withMetrics} measured</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button onClick={() => setShowPlanner((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium"
            style={{ background: "rgba(232,121,249,0.16)", color: "#e879f9" }}>
            <PenLine size={13} /> {state.plan ? "Replan" : "Plan calendar"}
          </button>
          <button onClick={analyze} disabled={analyzing || !withMetrics}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium disabled:opacity-40"
            style={{ background: "rgba(52,211,153,0.16)", color: "#34d399" }}
            title={withMetrics ? "AI performance read over everything with logged metrics" : "Log metrics on a posted item first"}>
            {analyzing ? <Loader2 size={13} className="animate-spin" /> : <BarChart3 size={13} />} Analyze performance
          </button>
          <button onClick={load} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] panel hover:brightness-110">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Reload
          </button>
        </div>
      </div>
      <p className="text-sm text-white/45 mb-4">
        Plan the calendar, generate each post&apos;s materials, log the real numbers after posting, and let the analyst tell you what to double down on.
      </p>

      {note && <div className="panel p-2.5 mb-4 text-[12.5px]" style={{ color: "#e879f9" }}>{note}</div>}

      {/* Planner */}
      {(showPlanner || (!state.plan && !state.items.length && !loading)) && (
        <div className="panel p-4 mb-5">
          <div className="text-[12px] font-semibold mb-2">What are we trying to do?</div>
          <textarea value={goals} onChange={(e) => setGoals(e.target.value)} rows={2}
            placeholder="e.g. build an audience for my AI-machine consultancy; show the homelab/self-host angle; drive people to the Deal Desk offer…"
            className="w-full panel bg-transparent p-2 text-[12.5px] resize-y mb-3" />
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            {CHANNELS.map((c) => {
              const on = channels.includes(c);
              return (
                <button key={c} onClick={() => setChannels((cs) => on ? cs.filter((x) => x !== c) : [...cs, c])}
                  className="px-2 py-1 rounded-md text-[11px] font-medium transition"
                  style={on
                    ? { background: `${CHANNEL_COLOR[c]}26`, color: CHANNEL_COLOR[c], border: `1px solid ${CHANNEL_COLOR[c]}66` }
                    : { background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.5)", border: "1px solid transparent" }}>
                  {c}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="text-[12px] text-white/55 flex items-center gap-2">
              posts / week
              <input type="number" min={1} max={21} value={perWeek} onChange={(e) => setPerWeek(+e.target.value || 5)}
                className="panel bg-transparent px-2 py-1 w-16 text-[12px]" />
            </label>
            <label className="text-[12px] text-white/55 flex items-center gap-2">
              weeks
              <input type="number" min={1} max={8} value={weeks} onChange={(e) => setWeeks(+e.target.value || 2)}
                className="panel bg-transparent px-2 py-1 w-16 text-[12px]" />
            </label>
            <button onClick={planCalendar} disabled={planning}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium disabled:opacity-40"
              style={{ background: "rgba(232,121,249,0.16)", color: "#e879f9" }}>
              {planning ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {planning ? "Planning…" : "Plan calendar"}
            </button>
            <span className="text-[11px] text-white/35">A replan keeps drafted/posted items and only replaces untouched planned slots.</span>
          </div>
        </div>
      )}

      {/* Insights */}
      {state.insights && (
        <div className="rounded-lg p-4 mb-5" style={{ background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.3)" }}>
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 size={14} style={{ color: "#34d399" }} />
            <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "#34d399" }}>
              Performance read · {new Date(state.insights.at).toLocaleString()}
            </span>
          </div>
          <div className="text-[13px] text-white/85 whitespace-pre-wrap leading-relaxed">{state.insights.text}</div>
        </div>
      )}

      {!loading && !state.items.length && state.plan && (
        <div className="panel p-6 text-center text-white/50 text-[13px]">Calendar is empty — hit Replan.</div>
      )}

      {/* Calendar, week by week */}
      {weekKeys.map((wk) => (
        <div key={wk} className="mb-5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-white/35 mb-2">
            {wk === "Unscheduled" ? "Unscheduled" : `Week of ${wk}`}
          </div>
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))" }}>
            {byWeek.get(wk)!.map((it) => (
              <button key={it.id} onClick={() => setOpenId(it.id)}
                className="panel p-3 text-left transition hover:brightness-110"
                style={{ opacity: it.status === "skipped" ? 0.5 : 1 }}>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-white/45">{it.date.slice(5)}</span>
                  <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded font-semibold"
                    style={{ background: `${CHANNEL_COLOR[it.channel]}22`, color: CHANNEL_COLOR[it.channel] }}>{it.channel}</span>
                  <span className="text-[10px] text-white/40">{it.format}</span>
                  <span className="ml-auto h-2 w-2 rounded-full" title={it.status} style={{ background: STATUS_COLOR[it.status] }} />
                </div>
                <div className="text-[12.5px] text-white/85 font-medium leading-snug mt-1.5 line-clamp-2">{it.topic}</div>
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  {it.materials?.copy && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
                      style={{ background: "rgba(34,211,238,0.18)", color: "#22d3ee" }}>materials</span>
                  )}
                  {it.postedUrl && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
                      style={{ background: "rgba(52,211,153,0.18)", color: "#34d399" }}>posted</span>
                  )}
                  {it.metrics && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
                      style={{ background: "rgba(251,191,36,0.18)", color: "#fbbf24" }}>
                      {it.metrics.views != null ? `${it.metrics.views} views` : "measured"}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}

      {selected && <ItemDrawer item={selected} onClose={() => setOpenId(null)} onSaved={load} />}
    </div>
  );
}

function ItemDrawer({ item, onClose, onSaved }: { item: ContentItem; onClose: () => void; onSaved: () => void }) {
  const [copy, setCopy] = useState(item.materials?.copy || "");
  const [notes, setNotes] = useState(item.notes);
  const [url, setUrl] = useState(item.postedUrl || "");
  const [metrics, setMetrics] = useState({
    views: item.metrics?.views?.toString() ?? "", likes: item.metrics?.likes?.toString() ?? "",
    comments: item.metrics?.comments?.toString() ?? "", shares: item.metrics?.shares?.toString() ?? "",
    clicks: item.metrics?.clicks?.toString() ?? "",
  });
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    setCopy(item.materials?.copy || ""); setNotes(item.notes); setUrl(item.postedUrl || "");
    setMetrics({
      views: item.metrics?.views?.toString() ?? "", likes: item.metrics?.likes?.toString() ?? "",
      comments: item.metrics?.comments?.toString() ?? "", shares: item.metrics?.shares?.toString() ?? "",
      clicks: item.metrics?.clicks?.toString() ?? "",
    });
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(action: string, value?: unknown) {
    await fetch("/api/content-engine/action", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, id: item.id, value }),
    }).catch(() => {});
  }

  async function generate() {
    setGenerating(true); setErr("");
    try {
      const j = await (await fetch("/api/content-engine/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      })).json();
      if (j.ok) { setCopy(j.item?.materials?.copy || ""); onSaved(); }
      else setErr(j.error || "Generation failed");
    } catch (e) { setErr((e as Error).message); }
    setGenerating(false);
  }

  async function saveMetrics() {
    await act("metrics", metrics);
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div className="w-full max-w-[640px] h-full overflow-y-auto p-6"
        style={{ background: "var(--bg, #14101c)", borderLeft: "1px solid rgba(255,255,255,0.1)" }}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-lg font-semibold leading-snug">{item.topic}</h2>
          <button onClick={onClose} className="text-white/50 hover:text-white shrink-0"><X size={18} /></button>
        </div>
        <div className="text-[12.5px] text-white/55 mb-3">
          {item.date} · <span style={{ color: CHANNEL_COLOR[item.channel] }}>{item.channel}</span> · {item.format}
        </div>

        <div className="flex items-center gap-2 mb-4">
          <select value={item.status} onChange={async (e) => { await act("status", e.target.value); onSaved(); }}
            className="panel px-2 py-1 text-[12px] bg-transparent">
            {(["planned", "drafted", "posted", "skipped"] as ItemStatus[]).map((s) => (
              <option key={s} value={s} style={{ background: "#14101c" }}>{s}</option>
            ))}
          </select>
          <button onClick={async () => { await act("remove"); onSaved(); onClose(); }}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px]"
            style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.6)" }}>
            <Trash2 size={12} /> Remove
          </button>
        </div>

        {item.hook && (
          <div className="rounded-lg p-3 mb-4" style={{ background: "rgba(232,121,249,0.08)", borderLeft: "3px solid rgba(232,121,249,0.55)" }}>
            <div className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: "#e879f9" }}>Hook</div>
            <p className="text-[13px] text-white/85 leading-relaxed">{item.hook}</p>
          </div>
        )}

        {err && <div className="text-[12px] mb-3" style={{ color: "#f87171" }}>{err}</div>}

        <Section title="Post copy (editable)">
          <button onClick={generate} disabled={generating}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 mb-2 rounded-lg text-[12px] font-medium disabled:opacity-40"
            style={{ background: "rgba(34,211,238,0.16)", color: "#22d3ee" }}>
            {generating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {generating ? "Generating…" : item.materials?.copy ? "Regenerate materials" : "Generate materials"}
          </button>
          <textarea value={copy} onChange={(e) => setCopy(e.target.value)} onBlur={() => act("copy", copy)}
            rows={10} placeholder="No materials yet — generate, or write your own."
            className="w-full panel bg-transparent p-2 text-[12.5px] leading-relaxed resize-y" />
        </Section>

        {item.materials?.hashtags && (
          <Section title="Hashtags"><p className="text-[12.5px] text-white/70">{item.materials.hashtags}</p></Section>
        )}
        {item.materials?.imagePrompt && (
          <Section title="Image prompt (for the Thumbnails studio)">
            <p className="text-[12.5px] text-white/70 leading-relaxed">{item.materials.imagePrompt}</p>
          </Section>
        )}
        {item.materials?.videoScript && (
          <Section title="Video script">
            <p className="text-[12.5px] text-white/70 whitespace-pre-wrap leading-relaxed font-mono">{item.materials.videoScript}</p>
          </Section>
        )}

        <Section title="Posted URL">
          <div className="flex gap-2">
            <input value={url} onChange={(e) => setUrl(e.target.value)} onBlur={async () => { await act("postedUrl", url); onSaved(); }}
              placeholder="Paste the live post link once it's up…"
              className="flex-1 panel bg-transparent px-2 py-1.5 text-[12.5px]" />
            {item.postedUrl && (
              <a href={item.postedUrl} target="_blank" rel="noopener noreferrer"
                className="grid place-items-center px-2.5 rounded-lg panel" style={{ color: "#34d399" }}>
                <ExternalLink size={14} />
              </a>
            )}
          </div>
        </Section>

        <Section title="Metrics (log after posting)">
          <div className="grid grid-cols-5 gap-2 mb-2">
            {(["views", "likes", "comments", "shares", "clicks"] as const).map((k) => (
              <label key={k} className="text-[10px] text-white/45 uppercase tracking-wide">
                {k}
                <input type="number" min={0} value={metrics[k]}
                  onChange={(e) => setMetrics((m) => ({ ...m, [k]: e.target.value }))}
                  className="w-full panel bg-transparent px-1.5 py-1 mt-1 text-[12px]" />
              </label>
            ))}
          </div>
          <button onClick={saveMetrics}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium"
            style={{ background: "rgba(251,191,36,0.16)", color: "#fbbf24" }}>
            <BarChart3 size={13} /> Save metrics
          </button>
        </Section>

        <Section title="Notes">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => act("notes", notes)}
            rows={3} placeholder="Angle changes, replies worth stealing, what you'd do differently…"
            className="w-full panel bg-transparent p-2 text-[12.5px] resize-y" />
        </Section>
      </div>
    </div>
  );
}
