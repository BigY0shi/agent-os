"use client";

// MARKETING HUB — /marketing. Plan (council) → Produce (persona-injected CLI drafts)
// → Deploy (approval-gated queue; nothing publishes without an explicit approve).
// Backend: src/lib/marketing.ts + /api/marketing/*. Matches the Pipeline design
// system: panel cards, right-side Drawer, busy states with rotating status lines.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Megaphone, ListChecks, Users, X, Check, Loader2, Square, Archive, Plus,
  ChevronDown, ChevronRight, ExternalLink, Wand2, Pencil, CalendarDays, Send,
  Sparkles, RefreshCw, Lightbulb, ArrowRight, Eraser, ChevronLeft, MonitorPlay,
  Clapperboard, FileText, MessageSquare,
} from "lucide-react";
import ConfigMenu, { useSettings, Field, TextInput, SaveBar } from "./ConfigMenu";
import AgentPicker from "./AgentPicker";

// ── client mirror of src/lib/marketing.ts (server module imports node:fs) ────
type Business = "payloadsco" | "launchworks" | "cobalt";
type Channel = "youtube" | "short-video" | "text-post" | "blog";
type ItemStatus = "idea" | "drafted" | "approved" | "scheduled" | "published";
type CampaignStatus = "draft" | "planned" | "live" | "done";
interface ContentItem {
  id: string; channel: Channel; platform?: string; title: string; brief: string;
  draft?: string; status: ItemStatus; scheduledFor?: string; publishedUrl?: string; updated?: string;
}
interface Campaign {
  slug: string; title: string; business: Business; goal: string; angle?: string;
  channels: Channel[]; status: CampaignStatus; plan?: string; items: ContentItem[]; created: string; updated?: string;
  color?: string; // SPEC-F J1.1 — stable palette colour, server-assigned on read
}
interface Persona {
  id: string; name: string; business: Business; audience: string; tone: string;
  rules: string[]; banned: string[]; cta: string; examples?: string;
}
interface QueueEntry { campaign: string; slug: string; business: Business; item: ContentItem }
interface MarketingCfg { agent?: string; council?: boolean; criticAgent?: string; textPlatforms?: string[]; ideateBackend?: "local" | "buzz"; buzzChannel?: string }
type ItemPayload = {
  action: "draft" | "approve" | "unapprove" | "schedule" | "published" | "edit";
  agent?: string; feedback?: string; draft?: string; publishedUrl?: string; scheduledFor?: string;
};
interface IdeateMsg { role: "user" | "assistant"; text: string }
// What /api/marketing/ideate "promote" hands back — pre-fills the Campaigns create form.
interface CampaignDraft { title: string; goal: string; angle: string; channels: Channel[]; business: Business }

const BUSINESSES: { id: Business; label: string }[] = [
  { id: "payloadsco", label: "PayloadsCO" },
  { id: "launchworks", label: "Launchworks / Deal Desk" },
  { id: "cobalt", label: "Cobalt Research Supply" },
];
const CHANNELS: { id: Channel; label: string }[] = [
  { id: "youtube", label: "YouTube (long-form)" },
  { id: "short-video", label: "Short video (LinkedIn + Shorts)" },
  { id: "text-post", label: "Text posts (LinkedIn / X / FB)" },
  { id: "blog", label: "Blog / SEO (draft-only)" },
];

// Hub accent — pink, unused by any Sidebar neighbor (#f472b6 is OpenClaw's).
const ACCENT = "#ec4899";
const ACCENT_DIM = "rgba(236,72,153,0.16)";

const BUSINESS_COLOR: Record<Business, string> = { payloadsco: "#22d3ee", launchworks: "#34d399", cobalt: "#a78bfa" };
const CHANNEL_COLOR: Record<Channel, string> = { youtube: "#ef4444", "short-video": "#fb923c", "text-post": "#60a5fa", blog: "#a3e635" };
const STATUS_COLOR: Record<ItemStatus, string> = { idea: "#94a3b8", drafted: "#fbbf24", approved: "#34d399", scheduled: "#22d3ee", published: "#a3e635" };
const CAMPAIGN_COLOR: Record<CampaignStatus, string> = { draft: "#94a3b8", planned: "#22d3ee", live: "#34d399", done: "#a3e635" };

// Rotating status lines for the two LONG synchronous calls (1–4 min each).
const PLAN_STATUS = [
  "lead planner drafting the strategy…",
  "adversarial critic attacking the plan…",
  "revising against the critique…",
  "laying out the dated content calendar…",
  "council still deliberating — long plans take a few minutes…",
];
const DRAFT_STATUS = [
  "injecting the brand voice…",
  "agent writing the draft…",
  "checking the hard-banned phrase list…",
  "polishing the deliverable…",
  "still writing — long drafts take a minute or two…",
];

const FIELD = "w-full bg-[rgba(0,0,0,0.2)] rounded-lg px-3 py-2 text-[12.5px] outline-none resize-none text-[var(--fg)] placeholder:text-[var(--fg-dimmer)] border border-[var(--panel-border)]";
const SELECT_STYLE: React.CSSProperties = { background: "var(--bg, #0b0713)", border: "1px solid var(--panel-border)", color: "var(--fg)" };

function ago(iso: string): string {
  const s = Math.floor((Date.now() - Date.parse(iso)) / 1000);
  if (isNaN(s)) return "";
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function fmtDay(d: string): string {
  const t = new Date(`${d}T00:00:00`);
  if (isNaN(t.getTime())) return d;
  return t.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
function businessLabel(b: Business): string {
  return BUSINESSES.find((x) => x.id === b)?.label || b;
}
function useRotating(active: boolean, lines: string[]): string {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) { setI(0); return; }
    const t = setInterval(() => setI((n) => (n + 1) % lines.length), 3400);
    return () => clearInterval(t);
  }, [active, lines]);
  return lines[i % lines.length];
}

