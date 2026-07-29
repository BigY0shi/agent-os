"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Factory, RefreshCw, Loader2, ExternalLink, Sparkles, X, Archive, Building2, HelpCircle, Mail,
} from "lucide-react";
import { MACHINES, MACHINE_ORDER, machineFor, type MachineKey } from "@/lib/hireMachines";
import { HIRE_COLUMNS } from "@/lib/hireDeskColumns";
import type { HireLead, HireStatus } from "@/lib/hireDesk";
import ModelSettings from "./ModelSettings";

// Hire Engine — companies mid-hire for a role one of our machines already covers.
// The Deal Desk works freelance gigs; this works salaried job postings, because the
// pitch is different: you are displacing a salary line, not winning a project.
// Deliberately the same Kanban + drawer shape as the Deal Desk — one review muscle.

const money = (n: number | null) => (n == null ? null : n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`);
const scoreColor = (n: number) =>
  n >= 8 ? "#86efac" : n >= 6 ? "#fbbf24" : n >= 4 ? "#fb923c" : "#f87171";

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

function Chip({ label, value, title }: { label: string; value: number; title?: string }) {
  return (
    <span title={title} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-mono"
      style={{ background: "rgba(255,255,255,0.06)", color: scoreColor(value) }}>
      {label}{value}
    </span>
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

function Card({ lead, onOpen }: { lead: HireLead; onOpen: (l: HireLead) => void }) {
  const m = machineFor(lead.machineKey);
  const enriched = !!lead.firmo && !lead.firmo.error;
  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", lead.id)}
      onClick={() => onOpen(lead)}
      className="panel p-3 cursor-pointer transition hover:brightness-110 mb-2"
      style={{ borderLeft: `3px solid ${scoreColor(lead.composite)}` }}
    >
      <div className="text-[13px] font-medium leading-snug line-clamp-2">{lead.title}</div>
      <div className="text-[11px] text-white/55 mt-1">{lead.company ?? "—"}</div>
      <div className="flex flex-wrap gap-1 mt-2 items-center">
        <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded font-semibold"
          style={{ background: `${m.accent}22`, color: m.accent }}>{m.key}</span>
        <Chip label="F" value={lead.effectiveFit} title="Fit — how much of the role the machine covers" />
        <Chip label="E" value={lead.easiness} title="Ease — built machine vs first-client build" />
        <Chip label="W" value={lead.winnability} title="Win — salary buying-signal, adjusted by company size" />
        <span className="text-[10px] text-white/40 font-mono ml-auto self-center">{lead.composite}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        {lead.salaryNum && (
          <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
            style={{ background: "rgba(52,211,153,0.18)", color: "#34d399" }}>{money(lead.salaryNum)}/yr</span>
        )}
        {/* Enrichment cue: cyan = looked up, red = lookup failed, nothing = not enriched yet. */}
        {enriched && (
          <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded font-semibold"
            style={lead.firmo!.fit === "poor"
              ? { background: "rgba(248,113,113,0.18)", color: "#f87171" }
              : { background: "rgba(34,211,238,0.18)", color: "#22d3ee" }}
            title={lead.firmo!.fitWhy || "Company enriched"}>
            <Building2 size={9} /> {lead.firmo!.employees ?? lead.firmo!.fit}
          </span>
        )}
        {lead.firmo?.error && (
          <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
            style={{ background: "rgba(248,113,113,0.18)", color: "#f87171" }}
            title={lead.firmo.error}>enrich ✗</span>
        )}
        {lead.summary && (
          <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded font-semibold"
            style={{ background: "rgba(245,158,11,0.18)", color: "#f59e0b" }} title="Brief generated">
            <Sparkles size={9} /> brief
          </span>
        )}
        {/* Triage verdict — the stage-1 read. Skip cards keep the reason visible so
            you can overrule with the drawer's Generate brief button. */}
        {!lead.summary && lead.triage && (
          <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
            style={lead.triage.pursue
              ? { background: "rgba(52,211,153,0.18)", color: "#34d399" }
              : { background: "rgba(148,163,184,0.16)", color: "#94a3b8" }}
            title={lead.triage.reason}>
            {lead.triage.pursue ? "pursue" : "skip"}
          </span>
        )}
        {lead.pitch && (
          <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
            style={{ background: "rgba(168,85,247,0.18)", color: "#c084fc" }}>pitched</span>
        )}
        {lead.outreach?.ok && (
          <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded font-semibold"
            style={{ background: "rgba(34,211,238,0.18)", color: "#22d3ee" }}
            title={`Gmail draft → ${lead.outreach.to}`}>
            <Mail size={9} /> drafted
          </span>
        )}
      </div>
      <div className="flex items-center justify-between mt-2 text-[10.5px] text-white/40">
        <span>{lead.employment ?? ""}</span>
        <span>{lead.source} · {ago(lead.posted)}</span>
      </div>
    </div>
  );
}

// The last link in the loop: pitch → a DRAFT in the operator's Gmail. Never
// sends — review and send from Gmail. To defaults to the Hunter contact email.
function DraftRow({ lead, hasPitch, onSaved }: { lead: HireLead; hasPitch: boolean; onSaved: () => void }) {
  const [to, setTo] = useState(lead.firmo?.email || "");
  const [drafting, setDrafting] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => { setTo(lead.firmo?.email || ""); setMsg(""); }, [lead.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function draft() {
    setDrafting(true); setMsg("");
    try {
      const j = await (await fetch("/api/hire/draft", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: lead.id, to }),
      })).json();
      setMsg(j.ok ? `Draft created in Gmail → ${to}` : j.error || j.results?.[0]?.detail || "Draft failed");
      if (j.ok) onSaved();
    } catch (e) { setMsg((e as Error).message); }
    setDrafting(false);
  }

  if (lead.outreach?.ok) {
    return (
      <div className="mt-2 text-[11.5px] font-mono flex items-center gap-1.5" style={{ color: "#22d3ee" }}>
        <Mail size={12} /> Drafted in Gmail → {lead.outreach.to} · {ago(new Date(lead.outreach.at).toISOString())} — review and send from Gmail
      </div>
    );
  }
  return (
    <div className="mt-2">
      <div className="flex gap-2 items-center">
        <input value={to} onChange={(e) => setTo(e.target.value)}
          placeholder={lead.firmo ? "No contact email found — paste one" : "Enrich first, or paste a contact email"}
          className="flex-1 panel bg-transparent px-2.5 h-9 text-[12px] font-mono" />
        <button onClick={draft} disabled={drafting || !hasPitch || !to.trim()}
          title="Create a DRAFT in your Gmail with this pitch — nothing is sent; you review and send from Gmail"
          className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg text-[12px] font-medium disabled:opacity-40 shrink-0"
          style={{ background: "rgba(34,211,238,0.16)", color: "#22d3ee" }}>
          {drafting ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
          {drafting ? "Drafting…" : "Create Gmail draft"}
        </button>
      </div>
      {msg && <div className="text-[11.5px] mt-1.5" style={{ color: msg.startsWith("Draft created") ? "#22d3ee" : "#f87171" }}>{msg}</div>}
      {lead.outreach && !lead.outreach.ok && !msg && (
        <div className="text-[11.5px] mt-1.5 text-rose-300/80">Last attempt failed: {lead.outreach.detail}</div>
      )}
    </div>
  );
}

function Drawer({ lead, onClose, onStatus, onSaved }: {
  lead: HireLead; onClose: () => void;
  onStatus: (id: string, s: HireStatus) => void; onSaved: () => void;
}) {
  const m = machineFor(lead.machineKey);
  const [pitch, setPitch] = useState(lead.pitch || "");
  const [notes, setNotes] = useState(lead.notes || "");
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [briefing, setBriefing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { setPitch(lead.pitch || ""); setNotes(lead.notes || ""); }, [lead.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(action: string, value: string) {
    await fetch("/api/hire/action", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, id: lead.id, value }),
    }).catch(() => {});
  }

  async function writePitch() {
    setBusy(true); setErr("");
    try {
      const j = await (await fetch("/api/hire/pitch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: lead.id }),
      })).json();
      if (j.ok) { setPitch(j.pitch); onSaved(); }
      else setErr(j.error || "Could not write the pitch");
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  async function runBrief() {
    setBriefing(true); setErr("");
    try {
      const j = await (await fetch("/api/hire/brief", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: lead.id }),
      })).json();
      if (j.ok) onSaved();
      else setErr(j.error || "Could not generate the brief");
    } catch (e) { setErr((e as Error).message); }
    setBriefing(false);
  }

  async function submitAsk() {
    if (!question.trim()) return;
    setAsking(true); setErr("");
    try {
      const j = await (await fetch("/api/hire/ask", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: lead.id, question: question.trim() }),
      })).json();
      if (j.ok) { setQuestion(""); onSaved(); }
      else setErr(j.error || "The agent returned nothing");
    } catch (e) { setErr((e as Error).message); }
    setAsking(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div className="w-full max-w-[640px] h-full overflow-y-auto p-6"
        style={{ background: "var(--bg, #14101c)", borderLeft: "1px solid rgba(255,255,255,0.1)" }}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <h2 className="text-lg font-semibold leading-snug">{lead.title}</h2>
          <button onClick={onClose} className="text-white/50 hover:text-white shrink-0"><X size={18} /></button>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-3">
          <Chip label="Fit " value={lead.effectiveFit} title="How much of the role the machine covers" />
          <Chip label="Easy " value={lead.easiness} title="Built machine vs first-client build" />
          <Chip label="Win " value={lead.winnability} title="Salary buying-signal, adjusted by company size" />
          <span className="text-[11px] text-white/45 font-mono self-center">composite {lead.composite}</span>
        </div>

        <div className="text-[12.5px] text-white/55 mb-3">
          {lead.company ?? "—"} · {lead.employment ?? "?"}{lead.location ? ` · ${lead.location}` : ""}
          {lead.salaryNum ? ` · ${money(lead.salaryNum)}/yr` : ""} · {lead.source} · {ago(lead.posted)}
        </div>

        {lead.url && (
          <a href={lead.url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[12.5px] mb-4" style={{ color: "#d4a574" }}>
            Open the posting <ExternalLink size={13} />
          </a>
        )}

        {/* Status */}
        <div className="flex items-center gap-2 mb-4">
          <select value={lead.status} onChange={(e) => onStatus(lead.id, e.target.value as HireStatus)}
            className="panel px-2 py-1 text-[12px] bg-transparent">
            {["new", "researching", "approved", "sent", "parked", "dismissed"].map((s) => (
              <option key={s} value={s} style={{ background: "#14101c" }}>{s}</option>
            ))}
          </select>
          <button onClick={() => onStatus(lead.id, "dismissed")}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] transition"
            style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.6)" }}
            title="Remove this lead from the board">
            <Archive size={12} /> Dismiss
          </button>
        </div>

        {err && <div className="text-[12px] mb-3" style={{ color: "#f87171" }}>{err}</div>}

        {/* Project summary — quick "what is this" read before the full posting */}
        {lead.summary && (
          <div className="rounded-lg p-3 mb-4" style={{ background: "rgba(245,158,11,0.08)", borderLeft: "3px solid rgba(245,158,11,0.55)" }}>
            <div className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#f59e0b" }}>Project summary</div>
            <p className="text-[13px] text-white/85 leading-relaxed">{lead.summary}</p>
            {lead.why && <p className="text-[12px] text-white/60 leading-relaxed mt-2">{lead.why}</p>}
          </div>
        )}
        {!lead.summary && (
          <div className="rounded-lg p-3 mb-4 flex items-center justify-between gap-3" style={{ background: "rgba(255,255,255,0.03)" }}>
            <span className="text-[12px] text-white/50">
              {lead.triage
                ? <>Triage said <b style={{ color: lead.triage.pursue ? "#34d399" : "#94a3b8" }}>{lead.triage.pursue ? "pursue" : "skip"}</b>: {lead.triage.reason}{!lead.triage.pursue && " — overrule with the button if you disagree."}</>
                : "Not yet analysed — the next scan triages the whole board, or do this one now."}
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

        {/* Company firmographics, when enriched */}
        {lead.firmo && !lead.firmo.error && (
          <div className="rounded-lg p-3 mb-4" style={{ background: "rgba(34,211,238,0.10)" }}>
            <div className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: "#22d3ee" }}>
              Company · {lead.firmo.fit ?? "unknown"} fit
            </div>
            <div className="text-[12.5px] text-white/80">
              {lead.firmo.domain ?? "?"}
              {lead.firmo.employees ? ` · ${lead.firmo.employees} staff` : ""}
              {lead.firmo.type ? ` · ${lead.firmo.type}` : ""}
              {lead.firmo.foundedYear ? ` · founded ${lead.firmo.foundedYear}` : ""}
            </div>
            {lead.firmo.fitWhy && <p className="text-[11.5px] text-white/55 mt-1.5 leading-relaxed">{lead.firmo.fitWhy}</p>}
            {lead.firmo.email && <p className="text-[11.5px] text-white/45 mt-1.5">contact: {lead.firmo.email}</p>}
          </div>
        )}
        {lead.firmo?.error && (
          <div className="rounded-lg p-3 mb-4 text-[12px]" style={{ background: "rgba(248,113,113,0.10)", color: "#f87171" }}>
            Company lookup failed: {lead.firmo.error}
          </div>
        )}

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

        <Section title="Description">
          <div className="text-[12.5px] text-white/65 whitespace-pre-wrap leading-relaxed">{lead.desc || "—"}</div>
        </Section>

        <Section title="Proposal (editable)">
          <button onClick={writePitch} disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 mb-2 rounded-lg text-[12px] font-medium disabled:opacity-40"
            style={{ background: "rgba(52,211,153,0.16)", color: "#34d399" }}
            title="Write the augment-the-hire outreach for this posting">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {busy ? "Writing…" : pitch ? "Rewrite pitch" : "Write pitch"}
          </button>
          <textarea value={pitch} onChange={(e) => setPitch(e.target.value)} onBlur={() => act("pitch", pitch)}
            rows={8} placeholder="No outreach written yet."
            className="w-full panel bg-transparent p-2 text-[12.5px] leading-relaxed resize-y" />
          <DraftRow lead={lead} hasPitch={!!pitch.trim()} onSaved={onSaved} />
        </Section>

        {lead.approach && lead.approach !== "n/a" && (
          <Section title="Approach — how we'd do it">
            <p className="text-[12.5px] text-white/65 whitespace-pre-wrap leading-relaxed">{lead.approach}</p>
          </Section>
        )}

        {lead.crashCourse && lead.crashCourse !== "n/a" && (
          <Section title="Crash course — the stack">
            <p className="text-[12.5px] text-white/70 whitespace-pre-wrap leading-relaxed font-mono">{lead.crashCourse}</p>
          </Section>
        )}

        {lead.read && (
          <Section title="Fit read">
            <p className="text-[12.5px] text-white/75 leading-relaxed">{lead.read}</p>
          </Section>
        )}

        <Section title="Notes">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => act("notes", notes)}
            rows={3} placeholder="Your questions / observations…"
            className="w-full panel bg-transparent p-2 text-[12.5px] resize-y" />
        </Section>

        <Section title="Ask AI about this posting">
          <div className="flex gap-2">
            <input value={question} onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitAsk()}
              placeholder="e.g. would the CS engine handle their Zendesk setup?"
              className="flex-1 panel bg-transparent px-2 py-1.5 text-[12.5px]" />
            <button onClick={submitAsk} disabled={asking}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium"
              style={{ background: "rgba(34,211,238,0.16)", color: "#22d3ee" }}>
              {asking ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Ask
            </button>
          </div>
          {lead.answers.length > 0 && (
            <div className="mt-3 space-y-3">
              {lead.answers.map((a, i) => (
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

export default function HireEngine() {
  const [leads, setLeads] = useState<HireLead[]>([]);
  const [counts, setCounts] = useState<Record<string, { total: number; new: number }>>({});
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [filter, setFilter] = useState<MachineKey | "all">("all");
  const [enriching, setEnriching] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const j = await (await fetch("/api/hire/list", { cache: "no-store" })).json();
      if (j.ok) { setLeads(j.leads); setCounts(j.counts); }
    } catch { /* the empty state covers it */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Poll a running brief/pitch pass and live-refresh the board as analysis lands.
  // Drain passes can cover a whole board (~18s/lead), so watch for up to 30 min.
  const watchBatch = useCallback(async (kind: "brief" | "pitch") => {
    for (let i = 0; i < 360; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      try {
        const j = await (await fetch("/api/hire/brief-batch", { cache: "no-store" })).json();
        const job = kind === "brief" ? j.brief : j.pitch;
        if (!job) return;
        if (job.running) {
          if (kind === "brief" && job.phase === "triage") setNote("Triaging the board — pursue/skip on every card…");
          else setNote(`${kind === "brief" ? "Full analysis" : "Writing pitches"} ${job.done}/${job.total}…`);
          if (job.done > 0 && job.done % 3 === 0) await load();
        } else {
          if (kind === "brief" && (job.triaged || job.total)) {
            setNote(`Triaged ${job.triaged ?? 0} · pursuing ${job.pursued ?? 0} · briefed ${job.succeeded}/${job.total}${job.failed ? ` · ${job.failed} failed` : ""}`);
          } else if (job.total > 0) {
            setNote(`Pitched ${job.succeeded}/${job.total}${job.failed ? ` · ${job.failed} failed` : ""}`);
          }
          await load();
          return;
        }
      } catch { /* transient — keep polling */ }
    }
  }, [load]);

  async function rescan() {
    setScanning(true);
    setNote("Scanning job boards…");
    try {
      const j = await (await fetch("/api/hire/scrape", { method: "POST" })).json();
      setNote(j.ok ? `Scanned ${j.raw} postings · ${j.candidates} candidates${j.briefing ? ` · analysing ${j.briefing}…` : ""}` : j.error || "Scan failed");
      if (j.ok) {
        await load();
        // A scan auto-starts the brief pass (Deal Desk parity) — watch it land.
        if (j.briefing) void watchBatch("brief");
      }
    } catch (e) { setNote((e as Error).message); }
    setScanning(false);
  }

  const [draftingAll, setDraftingAll] = useState(false);

  // Batch Gmail drafts for the approved column. One claude session drafts them
  // all (MCP init is the slow part) — expect ~1-2 min, never anything sent.
  async function draftApproved() {
    setDraftingAll(true);
    setNote("Creating Gmail drafts for approved leads (nothing sends)…");
    try {
      const j = await (await fetch("/api/hire/draft", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      })).json();
      if (j.drafted != null) setNote(`Gmail drafts created: ${j.drafted}${j.failed ? ` · ${j.failed} failed` : ""} — review and send from Gmail`);
      else setNote(j.error || "Drafting failed");
      await load();
    } catch (e) { setNote((e as Error).message); }
    setDraftingAll(false);
  }

  async function enrichApproved() {
    setEnriching(true);
    setNote("Looking up company size for approved leads…");
    try {
      const j = await (await fetch("/api/hire/enrich", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      })).json();
      if (!j.ok) { setNote(j.error || "Enrichment failed"); }
      else {
        const poor = (j.results || []).filter((r: { fit?: string }) => r.fit === "poor").length;
        setNote(`Enriched ${j.enriched}${j.failed ? ` · ${j.failed} failed` : ""}${poor ? ` · ${poor} flagged too large` : ""}${j.pitching ? ` · writing ${j.pitching} pitches…` : ""}`);
        await load();
        // Enrichment chains the outreach pass for what just landed — watch it.
        if (j.pitching) void watchBatch("pitch");
      }
    } catch (e) { setNote((e as Error).message); }
    setEnriching(false);
  }

  async function setStatus(id: string, status: HireStatus) {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));
    await fetch("/api/hire/action", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "status", id, value: status }),
    }).catch(() => {});
    // "dismissed" removes it from the list server-side, so resync.
    if (status === "dismissed") { setOpenId(null); load(); }
  }

  const shown = useMemo(
    () => leads.filter((l) => (filter === "all" ? true : l.machineKey === filter)),
    [leads, filter],
  );

  // Main pipeline columns + a trailing Parked bucket (dismissed leaves the board entirely).
  const allColumns = useMemo(
    () => [...HIRE_COLUMNS, { key: "parked" as HireStatus, label: "Parked", accent: "#5a5d80" }],
    [],
  );
  const byCol = (key: HireStatus) => shown.filter((l) => l.status === key);

  const approvedCount = leads.filter((l) => l.status === "approved").length;
  // Drawer reads from `leads` so a brief / pitch / ask refresh shows up live.
  const selected = openId ? leads.find((l) => l.id === openId) || null : null;

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="flex items-center gap-3 flex-wrap mb-1">
        <div className="grid place-items-center w-9 h-9 rounded-xl" style={{ background: "rgba(251,146,60,0.14)", border: "1px solid rgba(251,146,60,0.4)", color: "#fb923c" }}>
          <Factory size={18} />
        </div>
        <h1 className="text-xl font-semibold">Hire Engine</h1>
        <span className="text-[12px] text-white/40">{leads.length} leads · {approvedCount} approved</span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={rescan} disabled={scanning}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium disabled:opacity-40"
            style={{ background: "rgba(251,146,60,0.16)", color: "#fb923c" }}
            title="Re-scan remotive / jobicy / himalayas for new postings (no account needed)">
            {scanning ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Scan job boards
          </button>
          <button onClick={enrichApproved} disabled={enriching}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium disabled:opacity-40"
            style={{ background: "rgba(34,211,238,0.16)", color: "#22d3ee" }}
            title="Look up headcount and public/private for leads you've approved, before writing outreach">
            {enriching ? <Loader2 size={13} className="animate-spin" /> : <Building2 size={13} />} Enrich approved
          </button>
          <button onClick={draftApproved} disabled={draftingAll}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium disabled:opacity-40"
            style={{ background: "rgba(34,211,238,0.16)", color: "#22d3ee" }}
            title="Create Gmail DRAFTS for approved + pitched leads with a contact email. Nothing sends — you review in Gmail.">
            {draftingAll ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />} Draft approved
          </button>
          <button onClick={load}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] panel hover:brightness-110">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Reload
          </button>
          <ModelSettings section="hire" title="Hire Engine models" accent="#fb923c"
            fields={[
              { key: "triageModel", label: "Triage sweep", placeholder: "claude-haiku-4-5", hint: "Cheap pursue/skip pass over the whole board (12 postings per call)." },
              { key: "briefModel", label: "Brief + pitch writer", placeholder: "blank = pinned CLAUDE_MODEL", hint: "The full analysis and outreach writer." },
            ]} />
        </div>
      </div>
      <p className="text-sm text-white/45 mb-4">
        Companies hiring a human for work a machine already does — drag to move stages, open a card for the brief, pitch, and notes. The offer is to augment the hire, not replace them.
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

      {!loading && !leads.length && (
        <div className="panel p-6 text-center text-white/50 text-[13px]">
          No candidates yet. Hit <span className="text-white/80">Scan job boards</span> to pull current postings.
        </div>
      )}

      <div className="flex gap-3 overflow-x-auto pb-4">
        {allColumns.map((col) => {
          const items = byCol(col.key);
          return (
            <div key={col.key}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { const id = e.dataTransfer.getData("text/plain"); if (id) setStatus(id, col.key); }}
              className="flex-shrink-0 w-[260px]">
              <div className="flex items-center gap-2 mb-2 px-1">
                <span className="h-2 w-2 rounded-full" style={{ background: col.accent }} />
                <span className="text-[12px] font-semibold">{col.label}</span>
                <span className="text-[11px] text-white/35">{items.length}</span>
              </div>
              <div className="min-h-[120px] rounded-xl p-1.5" style={{ background: "rgba(255,255,255,0.02)" }}>
                {items.map((l) => <Card key={l.id} lead={l} onOpen={(x) => setOpenId(x.id)} />)}
              </div>
            </div>
          );
        })}
      </div>

      {selected && <Drawer lead={selected} onClose={() => setOpenId(null)} onStatus={setStatus} onSaved={load} />}
    </div>
  );
}
