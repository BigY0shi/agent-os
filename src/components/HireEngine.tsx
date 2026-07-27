"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Factory, RefreshCw, Loader2, ExternalLink, Sparkles, X, Check, Archive } from "lucide-react";
import { MACHINES, MACHINE_ORDER, machineFor, type MachineKey } from "@/lib/hireMachines";
import type { HireLead, HireStatus } from "@/lib/hireDesk";

// Hire Engine — companies mid-hire for a role one of our machines already covers.
// The Deal Desk works freelance gigs; this works salaried job postings, because the
// pitch is different: you are displacing a salary line, not winning a project.

const money = (n: number | null) => (n == null ? null : n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`);

function scoreColor(n: number) {
  return n >= 8 ? "#86efac" : n >= 7 ? "#fbbf24" : n >= 6 ? "#fb923c" : "#f87171";
}

function ago(iso: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = Math.round((Date.now() - t) / 86_400_000);
  if (d <= 0) return "today";
  if (d === 1) return "1d ago";
  if (d < 30) return `${d}d ago`;
  return `${Math.round(d / 30)}mo ago`;
}

export default function HireEngine() {
  const [leads, setLeads] = useState<HireLead[]>([]);
  const [counts, setCounts] = useState<Record<string, { total: number; new: number }>>({});
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [filter, setFilter] = useState<MachineKey | "all">("all");
  const [open, setOpen] = useState<HireLead | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const j = await (await fetch("/api/hire/list", { cache: "no-store" })).json();
      if (j.ok) { setLeads(j.leads); setCounts(j.counts); }
    } catch { /* the empty state covers it */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function rescan() {
    setScanning(true);
    setNote("Scanning job boards…");
    try {
      const j = await (await fetch("/api/hire/scrape", { method: "POST" })).json();
      setNote(j.ok ? `Scanned ${j.raw} postings · ${j.candidates} candidates` : j.error || "Scan failed");
      if (j.ok) await load();
    } catch (e) { setNote((e as Error).message); }
    setScanning(false);
  }

  async function setStatus(id: string, status: HireStatus) {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));
    setOpen((o) => (o && o.id === id ? { ...o, status } : o));
    await fetch("/api/hire/action", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "status", id, value: status }),
    }).catch(() => {});
    // "dismissed" removes it from the list server-side, so resync.
    if (status === "dismissed") { setOpen(null); load(); }
  }

  const shown = useMemo(
    () => leads.filter((l) => (filter === "all" ? true : l.machineKey === filter)),
    [leads, filter],
  );

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3 flex-wrap mb-1">
        <div className="flex items-center gap-2 text-zinc-100">
          <Factory size={19} style={{ color: "#fb923c" }} />
          <h1 className="text-xl font-semibold">Hire Engine</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={rescan} disabled={scanning}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium disabled:opacity-40"
            style={{ background: "rgba(251,146,60,0.16)", color: "#fb923c" }}
            title="Re-scan remotive / jobicy / himalayas for new postings (no account needed)">
            {scanning ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Scan job boards
          </button>
          <button onClick={load}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] panel hover:brightness-110">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Reload
          </button>
        </div>
      </div>
      <p className="text-sm text-white/45 mb-4">
        Companies hiring a human for work a machine already does. The offer is to augment the hire, not replace them.
      </p>

      {note && <div className="panel p-2.5 mb-4 text-[12.5px]" style={{ color: "#fb923c" }}>{note}</div>}

      {/* Machine strip — doubles as the filter and as the "what have I built" view. */}
      <div className="grid gap-2 mb-5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))" }}>
        {MACHINE_ORDER.map((k) => {
          const m = MACHINES[k];
          const c = counts[k] || { total: 0, new: 0 };
          const active = filter === k;
          return (
            <button key={k} onClick={() => setFilter(active ? "all" : k)}
              className="panel p-3 text-left transition hover:brightness-110"
              style={{ outline: active ? `1px solid ${m.accent}` : "none" }}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-semibold" style={{ color: m.accent }}>{m.name}</span>
                <span className="text-[15px] font-mono text-white/80">{c.total}</span>
              </div>
              <div className="text-[10.5px] text-white/45 mt-1">{m.hiringFor}</div>
              <div className="flex items-center gap-2 mt-2 text-[10px]">
                <span className="px-1.5 py-0.5 rounded font-semibold"
                  style={m.built
                    ? { background: "rgba(52,211,153,0.18)", color: "#34d399" }
                    : { background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.5)" }}>
                  {m.built ? "BUILT" : "NOT BUILT"}
                </span>
                <span className="text-white/40">{m.price}</span>
              </div>
            </button>
          );
        })}
      </div>

      {loading && <div className="text-sm text-white/45">Loading…</div>}
      {!loading && !shown.length && (
        <div className="panel p-6 text-center text-white/50 text-[13px]">
          No candidates yet. Hit <span className="text-white/80">Scan job boards</span> to pull current postings.
        </div>
      )}

      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(330px,1fr))" }}>
        {shown.map((l) => {
          const m = machineFor(l.machineKey);
          return (
            <button key={l.id} onClick={() => setOpen(l)}
              className="panel p-3 text-left transition hover:brightness-110"
              style={{ borderLeft: `3px solid ${scoreColor(l.composite)}` }}>
              <div className="flex items-start justify-between gap-2">
                <span className="text-[13px] text-white/90 font-medium leading-snug">{l.title}</span>
                <span className="text-[10px] font-mono text-white/40 shrink-0">{l.composite}</span>
              </div>
              <div className="text-[11px] text-white/55 mt-1">{l.company ?? "—"}</div>
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded font-semibold"
                  style={{ background: `${m.accent}22`, color: m.accent }}>{m.key}</span>
                {l.salaryNum && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
                    style={{ background: "rgba(52,211,153,0.18)", color: "#34d399" }}>{money(l.salaryNum)}/yr</span>
                )}
                {l.pitch && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
                    style={{ background: "rgba(168,85,247,0.18)", color: "#c084fc" }}>pitched</span>
                )}
                {l.status !== "new" && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded text-white/60"
                    style={{ background: "rgba(255,255,255,0.07)" }}>{l.status}</span>
                )}
                <span className="ml-auto text-[10px] text-white/35">{l.source} · {ago(l.posted)}</span>
              </div>
            </button>
          );
        })}
      </div>

      {open && <Drawer lead={open} onClose={() => setOpen(null)} onStatus={setStatus} onSaved={load} />}
    </div>
  );
}

function Drawer({ lead, onClose, onStatus, onSaved }: {
  lead: HireLead; onClose: () => void;
  onStatus: (id: string, s: HireStatus) => void; onSaved: () => void;
}) {
  const m = machineFor(lead.machineKey);
  const [pitch, setPitch] = useState(lead.pitch || "");
  const [read, setRead] = useState(lead.read || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { setPitch(lead.pitch || ""); setRead(lead.read || ""); }, [lead.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function writePitch() {
    setBusy(true); setErr("");
    try {
      const j = await (await fetch("/api/hire/pitch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: lead.id }),
      })).json();
      if (j.ok) { setPitch(j.pitch); setRead(j.read || ""); onSaved(); }
      else setErr(j.error || "Could not write the pitch");
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div className="w-full max-w-[640px] h-full overflow-y-auto p-6"
        style={{ background: "var(--bg, #14101c)", borderLeft: "1px solid rgba(255,255,255,0.1)" }}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-[16px] font-semibold text-white/90 leading-snug">{lead.title}</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 shrink-0"><X size={18} /></button>
        </div>
        <div className="text-[12px] text-white/55 mb-3">
          {lead.company ?? "—"} · {lead.employment ?? "?"}{lead.location ? ` · ${lead.location}` : ""}
          {lead.salaryNum ? ` · ${money(lead.salaryNum)}/yr` : ""}
        </div>

        <div className="flex flex-wrap gap-1.5 mb-4">
          {(["researching", "approved", "sent", "parked", "dismissed"] as HireStatus[]).map((s) => (
            <button key={s} onClick={() => onStatus(lead.id, s)}
              className="text-[11px] px-2 py-1 rounded-md border transition-colors"
              style={lead.status === s
                ? { borderColor: "#fb923c", color: "#fb923c" }
                : { borderColor: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.55)" }}>
              {s === "dismissed" ? <span className="inline-flex items-center gap-1"><Archive size={11} /> dismiss</span>
                : s === "approved" ? <span className="inline-flex items-center gap-1"><Check size={11} /> approved</span>
                : s}
            </button>
          ))}
          {lead.url && (
            <a href={lead.url} target="_blank" rel="noreferrer"
              className="text-[11px] px-2 py-1 rounded-md border inline-flex items-center gap-1"
              style={{ borderColor: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.55)" }}>
              <ExternalLink size={11} /> posting
            </a>
          )}
        </div>

        {/* What the machine actually covers — the reason this lead is here at all. */}
        <div className="rounded-lg p-3 mb-4" style={{ background: `${m.accent}14` }}>
          <div className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: m.accent }}>
            {m.name} {m.built ? "· built" : "· not built yet"}
          </div>
          <p className="text-[12.5px] text-white/80 leading-relaxed">{m.loop}</p>
          <p className="text-[11.5px] text-white/50 mt-1.5">{m.coverage}</p>
          <p className="text-[11.5px] text-white/45 mt-1.5">{m.price} · {m.retainer}</p>
          {!m.built && <p className="text-[11.5px] mt-1.5" style={{ color: "#fbbf24" }}>{m.buildNote}</p>}
        </div>

        {read && (
          <div className="rounded-lg p-3 mb-4" style={{ background: "rgba(255,255,255,0.04)" }}>
            <div className="text-[11px] font-semibold uppercase tracking-wide mb-1 text-white/50">Fit read</div>
            <p className="text-[12.5px] text-white/75 leading-relaxed">{read}</p>
          </div>
        )}

        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-white/50">Outreach</span>
            <button onClick={writePitch} disabled={busy}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11.5px] font-medium disabled:opacity-40"
              style={{ background: "rgba(168,85,247,0.16)", color: "#c084fc" }}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {busy ? "Writing…" : pitch ? "Rewrite" : "Write pitch"}
            </button>
          </div>
          {err && <div className="text-[11.5px] mb-1.5" style={{ color: "#f87171" }}>{err}</div>}
          <textarea value={pitch} onChange={(e) => setPitch(e.target.value)} rows={9}
            placeholder="No outreach written yet."
            className="w-full rounded-lg p-2.5 text-[12.5px] text-white/85 leading-relaxed"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }} />
        </div>

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide mb-1.5 text-white/50">The posting</div>
          <div className="text-[12px] text-white/60 whitespace-pre-wrap leading-relaxed">{lead.desc || "—"}</div>
        </div>
      </div>
    </div>
  );
}