function Chip({ color, children, title }: { color: string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className="text-[9.5px] font-mono px-1.5 py-0.5 rounded-full border whitespace-nowrap"
      style={{ borderColor: `${color}66`, color, background: `${color}14` }}>{children}</span>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
export default function MarketingHub() {
  const [tab, setTab] = useState<"ideate" | "campaigns" | "calendar" | "queue" | "personas">("campaigns");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, "plan" | "draft" | "act" | undefined>>({});
  const ctrlRef = useRef<Record<string, AbortController>>({});
  const { settings } = useSettings();
  const mk = (settings?.marketing ?? {}) as MarketingCfg;
  const defaultAgent = mk.agent || "claude";

  // ── Ideate (spitfire chat) — lives up here so tab flips keep the riff; session-only ──
  const [ideateMsgs, setIdeateMsgs] = useState<IdeateMsg[]>([]);
  const [ideateBusiness, setIdeateBusiness] = useState<Business | "">("");
  const [ideateBusy, setIdeateBusy] = useState<"chat" | "promote" | null>(null);
  // A promoted riff lands here → pre-fills the Campaigns create form (fresh object each time).
  const [createPrefill, setCreatePrefill] = useState<CampaignDraft | null>(null);
  // Calendar chip deep-link: which item the drawer should auto-expand.
  const [focusItemId, setFocusItemId] = useState<string | null>(null);

  const refreshCampaigns = useCallback(async () => {
    try {
      const r = await fetch("/api/marketing/campaigns", { cache: "no-store" });
      const j = await r.json();
      if (Array.isArray(j.campaigns)) setCampaigns(j.campaigns);
    } catch { /* offline */ }
  }, []);
  const refreshQueue = useCallback(async () => {
    try {
      const r = await fetch("/api/marketing/queue", { cache: "no-store" });
      const j = await r.json();
      if (Array.isArray(j.queue)) setQueue(j.queue);
    } catch { /* offline */ }
  }, []);
  const refreshPersonas = useCallback(async () => {
    try {
      const r = await fetch("/api/marketing/personas", { cache: "no-store" });
      const j = await r.json();
      if (Array.isArray(j.personas)) setPersonas(j.personas);
    } catch { /* offline */ }
  }, []);
  useEffect(() => { refreshCampaigns(); refreshQueue(); refreshPersonas(); }, [refreshCampaigns, refreshQueue, refreshPersonas]);

  const putCampaign = useCallback((c: Campaign) => {
    setCampaigns((xs) => {
      const i = xs.findIndex((x) => x.slug === c.slug);
      if (i === -1) return [c, ...xs];
      const next = [...xs]; next[i] = c; return next;
    });
  }, []);

  async function createCampaign(f: { title: string; business: Business; goal: string; angle: string; channels: Channel[] }): Promise<boolean> {
    if (creating) return false;
    setCreating(true); setErr(null);
    try {
      const r = await fetch("/api/marketing/campaigns", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: f.title, business: f.business, goal: f.goal, angle: f.angle || undefined, channels: f.channels }),
      });
      const j = await r.json().catch(() => ({}));
      if (j.ok && j.campaign) { putCampaign(j.campaign as Campaign); setSelectedSlug((j.campaign as Campaign).slug); return true; }
      setErr(j.error || "Couldn't create the campaign.");
    } catch { setErr("Couldn't reach the server."); } finally { setCreating(false); }
    return false;
  }

  async function exileCampaign(slug: string) {
    // Exile, never delete — the campaign file moves to marketing/.exile/<stamp>/ (recoverable).
    if (!window.confirm("Remove this campaign? Its file is exiled to marketing/.exile (recoverable), never deleted.")) return;
    try {
      const r = await fetch("/api/marketing/campaigns", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "exile", slug }) });
      const j = await r.json().catch(() => ({}));
      if (!j.ok) { setErr(j.error || "Couldn't remove that campaign."); return; }
      setSelectedSlug(null);
    } catch { setErr("Couldn't reach the server."); }
    await refreshCampaigns(); await refreshQueue();
  }

  // LONG (1–4 min): the planning council. Synchronous fetch + Stop via abort.
  const planCampaign = useCallback(async (slug: string) => {
    const key = `plan:${slug}`;
    if (ctrlRef.current[key]) return;
    setBusy((b) => ({ ...b, [key]: "plan" })); setErr(null);
    const c = new AbortController(); ctrlRef.current[key] = c;
    try {
      const r = await fetch("/api/marketing/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug }), signal: c.signal });
      const j = await r.json().catch(() => ({}));
      if (j.ok && j.campaign) putCampaign(j.campaign as Campaign);
      else if (!c.signal.aborted) setErr(j.error || "The planning council returned nothing usable — try again.");
    } catch { if (!c.signal.aborted) setErr("Couldn't reach the planning council."); }
    delete ctrlRef.current[key];
    setBusy((b) => ({ ...b, [key]: undefined }));
    refreshQueue();
  }, [putCampaign, refreshQueue]);

  // Everything you can do to one item. "draft" is LONG (1–4 min); the rest are quick.
  const itemAction = useCallback(async (slug: string, itemId: string, payload: ItemPayload) => {
    const key = payload.action === "draft" ? `draft:${itemId}` : `act:${itemId}`;
    if (ctrlRef.current[key]) return;
    setBusy((b) => ({ ...b, [key]: payload.action === "draft" ? "draft" : "act" })); setErr(null);
    const c = new AbortController(); ctrlRef.current[key] = c;
    try {
      const r = await fetch("/api/marketing/item", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, itemId, ...payload }), signal: c.signal });
      const j = await r.json().catch(() => ({}));
      if (j.ok && j.campaign) putCampaign(j.campaign as Campaign);
      else if (!c.signal.aborted) setErr(j.error || "That didn't go through — try again.");
    } catch { if (!c.signal.aborted) setErr("Couldn't reach the server."); }
    delete ctrlRef.current[key];
    setBusy((b) => ({ ...b, [key]: undefined }));
    refreshQueue();
  }, [putCampaign, refreshQueue]);

  function stop(key: string) {
    try { ctrlRef.current[key]?.abort(); } catch { /* already gone */ }
    delete ctrlRef.current[key];
    setBusy((b) => ({ ...b, [key]: undefined }));
  }

  // LONG (15–60s+): one spitfire round. History is component state only — nothing persists.
  const ideateSend = useCallback(async (text: string, agent: string) => {
    const key = "ideate:chat";
    if (ctrlRef.current[key] || ideateBusy) return;
    const history = ideateMsgs; // backend wants history WITHOUT the current prompt
    setIdeateMsgs((ms) => [...ms, { role: "user", text }]);
    setIdeateBusy("chat"); setErr(null);
    const c = new AbortController(); ctrlRef.current[key] = c;
    try {
      const r = await fetch("/api/marketing/ideate", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: text, messages: history, business: ideateBusiness || undefined, agent }),
        signal: c.signal,
      });
      const j = await r.json().catch(() => ({}));
      if (j.ok && j.reply) setIdeateMsgs((ms) => [...ms, { role: "assistant", text: String(j.reply) }]);
      else if (!c.signal.aborted) setErr(j.error || "The riff partner returned nothing — try again.");
    } catch { if (!c.signal.aborted) setErr("Couldn't reach the server."); }
    delete ctrlRef.current[key];
    setIdeateBusy(null);
  }, [ideateBusy, ideateMsgs, ideateBusiness]);

  // LONG: distill the whole riff → switch to Campaigns with the create form pre-filled.
  const ideatePromote = useCallback(async (agent: string) => {
    const key = "ideate:promote";
    if (ctrlRef.current[key] || ideateBusy || ideateMsgs.length < 2) return;
    setIdeateBusy("promote"); setErr(null);
    const c = new AbortController(); ctrlRef.current[key] = c;
    try {
      const r = await fetch("/api/marketing/ideate", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "promote", messages: ideateMsgs, business: ideateBusiness || undefined, agent }),
        signal: c.signal,
      });
      const j = await r.json().catch(() => ({}));
      if (j.ok && j.draft) {
        const d = j.draft as CampaignDraft;
        setCreatePrefill({
          title: String(d.title || ""), goal: String(d.goal || ""), angle: String(d.angle || ""),
          channels: (Array.isArray(d.channels) ? d.channels : []).filter((ch) => CHANNELS.some((x) => x.id === ch)),
          business: BUSINESSES.some((b) => b.id === d.business) ? d.business : "launchworks",
        });
        setTab("campaigns");
      } else if (!c.signal.aborted) setErr(j.error || "Couldn't distill the riff — try again.");
    } catch { if (!c.signal.aborted) setErr("Couldn't reach the server."); }
    delete ctrlRef.current[key];
    setIdeateBusy(null);
  }, [ideateBusy, ideateMsgs, ideateBusiness]);

  function stopIdeate() {
    for (const key of ["ideate:chat", "ideate:promote"]) {
      try { ctrlRef.current[key]?.abort(); } catch { /* already gone */ }
      delete ctrlRef.current[key];
    }
    setIdeateBusy(null);
  }

  const selected = selectedSlug ? campaigns.find((c) => c.slug === selectedSlug) ?? null : null;

  const TABS: { key: typeof tab; label: string; icon: React.ReactNode }[] = [
    { key: "ideate", label: "Ideate", icon: <Lightbulb size={14} /> },
    { key: "campaigns", label: "Campaigns", icon: <Megaphone size={14} /> },
    { key: "calendar", label: "Calendar", icon: <CalendarDays size={14} /> },
    { key: "queue", label: `Approval Queue (${queue.length})`, icon: <ListChecks size={14} /> },
    { key: "personas", label: "Personas", icon: <Users size={14} /> },
  ];

  return (
    <div className="relative">
      {/* Header */}
      <div className="mb-1 flex items-end gap-3 flex-wrap">
        <h1 className="text-2xl font-medium tracking-tight">Marketing <span style={{ color: ACCENT }}>Hub</span></h1>
        <span className="text-[12.5px] text-[var(--fg-dim)] font-mono pb-1">plan → produce → approve · nothing ships without you</span>
        <div className="ml-auto flex items-center gap-2">
          <MarketingSettings />
        </div>
      </div>
      <p className="text-[12.5px] text-[var(--fg-dimmer)] mb-4">
        Campaigns for your three brands: a planning council writes the strategy + a dated calendar, your CLI agents draft each piece in the brand voice, and every draft waits at the approval gate.
      </p>

      {/* Pill tabs (hermes pattern) */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-[12.5px] transition"
              style={{ background: active ? ACCENT_DIM : "transparent", borderColor: active ? ACCENT : "var(--panel-border)", color: active ? "var(--fg)" : "var(--fg-dim)" }}>
              {t.icon}{t.label}
            </button>
          );
        })}
      </div>

      {/* Error banner (PipelineView pattern) */}
      {err && (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl px-4 py-3" style={{ border: "1px solid rgba(244,63,94,0.4)", background: "rgba(244,63,94,0.08)" }}>
          <span className="text-[13px] flex-1" style={{ color: "#fca5b4" }}>{err}</span>
          <button onClick={() => setErr(null)} className="text-[var(--fg-dim)] hover:text-[var(--fg)]"><X size={15} /></button>
        </div>
      )}

      {tab === "ideate" && (
        <IdeateTab
          messages={ideateMsgs}
          busy={ideateBusy}
          business={ideateBusiness}
          defaultAgent={defaultAgent}
          buzzChannel={mk.ideateBackend === "buzz" ? mk.buzzChannel || "marketing-ideas" : null}
          onBusiness={setIdeateBusiness}
          onSend={ideateSend}
          onPromote={ideatePromote}
          onStop={stopIdeate}
          onClear={() => setIdeateMsgs([])}
        />
      )}

      {tab === "campaigns" && (
        <>
          <CreateForm onCreate={createCampaign} creating={creating} prefill={createPrefill} />
          {campaigns.length === 0 ? (
            <div className="panel p-12 text-center text-[13px] text-[var(--fg-dimmer)]">No campaigns yet — give the first one a title and a goal above, then let the council plan it.</div>
          ) : (
            <div className="grid gap-3 pb-6" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
              {campaigns.map((c) => <CampaignCard key={c.slug} c={c} planBusy={busy[`plan:${c.slug}`] === "plan"} onOpen={() => setSelectedSlug(c.slug)} />)}
            </div>
          )}
        </>
      )}

      {tab === "calendar" && (
        <CalendarTab campaigns={campaigns} onOpenItem={(slug, itemId) => { setFocusItemId(itemId); setSelectedSlug(slug); }} />
      )}

      {tab === "queue" && (
        <QueueTab queue={queue} busy={busy} defaultAgent={defaultAgent} onItem={itemAction} onStop={stop} onOpenCampaign={(slug) => { setSelectedSlug(slug); setTab("campaigns"); }} />
      )}

      {tab === "personas" && <PersonasTab personas={personas} onSaved={setPersonas} />}

      {/* Campaign drawer */}
      <AnimatePresence>
        {selected && (
          <CampaignDrawer
            c={selected}
            busy={busy}
            defaultAgent={defaultAgent}
            focusItemId={focusItemId}
            onClose={() => { setSelectedSlug(null); setFocusItemId(null); }}
            onPlan={() => planCampaign(selected.slug)}
            onStop={stop}
            onItem={(itemId, payload) => itemAction(selected.slug, itemId, payload)}
            onRemove={() => exileCampaign(selected.slug)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Campaigns tab ────────────────────────────────────────────────────────────
function CreateForm({ onCreate, creating, prefill }: { onCreate: (f: { title: string; business: Business; goal: string; angle: string; channels: Channel[] }) => Promise<boolean>; creating: boolean; prefill?: CampaignDraft | null }) {
  const [title, setTitle] = useState("");
  const [business, setBusiness] = useState<Business>("payloadsco");
  const [goal, setGoal] = useState("");
  const [angle, setAngle] = useState("");
  const [showAngle, setShowAngle] = useState(false);
  const [channels, setChannels] = useState<Channel[]>(CHANNELS.map((c) => c.id));
  const canSubmit = !!title.trim() && !!goal.trim() && channels.length > 0 && !creating;

  // A promoted riff pre-fills the form. Each promote makes a fresh object, so the effect re-applies.
  useEffect(() => {
    if (!prefill) return;
    setTitle(prefill.title);
    setBusiness(prefill.business);
    setGoal(prefill.goal);
    setAngle(prefill.angle);
    setShowAngle(!!prefill.angle);
    setChannels(prefill.channels.length ? prefill.channels : CHANNELS.map((c) => c.id));
  }, [prefill]);

  function toggleChannel(id: Channel) {
    setChannels((cs) => (cs.includes(id) ? cs.filter((x) => x !== id) : [...cs, id]));
  }
  async function submit() {
    if (!canSubmit) return;
    const ok = await onCreate({ title: title.trim(), business, goal: goal.trim(), angle: angle.trim(), channels });
    if (ok) { setTitle(""); setGoal(""); setAngle(""); setShowAngle(false); setChannels(CHANNELS.map((c) => c.id)); }
  }

  return (
    <div className="panel p-3.5 mb-5" style={{ borderColor: "rgba(236,72,153,0.35)", background: "rgba(236,72,153,0.05)" }}>
      <div className="flex gap-2 items-center flex-wrap">
        <Megaphone size={16} style={{ color: ACCENT }} className="shrink-0" />
        <input value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="Campaign title — e.g. 'CYD launch week'"
          className="flex-1 min-w-[220px] bg-transparent text-[14px] outline-none text-[var(--fg)] placeholder:text-[var(--fg-dimmer)]" />
        <select value={business} onChange={(e) => setBusiness(e.target.value as Business)}
          className="text-[12px] rounded-md px-2 py-1.5 outline-none shrink-0" style={SELECT_STYLE}>
          {BUSINESSES.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
        <button onClick={submit} disabled={!canSubmit}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-semibold disabled:opacity-40 shrink-0"
          style={{ background: ACCENT, color: "#1c0412" }}>
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create
        </button>
      </div>

      <div className="mt-2.5 pl-6 space-y-2">
        <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={2}
          placeholder="Goal — what does success look like? (required)" className={FIELD} />
        {showAngle ? (
          <textarea value={angle} onChange={(e) => setAngle(e.target.value)} rows={2}
            placeholder="Angle / constraints — positioning, must-mentions, hard limits… (optional)" className={FIELD} />
        ) : (
          <button onClick={() => setShowAngle(true)} className="inline-flex items-center gap-1 text-[11.5px]" style={{ color: ACCENT }}>
            <Plus size={13} /> Add an angle (optional)
          </button>
        )}
        <div className="flex items-center gap-3 flex-wrap pt-0.5">
          {CHANNELS.map((ch) => (
            <label key={ch.id} className="inline-flex items-center gap-1.5 text-[11.5px] cursor-pointer select-none" style={{ color: channels.includes(ch.id) ? "var(--fg-dim)" : "var(--fg-dimmer)" }}>
              <input type="checkbox" checked={channels.includes(ch.id)} onChange={() => toggleChannel(ch.id)} style={{ accentColor: CHANNEL_COLOR[ch.id] }} />
              {ch.label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

function CampaignCard({ c, planBusy, onOpen }: { c: Campaign; planBusy: boolean; onOpen: () => void }) {
  const published = c.items.filter((i) => i.status === "published").length;
  return (
    <motion.div layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} onClick={onOpen}
      className="rounded-xl border p-3.5 cursor-pointer transition hover:border-[var(--panel-border-hot)]"
      style={{ borderColor: "var(--panel-border)", background: "rgba(255,255,255,0.015)", borderLeft: `2px solid ${BUSINESS_COLOR[c.business]}` }}>
      <div className="text-[13px] font-medium text-[var(--fg)] leading-snug">{c.title}</div>
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <Chip color={BUSINESS_COLOR[c.business]}>{businessLabel(c.business)}</Chip>
        <Chip color={CAMPAIGN_COLOR[c.status]}>{c.status}</Chip>
        {planBusy && (
          <span className="inline-flex items-center gap-1 text-[9.5px] font-mono" style={{ color: "#fbbf24" }}>
            <Loader2 size={10} className="animate-spin" /> planning…
          </span>
        )}
      </div>
      <div className="flex items-center justify-between mt-2.5 text-[11px] text-[var(--fg-dimmer)]">
        <span className="font-mono">{c.items.length ? `${published}/${c.items.length} published` : "no calendar yet"}</span>
        <span>{ago(c.created)}</span>
      </div>
      {/* SPEC-F J1.1 — the full campaign page. Additive: the card still opens
          the drawer on click, so nothing about the existing flow changes.
          stopPropagation keeps the drawer from opening behind the navigation. */}
      <Link href={`/marketing/${c.slug}`} onClick={(e) => e.stopPropagation()}
        className="mt-2 inline-flex items-center gap-1 text-[11px] hover:underline"
        style={{ color: c.color ?? BUSINESS_COLOR[c.business] }}>
        Open campaign <ArrowRight size={11} />
      </Link>
    </motion.div>
  );
}

// ── Campaign drawer (PipelineView Drawer pattern) ────────────────────────────
function CampaignDrawer({ c, busy, defaultAgent, focusItemId, onClose, onPlan, onStop, onItem, onRemove }: {
  c: Campaign;
  busy: Record<string, "plan" | "draft" | "act" | undefined>;
  defaultAgent: string;
  /** Calendar deep-link: this item renders expanded and scrolls into view. */
  focusItemId?: string | null;
  onClose: () => void;
  onPlan: () => void;
  onStop: (key: string) => void;
  onItem: (itemId: string, payload: ItemPayload) => void;
  onRemove: () => void;
}) {
  const planBusy = busy[`plan:${c.slug}`] === "plan";
  const planLine = useRotating(planBusy, PLAN_STATUS);
  const groups = groupBySchedule(c.items);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <motion.div initial={{ x: 40 }} animate={{ x: 0 }} exit={{ x: 40 }} onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[620px] h-full overflow-y-auto p-6" style={{ background: "var(--bg-panel, #14101a)", borderLeft: "1px solid var(--panel-border)" }}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <Chip color={BUSINESS_COLOR[c.business]}>{businessLabel(c.business)}</Chip>
              <Chip color={CAMPAIGN_COLOR[c.status]}>{c.status}</Chip>
            </div>
            <h2 className="text-[19px] font-semibold mt-1 text-[var(--fg)]">{c.title}</h2>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onRemove} title="Remove campaign — the file is exiled to marketing/.exile (recoverable), never deleted"
              className="p-1.5 rounded-lg hover:bg-[var(--bg-mid)] text-[var(--fg-dimmer)] hover:text-[#fb7185]"><Archive size={15} /></button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg-mid)] text-[var(--fg-dim)]"><X size={16} /></button>
          </div>
        </div>

        <div className="text-[10.5px] font-mono text-[var(--fg-dimmer)] mb-4 flex items-center gap-1.5 flex-wrap">
          <CalendarDays size={11} /> created {ago(c.created)} · channels: {c.channels.join(", ")}
        </div>

        <DrawerSection title="Goal" body={c.goal} />
        {c.angle && <DrawerSection title="Angle" body={c.angle} />}

        {/* Plan — the council's strategy + calendar */}
        {planBusy ? (
          <div className="mb-5 rounded-xl border p-4" style={{ borderColor: "rgba(251,191,36,0.4)", background: "rgba(251,191,36,0.05)" }}>
            <div className="flex items-center gap-2 text-[12.5px] font-semibold" style={{ color: "#fbbf24" }}>
              <Loader2 size={14} className="animate-spin" /> Planning council running
            </div>
            <div className="text-[12px] font-mono mt-1.5 text-[var(--fg-dim)]">{planLine}</div>
            <div className="text-[10.5px] mt-1 text-[var(--fg-dimmer)]">lead plan → adversarial critic → revision · typically 1–4 minutes</div>
            <button onClick={() => onStop(`plan:${c.slug}`)}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold"
              style={{ background: "rgba(244,63,94,0.12)", color: "#f43f5e", border: "1px solid rgba(244,63,94,0.4)" }}>
              <Square size={11} /> Stop
            </button>
          </div>
        ) : !c.plan ? (
          <div className="mb-5 rounded-xl border p-4" style={{ borderColor: "rgba(236,72,153,0.4)", background: "rgba(236,72,153,0.05)" }}>
            <div className="text-[12.5px] text-[var(--fg-dim)] mb-2.5">No plan yet. The council writes the strategy and a dated content calendar for every channel in scope.</div>
            <button onClick={onPlan}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-semibold"
              style={{ background: ACCENT_DIM, color: ACCENT, border: `1px solid ${ACCENT}66` }}>
              <Sparkles size={14} /> Plan campaign
            </button>
          </div>
        ) : (
          <div className="mb-5">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)]">Campaign plan</div>
              <button onClick={() => { if (window.confirm("Re-run the council? This REPLACES the plan, the calendar and every item (drafts included).")) onPlan(); }}
                title="Re-run the planning council — replaces the calendar and all items"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px]" style={{ color: "var(--fg-dim)", border: "1px solid var(--panel-border)" }}>
                <RefreshCw size={10} /> Re-plan
              </button>
            </div>
            <div className="text-[12px] font-mono leading-relaxed whitespace-pre-wrap text-[var(--fg-dim)] rounded-lg border p-3 max-h-[260px] overflow-y-auto"
              style={{ borderColor: "var(--panel-border)", background: "rgba(0,0,0,0.2)" }}>{c.plan}</div>
          </div>
        )}

        {/* Calendar — items grouped by scheduled date */}
        {c.items.length > 0 && (
          <div className="mb-4">
            <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-2">Content calendar · {c.items.length} pieces</div>
            {groups.map((g) => (
              <div key={g.label} className="mb-3">
                <div className="text-[10.5px] font-mono mb-1.5 flex items-center gap-1.5" style={{ color: g.date ? "#22d3ee" : "var(--fg-dimmer)" }}>
                  <CalendarDays size={10} /> {g.label}
                </div>
                <div className="space-y-2">
                  {g.items.map((it) => (
                    <ItemRow key={it.id} it={it}
                      busyKind={busy[`draft:${it.id}`] ? "draft" : busy[`act:${it.id}`] ? "act" : undefined}
                      defaultAgent={defaultAgent}
                      initiallyOpen={it.id === focusItemId}
                      onItem={(payload) => onItem(it.id, payload)}
                      onStop={() => onStop(`draft:${it.id}`)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {c.plan && c.items.length === 0 && !planBusy && (
          <div className="mb-4 text-[12px] text-[var(--fg-dimmer)]">The council returned no calendar items — re-plan to try again.</div>
        )}
      </motion.div>
    </motion.div>
  );
}

function DrawerSection({ title, body }: { title: string; body: string }) {
  return (
    <div className="mb-4">
      <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-1.5">{title}</div>
      <div className="text-[13px] leading-relaxed whitespace-pre-wrap text-[var(--fg-dim)]">{body}</div>
    </div>
  );
}

function groupBySchedule(items: ContentItem[]): Array<{ label: string; date?: string; items: ContentItem[] }> {
  const sorted = [...items].sort((a, b) => (a.scheduledFor || "9999-99-99").localeCompare(b.scheduledFor || "9999-99-99"));
  const out: Array<{ label: string; date?: string; items: ContentItem[] }> = [];
  for (const it of sorted) {
    const label = it.scheduledFor ? fmtDay(it.scheduledFor) : "Unscheduled";
    const last = out[out.length - 1];
    if (last && last.label === label) last.items.push(it);
    else out.push({ label, date: it.scheduledFor, items: [it] });
  }
  return out;
}

// ── One content item: chips + per-state actions ──────────────────────────────
function ItemRow({ it, busyKind, defaultAgent, initiallyOpen, onItem, onStop }: {
  it: ContentItem;
  busyKind?: "draft" | "act";
  defaultAgent: string;
  /** Calendar deep-link: start expanded and scroll into view. */
  initiallyOpen?: boolean;
  onItem: (payload: ItemPayload) => void;
  onStop: () => void;
}) {
  const [open, setOpen] = useState(!!initiallyOpen);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (initiallyOpen) requestAnimationFrame(() => rootRef.current?.scrollIntoView({ block: "center" }));
  }, [initiallyOpen]);
  const [agent, setAgent] = useState(defaultAgent);
  const [feedback, setFeedback] = useState("");
  const [showRevise, setShowRevise] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [url, setUrl] = useState("");
  const drafting = busyKind === "draft";
  const acting = busyKind === "act";
  const draftLine = useRotating(drafting, DRAFT_STATUS);
  const color = STATUS_COLOR[it.status];

  return (
    <div ref={rootRef} className="rounded-xl border" style={{ borderColor: "var(--panel-border)", background: "rgba(255,255,255,0.015)", borderLeft: `2px solid ${CHANNEL_COLOR[it.channel]}` }}>
      {/* Row head */}
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 p-2.5 text-left">
        {open ? <ChevronDown size={13} className="shrink-0 text-[var(--fg-dimmer)]" /> : <ChevronRight size={13} className="shrink-0 text-[var(--fg-dimmer)]" />}
        <Chip color={CHANNEL_COLOR[it.channel]}>{it.channel}{it.platform ? ` · ${it.platform}` : ""}</Chip>
        <span className="flex-1 min-w-0 text-[12.5px] font-medium text-[var(--fg)] truncate">{it.title}</span>
        {drafting ? (
          <span className="inline-flex items-center gap-1 text-[9.5px] font-mono shrink-0" style={{ color: "#fbbf24" }}>
            <Loader2 size={10} className="animate-spin" /> drafting
          </span>
        ) : (
          <Chip color={color}>{it.status}</Chip>
        )}
      </button>

      {/* Body */}
      {open && (
        <div className="px-3 pb-3 pl-8">
          <div className="text-[11.5px] leading-relaxed text-[var(--fg-dimmer)] mb-2.5">{it.brief}</div>

          {drafting ? (
            <div className="rounded-lg border p-3" style={{ borderColor: "rgba(251,191,36,0.4)", background: "rgba(251,191,36,0.05)" }}>
              <div className="text-[11.5px] font-mono flex items-center gap-1.5" style={{ color: "#fbbf24" }}>
                <Loader2 size={11} className="animate-spin" /> {draftLine}
              </div>
              <button onClick={onStop}
                className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11.5px] font-semibold"
                style={{ background: "rgba(244,63,94,0.12)", color: "#f43f5e", border: "1px solid rgba(244,63,94,0.4)" }}>
                <Square size={10} /> Stop
              </button>
            </div>
          ) : (
            <>
              {/* Draft body — view or inline-edit */}
              {it.draft && !editing && (
                <pre className="text-[12px] leading-relaxed whitespace-pre-wrap font-mono rounded-lg border p-3 max-h-[300px] overflow-y-auto mb-2.5"
                  style={{ borderColor: "var(--panel-border)", background: "rgba(0,0,0,0.25)", color: "var(--fg-dim)" }}>{it.draft}</pre>
              )}
              {editing && (
                <div className="mb-2.5">
                  <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={10} className={`${FIELD} font-mono text-[12px]`} />
                  <div className="flex items-center gap-2 mt-1.5">
                    <button onClick={() => { onItem({ action: "edit", draft: editText }); setEditing(false); }} disabled={acting}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11.5px] font-semibold disabled:opacity-40"
                      style={{ background: "rgba(251,191,36,0.16)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.5)" }}>
                      <Check size={11} /> Save edit
                    </button>
                    <button onClick={() => setEditing(false)} className="px-2.5 py-1.5 rounded-lg text-[11.5px]" style={{ color: "var(--fg-dim)", border: "1px solid var(--panel-border)" }}>Cancel</button>
                    <span className="text-[10px] text-[var(--fg-dimmer)]">A manual edit strips approval — back through the gate.</span>
                  </div>
                </div>
              )}

              {/* idea → draft it */}
              {it.status === "idea" && (
                <div className="flex items-center gap-2 flex-wrap">
                  <AgentPicker value={agent} onChange={setAgent} kinds={["cli"]} label="Agent" accent={ACCENT} />
                  <button onClick={() => onItem({ action: "draft", agent })} disabled={acting}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold disabled:opacity-40"
                    style={{ background: ACCENT_DIM, color: ACCENT, border: `1px solid ${ACCENT}66` }}>
                    <Wand2 size={12} /> Draft it
                  </button>
                </div>
              )}

              {/* drafted → approve / revise / edit */}
              {it.status === "drafted" && !editing && (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => onItem({ action: "approve" })} disabled={acting}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold disabled:opacity-40"
                      style={{ background: "rgba(52,211,153,0.15)", color: "#34d399", border: "1px solid rgba(52,211,153,0.4)" }}>
                      <Check size={12} /> Approve
                    </button>
                    <button onClick={() => setShowRevise((v) => !v)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold"
                      style={{ background: "rgba(251,191,36,0.12)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.4)" }}>
                      <RefreshCw size={11} /> Revise
                    </button>
                    <button onClick={() => { setEditText(it.draft || ""); setEditing(true); }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px]"
                      style={{ color: "var(--fg-dim)", border: "1px solid var(--panel-border)" }}>
                      <Pencil size={11} /> Edit
                    </button>
                  </div>
                  {showRevise && (
                    <div className="mt-2.5 rounded-lg border p-2.5" style={{ borderColor: "rgba(251,191,36,0.4)", background: "rgba(251,191,36,0.05)" }}>
                      <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={3}
                        placeholder="What should change? e.g. 'stronger hook, cut the second section, end on the walkthrough CTA'…" className={FIELD} />
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <AgentPicker value={agent} onChange={setAgent} kinds={["cli"]} label="Agent" accent="#fbbf24" />
                        <button onClick={() => { if (feedback.trim()) { onItem({ action: "draft", agent, feedback: feedback.trim() }); setFeedback(""); setShowRevise(false); } }}
                          disabled={!feedback.trim()}
                          className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold disabled:opacity-40"
                          style={{ background: "rgba(251,191,36,0.16)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.5)" }}>
                          <Wand2 size={12} /> Revise draft
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* approved / scheduled → unapprove, schedule, mark published */}
              {(it.status === "approved" || it.status === "scheduled") && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => onItem({ action: "unapprove" })} disabled={acting}
                      className="px-3 py-1.5 rounded-lg text-[12px] disabled:opacity-40"
                      style={{ color: "var(--fg-dim)", border: "1px solid var(--panel-border)" }}>
                      Unapprove
                    </button>
                    <label className="inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: "var(--fg-dimmer)" }}>
                      <CalendarDays size={12} />
                      <input type="date" value={it.scheduledFor || ""} disabled={acting}
                        onChange={(e) => { if (e.target.value) onItem({ action: "schedule", scheduledFor: e.target.value }); }}
                        className="text-[11.5px] rounded-md px-1.5 py-1 outline-none" style={SELECT_STYLE} />
                    </label>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Published URL (optional)"
                      className="flex-1 min-w-[180px] bg-[rgba(0,0,0,0.2)] rounded-lg px-2.5 py-1.5 text-[11.5px] outline-none text-[var(--fg)] placeholder:text-[var(--fg-dimmer)] border border-[var(--panel-border)]" />
                    <button onClick={() => { onItem({ action: "published", publishedUrl: url.trim() || undefined }); setUrl(""); }} disabled={acting}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold disabled:opacity-40"
                      style={{ background: "rgba(163,230,53,0.14)", color: "#a3e635", border: "1px solid rgba(163,230,53,0.4)" }}>
                      <Send size={11} /> Mark published
                    </button>
                  </div>
                </div>
              )}

              {/* published → link */}
              {it.status === "published" && it.publishedUrl && (
                <a href={it.publishedUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: "#a3e635" }}>
                  <ExternalLink size={12} /> {it.publishedUrl}
                </a>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Approval Queue tab ───────────────────────────────────────────────────────
function QueueTab({ queue, busy, defaultAgent, onItem, onStop, onOpenCampaign }: {
  queue: QueueEntry[];
  busy: Record<string, "plan" | "draft" | "act" | undefined>;
  defaultAgent: string;
  onItem: (slug: string, itemId: string, payload: ItemPayload) => void;
  onStop: (key: string) => void;
  onOpenCampaign: (slug: string) => void;
}) {
  if (queue.length === 0) {
    return <div className="panel p-12 text-center text-[13px] text-[var(--fg-dimmer)]">Nothing waiting at the gate — every new draft lands here for your approval.</div>;
  }
  return (
    <div className="space-y-3 pb-6">
      {queue.map((q) => (
        <QueueRow key={q.item.id} q={q}
          busyKind={busy[`draft:${q.item.id}`] ? "draft" : busy[`act:${q.item.id}`] ? "act" : undefined}
          defaultAgent={defaultAgent}
          onItem={(payload) => onItem(q.slug, q.item.id, payload)}
          onStop={() => onStop(`draft:${q.item.id}`)}
          onOpenCampaign={() => onOpenCampaign(q.slug)} />
      ))}
    </div>
  );
}

function QueueRow({ q, busyKind, defaultAgent, onItem, onStop, onOpenCampaign }: {
  q: QueueEntry;
  busyKind?: "draft" | "act";
  defaultAgent: string;
  onItem: (payload: ItemPayload) => void;
  onStop: () => void;
  onOpenCampaign: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showRevise, setShowRevise] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [agent, setAgent] = useState(defaultAgent);
  const drafting = busyKind === "draft";
  const acting = busyKind === "act";
  const draftLine = useRotating(drafting, DRAFT_STATUS);
  const it = q.item;
  const preview = (it.draft || "").slice(0, 320);
  const truncated = (it.draft || "").length > 320;

  return (
    <div className="panel p-3.5">
      <div className="flex items-center gap-2 flex-wrap mb-1.5">
        <button onClick={onOpenCampaign} className="text-[11px] font-mono hover:underline" style={{ color: ACCENT }} title="Open the campaign">{q.campaign}</button>
        <Chip color={BUSINESS_COLOR[q.business]}>{businessLabel(q.business)}</Chip>
        <Chip color={CHANNEL_COLOR[it.channel]}>{it.channel}{it.platform ? ` · ${it.platform}` : ""}</Chip>
        {it.updated && <span className="ml-auto text-[10.5px] text-[var(--fg-dimmer)]">{ago(it.updated)}</span>}
      </div>
      <div className="text-[13px] font-medium text-[var(--fg)] mb-2">{it.title}</div>

      {drafting ? (
        <div className="rounded-lg border p-3" style={{ borderColor: "rgba(251,191,36,0.4)", background: "rgba(251,191,36,0.05)" }}>
          <div className="text-[11.5px] font-mono flex items-center gap-1.5" style={{ color: "#fbbf24" }}>
            <Loader2 size={11} className="animate-spin" /> {draftLine}
          </div>
          <button onClick={onStop}
            className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11.5px] font-semibold"
            style={{ background: "rgba(244,63,94,0.12)", color: "#f43f5e", border: "1px solid rgba(244,63,94,0.4)" }}>
            <Square size={10} /> Stop
          </button>
        </div>
      ) : (
        <>
          {/* Draft preview — collapsed by default, expandable */}
          <pre className="text-[12px] leading-relaxed whitespace-pre-wrap font-mono rounded-lg border p-3 mb-2 overflow-y-auto"
            style={{ borderColor: "var(--panel-border)", background: "rgba(0,0,0,0.25)", color: "var(--fg-dim)", maxHeight: expanded ? 420 : 120 }}>
            {expanded ? it.draft : `${preview}${truncated ? "…" : ""}`}
          </pre>
          {(truncated || expanded) && (
            <button onClick={() => setExpanded((v) => !v)} className="inline-flex items-center gap-1 text-[11px] mb-2" style={{ color: "var(--fg-dim)" }}>
              {expanded ? <><ChevronDown size={12} /> Collapse</> : <><ChevronRight size={12} /> Show full draft</>}
            </button>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => onItem({ action: "approve" })} disabled={acting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold disabled:opacity-40"
              style={{ background: "rgba(52,211,153,0.15)", color: "#34d399", border: "1px solid rgba(52,211,153,0.4)" }}>
              <Check size={12} /> Approve
            </button>
            <button onClick={() => setShowRevise((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold"
              style={{ background: "rgba(251,191,36,0.12)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.4)" }}>
              <RefreshCw size={11} /> Revise
            </button>
          </div>
          {showRevise && (
            <div className="mt-2.5 rounded-lg border p-2.5" style={{ borderColor: "rgba(251,191,36,0.4)", background: "rgba(251,191,36,0.05)" }}>
              <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={3}
                placeholder="What should change before this ships?" className={FIELD} />
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <AgentPicker value={agent} onChange={setAgent} kinds={["cli"]} label="Agent" accent="#fbbf24" />
                <button onClick={() => { if (feedback.trim()) { onItem({ action: "draft", agent, feedback: feedback.trim() }); setFeedback(""); setShowRevise(false); } }}
                  disabled={!feedback.trim()}
                  className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold disabled:opacity-40"
                  style={{ background: "rgba(251,191,36,0.16)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.5)" }}>
                  <Wand2 size={12} /> Revise draft
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Personas tab (model-agnostic voice data, edited in-app) ──────────────────
function PersonasTab({ personas, onSaved }: { personas: Persona[]; onSaved: (ps: Persona[]) => void }) {
  return (
    <div className="pb-6">
      <p className="text-[12px] text-[var(--fg-dimmer)] mb-4">
        Model-agnostic: this exact voice is injected into whichever agent drafts.
      </p>
      {personas.length === 0 ? (
        <div className="panel p-12 text-center text-[13px] text-[var(--fg-dimmer)]">No personas yet — they seed on first load of the backend.</div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
          {personas.map((p) => <PersonaCard key={p.id} p={p} onSaved={onSaved} />)}
        </div>
      )}
    </div>
  );
}

function PersonaCard({ p, onSaved }: { p: Persona; onSaved: (ps: Persona[]) => void }) {
  const [name, setName] = useState(p.name);
  const [audience, setAudience] = useState(p.audience);
  const [tone, setTone] = useState(p.tone);
  const [rulesText, setRulesText] = useState(p.rules.join("\n"));
  const [bannedText, setBannedText] = useState(p.banned.join("\n"));
  const [cta, setCta] = useState(p.cta);
  const [examples, setExamples] = useState(p.examples || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

  async function save() {
    setSaving(true); setLocalErr(null);
    try {
      const r = await fetch("/api/marketing/personas", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          persona: {
            id: p.id, business: p.business,
            name: name.trim() || p.id, audience: audience.trim(), tone: tone.trim(),
            rules: lines(rulesText), banned: lines(bannedText), cta: cta.trim(),
            examples: examples.trim() || undefined,
          },
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (j.ok && Array.isArray(j.personas)) { onSaved(j.personas); setSaved(true); setTimeout(() => setSaved(false), 1600); }
      else setLocalErr(j.error || "Couldn't save the persona.");
    } catch { setLocalErr("Couldn't reach the server."); } finally { setSaving(false); }
  }

  const label = "text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-1 block";

  return (
    <div className="panel p-4" style={{ borderLeft: `2px solid ${BUSINESS_COLOR[p.business]}` }}>
      <div className="flex items-center gap-2 mb-3">
        <input value={name} onChange={(e) => setName(e.target.value)}
          className="flex-1 min-w-0 bg-transparent text-[14px] font-semibold outline-none text-[var(--fg)] border-b border-transparent focus:border-[var(--panel-border)]" />
        <Chip color={BUSINESS_COLOR[p.business]}>{businessLabel(p.business)}</Chip>
      </div>

      <div className="space-y-3">
        <div>
          <span className={label}>Audience</span>
          <textarea value={audience} onChange={(e) => setAudience(e.target.value)} rows={2} className={FIELD} />
        </div>
        <div>
          <span className={label}>Tone</span>
          <textarea value={tone} onChange={(e) => setTone(e.target.value)} rows={2} className={FIELD} />
        </div>
        <div>
          <span className={label}>Voice rules — one per line</span>
          <textarea value={rulesText} onChange={(e) => setRulesText(e.target.value)} rows={4} className={FIELD} />
        </div>
        <div>
          <span className={label}>Hard-banned — one per line</span>
          <textarea value={bannedText} onChange={(e) => setBannedText(e.target.value)} rows={3} className={FIELD} />
        </div>
        <div>
          <span className={label}>CTA style</span>
          <textarea value={cta} onChange={(e) => setCta(e.target.value)} rows={2} className={FIELD} />
        </div>
        <div>
          <span className={label}>Voice samples (optional)</span>
          <textarea value={examples} onChange={(e) => setExamples(e.target.value)} rows={3} className={FIELD} placeholder="Short samples of the voice at its best…" />
        </div>
      </div>

      {localErr && <p className="text-[11px] mt-2" style={{ color: "#fca5b4" }}>{localErr}</p>}
      <button onClick={save} disabled={saving}
        className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12px] font-semibold disabled:opacity-50"
        style={{ background: ACCENT_DIM, color: ACCENT, border: `1px solid ${ACCENT}66` }}>
        {saving ? <Loader2 size={12} className="animate-spin" /> : saved ? <Check size={12} /> : null}
        {saving ? "Saving…" : saved ? "Saved" : "Save persona"}
      </button>
    </div>
  );
}

// ── Ideate tab (spitfire brainstorm chat → promote the winner to a campaign) ─
const IDEATE_STATUS = [
  "riffing…",
  "spitballing angles…",
  "chasing a sharper hook…",
  "pushing back on the weak takes…",
  "still cooking — spitfire rounds can take a minute…",
];

function IdeateTab({ messages, busy, business, defaultAgent, buzzChannel, onBusiness, onSend, onPromote, onStop, onClear }: {
  messages: IdeateMsg[];
  busy: "chat" | "promote" | null;
  business: Business | "";
  defaultAgent: string;
  buzzChannel: string | null; // non-null = settings route the riff through this Buzz channel
  onBusiness: (b: Business | "") => void;
  onSend: (text: string, agent: string) => void;
  onPromote: (agent: string) => void;
  onStop: () => void;
  onClear: () => void;
}) {
  const [input, setInput] = useState("");
  const [agent, setAgent] = useState(defaultAgent);
  useEffect(() => { setAgent(defaultAgent); }, [defaultAgent]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatLine = useRotating(busy === "chat", IDEATE_STATUS);
  const canPromote = messages.length >= 2 && !busy;

  // Pin the scroll to the newest message / busy bubble.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    onSend(text, agent);
  }

  return (
    <div className="pb-6">
      <div className="panel flex flex-col overflow-hidden" style={{ height: "min(600px, 68vh)" }}>
        {/* Slim toolbar */}
        <div className="flex items-center gap-2 flex-wrap px-3 py-2" style={{ borderBottom: "1px solid var(--panel-border)" }}>
          <Lightbulb size={14} style={{ color: ACCENT }} className="shrink-0" />
          <select value={business} onChange={(e) => onBusiness(e.target.value as Business | "")}
            className="text-[11.5px] rounded-md px-2 py-1 outline-none shrink-0" style={SELECT_STYLE}
            title="Riff in a brand's voice, or freestyle with no brand attached">
            <option value="">No brand (freestyle)</option>
            {BUSINESSES.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
          <AgentPicker value={agent} onChange={setAgent} kinds={["cli"]} accent={ACCENT} />
          {buzzChannel && (
            <Chip color={ACCENT} title="This riff rides your Buzz workspace channel — your Buzz agents can join in. Business + agent above still drive Promote. Change under Configure.">
              via Buzz · #{buzzChannel}
            </Chip>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {messages.length > 0 && (
              <button onClick={onClear} disabled={!!busy} title="Clear this riff — session-only, nothing is saved anyway"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] disabled:opacity-40"
                style={{ color: "var(--fg-dim)", border: "1px solid var(--panel-border)" }}>
                <Eraser size={11} /> Clear
              </button>
            )}
            <button onClick={() => onPromote(agent)} disabled={!canPromote}
              title={messages.length < 2 ? "Riff at least one round first" : "Distill the riff into a pre-filled campaign on the Campaigns tab"}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold disabled:opacity-40"
              style={{ background: ACCENT_DIM, color: ACCENT, border: `1px solid ${ACCENT}66` }}>
              {busy === "promote" ? <Loader2 size={12} className="animate-spin" /> : null}
              Promote to campaign <ArrowRight size={12} />
            </button>
          </div>
        </div>

        {/* Messages — owner right, agent left, loose register */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-2.5">
          {messages.length === 0 && !busy && (
            <div className="h-full grid place-items-center text-center">
              <div>
                <div className="text-[13px] text-[var(--fg-dim)] mb-1">Spitfire zone — zero ceremony.</div>
                <div className="text-[11.5px] text-[var(--fg-dimmer)] max-w-[400px]">
                  Throw a half-formed idea at the wall, riff a few rounds, then promote the winner into a real campaign. Nothing here is saved.
                </div>
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[80%] rounded-2xl px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap"
                style={m.role === "user"
                  ? { background: ACCENT_DIM, border: `1px solid ${ACCENT}44`, color: "var(--fg)", borderBottomRightRadius: 6 }
                  : { background: "rgba(255,255,255,0.035)", border: "1px solid var(--panel-border)", color: "var(--fg-dim)", borderBottomLeftRadius: 6 }}>
                {m.text}
              </div>
            </div>
          ))}
          {busy === "chat" && (
            <div className="flex justify-start">
              <div className="rounded-2xl px-3 py-2 text-[11.5px] font-mono inline-flex items-center gap-2"
                style={{ background: "rgba(255,255,255,0.035)", border: "1px solid var(--panel-border)", color: "#fbbf24", borderBottomLeftRadius: 6 }}>
                <Loader2 size={12} className="animate-spin" /> {chatLine}
                <button onClick={onStop} title="Stop" style={{ color: "#f43f5e" }}><Square size={10} /></button>
              </div>
            </div>
          )}
          {busy === "promote" && (
            <div className="rounded-xl border p-3" style={{ borderColor: "rgba(251,191,36,0.4)", background: "rgba(251,191,36,0.05)" }}>
              <div className="text-[11.5px] font-mono flex items-center gap-1.5" style={{ color: "#fbbf24" }}>
                <Loader2 size={11} className="animate-spin" /> distilling the riff into a campaign brief… then over to Campaigns, pre-filled
              </div>
              <button onClick={onStop}
                className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11.5px] font-semibold"
                style={{ background: "rgba(244,63,94,0.12)", color: "#f43f5e", border: "1px solid rgba(244,63,94,0.4)" }}>
                <Square size={10} /> Stop
              </button>
            </div>
          )}
        </div>

        {/* Input — Enter sends, Shift+Enter breaks the line */}
        <div className="flex items-end gap-2 px-3 py-2.5" style={{ borderTop: "1px solid var(--panel-border)" }}>
          <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder='Riff… e.g. "CYD launch week — what if the whole hook is the price?"'
            className={`${FIELD} flex-1`} style={{ minHeight: 38, maxHeight: 120 }} />
          <button onClick={send} disabled={!input.trim() || !!busy} title="Send (Enter)"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-semibold disabled:opacity-40 shrink-0"
            style={{ background: ACCENT, color: "#1c0412" }}>
            {busy === "chat" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
      </div>
      <p className="text-[10.5px] text-[var(--fg-dimmer)] mt-2">
        Long rounds are normal — your CLI agent thinks for 15–60s+ per reply. Promote needs at least one full exchange.
      </p>
    </div>
  );
}

// ── Calendar tab (posting timeline across ALL campaigns) ─────────────────────
// Chip colors are STATUS-driven per the calendar spec (approved+scheduled share green,
// published wears the hub accent) — intentionally distinct from STATUS_COLOR above.
const CAL_STATUS_COLOR: Record<ItemStatus, string> = {
  idea: "#64748b", drafted: "#fbbf24", approved: "#34d399", scheduled: "#34d399", published: ACCENT,
};
const CAL_LEGEND: Array<{ label: string; color: string }> = [
  { label: "idea", color: CAL_STATUS_COLOR.idea },
  { label: "drafted", color: CAL_STATUS_COLOR.drafted },
  { label: "approved / scheduled", color: CAL_STATUS_COLOR.approved },
  { label: "published", color: CAL_STATUS_COLOR.published },
];

function channelGlyph(ch: Channel): React.ReactNode {
  if (ch === "youtube") return <MonitorPlay size={9} className="shrink-0" />;
  if (ch === "short-video") return <Clapperboard size={9} className="shrink-0" />;
  if (ch === "blog") return <FileText size={9} className="shrink-0" />;
  return <MessageSquare size={9} className="shrink-0" />;
}

interface CalEntry { slug: string; campaign: string; business: Business; item: ContentItem }

function CalChip({ e, onOpen }: { e: CalEntry; onOpen: () => void }) {
  const color = CAL_STATUS_COLOR[e.item.status];
  return (
    <button onClick={onOpen}
      title={`${e.campaign} — ${e.item.title} (${e.item.status}${e.item.platform ? ` · ${e.item.platform}` : ""})`}
      className="w-full flex items-center gap-1 rounded-md px-1.5 py-0.5 text-left transition hover:brightness-125"
      style={{ background: `${color}14`, border: `1px solid ${color}44`, borderLeft: `2px solid ${BUSINESS_COLOR[e.business]}`, color }}>
      {channelGlyph(e.item.channel)}
      <span className="flex-1 min-w-0 truncate text-[9.5px] font-mono">{e.item.title}</span>
      {e.item.status === "published" && <Check size={9} className="shrink-0" />}
    </button>
  );
}

function calDayKey(y: number, m: number, d: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${y}-${p(m + 1)}-${p(d)}`;
}

function CalendarTab({ campaigns, onOpenItem }: { campaigns: Campaign[]; onOpenItem: (slug: string, itemId: string) => void }) {
  const now = new Date();
  const [ym, setYm] = useState<{ y: number; m: number }>({ y: now.getFullYear(), m: now.getMonth() });

  // Flatten every campaign's items: dated → day buckets, undated → the Unscheduled strip.
  const byDay = new Map<string, CalEntry[]>();
  const unscheduled: CalEntry[] = [];
  for (const c of campaigns) for (const it of c.items) {
    const e: CalEntry = { slug: c.slug, campaign: c.title, business: c.business, item: it };
    if (it.scheduledFor && /^\d{4}-\d{2}-\d{2}$/.test(it.scheduledFor)) {
      const arr = byDay.get(it.scheduledFor);
      if (arr) arr.push(e); else byDay.set(it.scheduledFor, [e]);
    } else unscheduled.push(e);
  }

  const lead = (new Date(ym.y, ym.m, 1).getDay() + 6) % 7; // Monday-first offset
  const days = new Date(ym.y, ym.m + 1, 0).getDate();
  const cells: Array<number | null> = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const todayKey = calDayKey(now.getFullYear(), now.getMonth(), now.getDate());
  let monthCount = 0;
  for (let d = 1; d <= days; d++) monthCount += (byDay.get(calDayKey(ym.y, ym.m, d)) || []).length;

  function shift(delta: number) {
    setYm(({ y, m }) => { const t = new Date(y, m + delta, 1); return { y: t.getFullYear(), m: t.getMonth() }; });
  }

  return (
    <div className="pb-6">
      {/* Month nav + legend */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <button onClick={() => shift(-1)} title="Previous month"
          className="p-1.5 rounded-lg border hover:bg-[var(--bg-mid)]" style={{ borderColor: "var(--panel-border)", color: "var(--fg-dim)" }}>
          <ChevronLeft size={14} />
        </button>
        <div className="text-[14px] font-semibold text-[var(--fg)] min-w-[150px] text-center">
          {new Date(ym.y, ym.m, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </div>
        <button onClick={() => shift(1)} title="Next month"
          className="p-1.5 rounded-lg border hover:bg-[var(--bg-mid)]" style={{ borderColor: "var(--panel-border)", color: "var(--fg-dim)" }}>
          <ChevronRight size={14} />
        </button>
        <button onClick={() => setYm({ y: now.getFullYear(), m: now.getMonth() })}
          className="px-2.5 py-1 rounded-lg border text-[11.5px] font-semibold"
          style={{ borderColor: `${ACCENT}66`, color: ACCENT, background: ACCENT_DIM }}>
          Today
        </button>
        <div className="ml-auto flex items-center gap-3 flex-wrap">
          {CAL_LEGEND.map((l) => (
            <span key={l.label} className="inline-flex items-center gap-1.5 text-[10px] font-mono" style={{ color: "var(--fg-dimmer)" }}>
              <span aria-hidden className="rounded-full shrink-0" style={{ width: 7, height: 7, background: l.color }} /> {l.label}
            </span>
          ))}
        </div>
      </div>

      {monthCount === 0 && (
        <div className="text-[11.5px] text-[var(--fg-dimmer)] mb-2">nothing scheduled this month</div>
      )}

      {/* 7-col month grid, Mon–Sun */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] text-center py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          const key = day ? calDayKey(ym.y, ym.m, day) : `blank-${i}`;
          const isToday = !!day && key === todayKey;
          const dayEntries = day ? byDay.get(key) || [] : [];
          return (
            <div key={key} className="rounded-lg border p-1 min-h-[88px] flex flex-col gap-1"
              style={{
                borderColor: isToday ? ACCENT : "var(--panel-border)",
                background: !day ? "transparent" : isToday ? "rgba(236,72,153,0.06)" : "rgba(255,255,255,0.015)",
                opacity: day ? 1 : 0.35,
              }}>
              {day && (
                <div className="text-[10px] font-mono px-0.5" style={{ color: isToday ? ACCENT : "var(--fg-dimmer)", fontWeight: isToday ? 700 : 400 }}>
                  {day}
                </div>
              )}
              {dayEntries.map((e) => <CalChip key={e.item.id} e={e} onOpen={() => onOpenItem(e.slug, e.item.id)} />)}
            </div>
          );
        })}
      </div>

      {/* Unscheduled strip — pieces with no date yet, from any campaign */}
      {unscheduled.length > 0 && (
        <div className="panel p-3 mt-4">
          <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-2">
            Unscheduled · {unscheduled.length} — no date yet (set one from the campaign drawer)
          </div>
          <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
            {unscheduled.map((e) => <CalChip key={e.item.id} e={e} onOpen={() => onOpenItem(e.slug, e.item.id)} />)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Settings gear (PipelineSettings pattern) — writes settings.marketing ─────
const BASE_PLATFORMS = ["linkedin", "x", "facebook"];

function MarketingSettings() {
  const { settings, saving, save } = useSettings();
  const [agent, setAgent] = useState("claude");
  const [council, setCouncil] = useState(true);
  const [critic, setCritic] = useState("codex");
  const [platforms, setPlatforms] = useState<string[]>(BASE_PLATFORMS);
  const [newPlatform, setNewPlatform] = useState("");
  const [ideateBackend, setIdeateBackend] = useState<"local" | "buzz">("local");
  const [buzzChannel, setBuzzChannel] = useState("marketing-ideas");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const m = (settings?.marketing ?? null) as MarketingCfg | null;
    if (!m) return;
    setAgent(m.agent || "claude");
    setCouncil(m.council !== false);
    setCritic(m.criticAgent || "codex");
    setPlatforms(m.textPlatforms?.length ? m.textPlatforms : BASE_PLATFORMS);
    setIdeateBackend(m.ideateBackend === "buzz" ? "buzz" : "local");
    setBuzzChannel(m.buzzChannel || "marketing-ideas");
  }, [settings]);

  function togglePlatform(pl: string) {
    setPlatforms((ps) => (ps.includes(pl) ? ps.filter((x) => x !== pl) : [...ps, pl]));
  }
  function addPlatform() {
    const v = newPlatform.trim().toLowerCase().replace(/\s+/g, "-");
    if (v && !platforms.includes(v)) setPlatforms((ps) => [...ps, v]);
    setNewPlatform("");
  }
  async function onSave() {
    await save({ marketing: { agent, council, criticAgent: critic, textPlatforms: platforms, ideateBackend, buzzChannel: buzzChannel.trim() || "marketing-ideas" } });
    setSaved(true); setTimeout(() => setSaved(false), 1800);
  }
  // Ideate backend persists on change (no Save press needed). Sends the whole panel so
  // the settings-driven reset above can't revert unsaved edits to the other fields.
  function persistIdeate(next: { ideateBackend?: "local" | "buzz"; buzzChannel?: string }) {
    void save({ marketing: { agent, council, criticAgent: critic, textPlatforms: platforms, ideateBackend, buzzChannel: buzzChannel.trim() || "marketing-ideas", ...next } });
  }

  const shownPlatforms = Array.from(new Set([...BASE_PLATFORMS, ...platforms]));

  return (
    <ConfigMenu title="Marketing Hub settings" accent={ACCENT} buttonLabel="Configure">
      <p className="text-[11.5px] mb-4" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        Who plans and drafts your marketing. Runs on your own CLI subscriptions — no API keys. The brand voice comes from the Personas tab and is injected into whichever agent you pick here.
      </p>

      <Field label="Drafting agent" hint="Leads campaign planning and writes drafts (per-item override on each 'Draft it').">
        <AgentPicker value={agent} onChange={setAgent} kinds={["cli"]} accent={ACCENT} />
      </Field>

      <Field label="Planning council" hint="lead plan → adversarial critic → revision. Off = single-pass plan (faster, less scrutiny).">
        <label className="inline-flex items-center gap-2 text-[12.5px] cursor-pointer select-none" style={{ color: "var(--fg, #e8e2f0)" }}>
          <input type="checkbox" checked={council} onChange={(e) => setCouncil(e.target.checked)} style={{ accentColor: ACCENT }} />
          Run the 3-pass council when planning
        </label>
      </Field>

      {council && (
        <Field label="Critic agent" hint="The adversarial critic — ideally a different lineage than the lead.">
          <AgentPicker value={critic} onChange={setCritic} kinds={["cli"]} accent={ACCENT} />
        </Field>
      )}

      <Field label="Text-post platforms" hint="Where text posts are planned and drafted for.">
        <div className="flex flex-col gap-1.5">
          {shownPlatforms.map((pl) => (
            <label key={pl} className="inline-flex items-center gap-2 text-[12px] cursor-pointer select-none" style={{ color: "var(--fg-dim, #9aa)" }}>
              <input type="checkbox" checked={platforms.includes(pl)} onChange={() => togglePlatform(pl)} style={{ accentColor: ACCENT }} />
              {pl}
            </label>
          ))}
          <div className="flex items-center gap-1.5 mt-1">
            <TextInput placeholder="Add a platform… e.g. threads" value={newPlatform}
              onChange={(e) => setNewPlatform(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPlatform(); } }} />
            <button type="button" onClick={addPlatform} title="Add platform"
              className="px-2 h-[30px] rounded-md grid place-items-center shrink-0"
              style={{ border: "1px solid var(--panel-border, #2a2436)", color: ACCENT }}>
              <Plus size={13} />
            </button>
          </div>
        </div>
      </Field>

      <Field label="Ideate backend" hint="Where the Ideate riff lives. On Buzz, replies can arrive as multiple named agents from your workspace.">
        <div className="flex flex-col gap-1.5">
          <label className="inline-flex items-center gap-2 text-[12px] cursor-pointer select-none" style={{ color: "var(--fg-dim, #9aa)" }}>
            <input type="radio" name="mk-ideate-backend" checked={ideateBackend === "local"}
              onChange={() => { setIdeateBackend("local"); persistIdeate({ ideateBackend: "local" }); }} style={{ accentColor: ACCENT }} />
            In-hub chat (local)
          </label>
          <label className="inline-flex items-center gap-2 text-[12px] cursor-pointer select-none" style={{ color: "var(--fg-dim, #9aa)" }}>
            <input type="radio" name="mk-ideate-backend" checked={ideateBackend === "buzz"}
              onChange={() => { setIdeateBackend("buzz"); persistIdeate({ ideateBackend: "buzz" }); }} style={{ accentColor: ACCENT }} />
            Buzz channel — riff in your workspace; your Buzz agents join in
          </label>
          {ideateBackend === "buzz" && (
            <div className="mt-1">
              <span className="block text-[10.5px] mb-1" style={{ color: "var(--fg-dimmer, #6b6478)" }}>Buzz channel</span>
              <TextInput placeholder="marketing-ideas" value={buzzChannel}
                onChange={(e) => setBuzzChannel(e.target.value)}
                onBlur={() => { const v = buzzChannel.trim() || "marketing-ideas"; setBuzzChannel(v); persistIdeate({ buzzChannel: v }); }} />
            </div>
          )}
        </div>
      </Field>

      <SaveBar saving={saving} saved={saved} onSave={onSave} accent={ACCENT} />
    </ConfigMenu>
  );
}
