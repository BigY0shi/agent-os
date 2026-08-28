"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { LayoutGrid, Brain, Sparkles as SparklesIcon, TrendingUp, Columns3, NotebookText, Film, Building2, Workflow, MessagesSquare, Image as ImageIcon, Gamepad2, Music2, Network, Clapperboard, Repeat, Cpu, Boxes, LayoutDashboard, Palette, GripVertical, Eye, EyeOff, SlidersHorizontal, Check, Users, Cloud, CheckCircle2, LogOut, TerminalSquare, Factory, Lightbulb, CalendarDays, Mic, Radar, Bot, Telescope, Megaphone, ListTodo, NotebookPen, Hammer, Plug, Zap } from "lucide-react";
import { useState, useEffect, type ReactNode } from "react";
import AgentAvatar from "./AgentAvatar";
import { cn } from "@/lib/cn";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  accent: string;
  dim: string;
}

const NAV: NavItem[] = [
  { href: "/",         label: "Mission Control", icon: <LayoutGrid size={16} />, accent: "#a855f7", dim: "rgba(168,85,247,0.16)" },
  // Integrations (SPEC-D G1): connector catalog — Gmail/GCal/Notion/GitHub/
  // Slack/Buzz accounts, tools, activity, memory rules. Workspace per §6.2
  // (WORKSPACE_ROUTES membership decides the section, not NAV position).
  { href: "/integrations", label: "Integrations", icon: <Plug size={16} />, accent: "#7dd3a8", dim: "rgba(125,211,168,0.16)" },
  // Automations (SPEC-D G5): When [trigger] if [conditions] then [actions]
  // rules over the integration/system event stream. Workspace per §6.2
  // (WORKSPACE_ROUTES membership decides the section, not NAV position).
  { href: "/automations", label: "Automations", icon: <Zap size={16} />, accent: "#fcd34d", dim: "rgba(252,211,77,0.16)" },
  // The local Tasklet: reusable background agents (SDK runtime, triggers, approvals).
  // Top-level on purpose — this is the OS's core primitive, not another module.
  { href: "/agents",   label: "Agents", icon: <Bot size={16} />, accent: "#a78bfa", dim: "rgba(167,139,250,0.16)" },
  { href: "/paperclip", label: "Paperclip", icon: <Building2 size={16} />, accent: "#d4a574", dim: "rgba(212,165,116,0.16)" },
  { href: "/room",     label: "AI Agent Mastermind", icon: <MessagesSquare size={16} />, accent: "#a855f7", dim: "rgba(168,85,247,0.16)" },
  { href: "/pipeline", label: "Pipeline", icon: <Workflow size={16} />, accent: "#34d399", dim: "rgba(52,211,153,0.16)" },
  { href: "/deals",    label: "Deal Desk", icon: <CheckCircle2 size={16} />, accent: "#34d399", dim: "rgba(52,211,153,0.16)" },
  { href: "/marketing", label: "Marketing Hub", icon: <Megaphone size={16} />, accent: "#ec4899", dim: "rgba(236,72,153,0.16)" },
  // Sibling of Deal Desk: same pipeline, pointed at salaried job postings instead of gigs.
  { href: "/hire",     label: "Hire Engine", icon: <Factory size={16} />, accent: "#fb923c", dim: "rgba(251,146,60,0.16)" },
  { href: "/audit",    label: "Audit Console", icon: <Radar size={16} />, accent: "#34d399", dim: "rgba(52,211,153,0.16)" },
  // Three-seat ideation council (Claude + ChatGPT + Kimi) — topic in, project brief out.
  { href: "/brainstorm", label: "Brainstorm", icon: <Lightbulb size={16} />, accent: "#fbbf24", dim: "rgba(251,191,36,0.16)" },
  // Trend surfacing + evidence-first validation + IdeaBrowser-style dossiers.
  { href: "/idea-engine", label: "Idea Engine", icon: <Telescope size={16} />, accent: "#f59e0b", dim: "rgba(245,158,11,0.16)" },
  // Voice butler, standalone since 2026-07-27 (was a Hermes tab); agent mode = Codex.
  { href: "/jarvis",   label: "Jarvis", icon: <Mic size={16} />, accent: "#22d3ee", dim: "rgba(34,211,238,0.16)" },
  // Agents — use real avatar logos
  { href: "/claude",   label: "Claude",   icon: <AgentAvatar agent="claude" size={22} />,   accent: "#d97757", dim: "rgba(217,119,87,0.16)" },
  { href: "/openclaw", label: "OpenClaw", icon: <AgentAvatar agent="openclaw" size={22} />, accent: "#f472b6", dim: "rgba(244,114,182,0.16)" },
  { href: "/hermes",   label: "Hermes",   icon: <AgentAvatar agent="hermes" size={22} />,   accent: "#60a5fa", dim: "rgba(96,165,250,0.16)" },
  // Gemini CLI removed 2026-06-23 — Google retired it (18 Jun 2026); Antigravity CLI (below) is its successor.
  { href: "/antigravity", label: "Antigravity", icon: <AgentAvatar agent="antigravity" size={22} />, accent: "#7c3aed", dim: "rgba(124,58,237,0.16)" },
  { href: "/codex",       label: "Codex",       icon: <AgentAvatar agent="codex" size={22} />,       accent: "#22c55e", dim: "rgba(34,197,94,0.16)" },
  { href: "/cursor",      label: "Cursor",      icon: <AgentAvatar agent="cursor" size={22} />,      accent: "#cbd5e1", dim: "rgba(203,213,225,0.16)" },
  { href: "/pi",          label: "Pi",          icon: <AgentAvatar agent="pi" size={22} />,          accent: "#fbbf24", dim: "rgba(251,191,36,0.16)" },
  { href: "/ollama",      label: "Ollama Cloud", icon: <Cloud size={18} />,                           accent: "#6CA8FF", dim: "rgba(108,168,255,0.16)" },
  { href: "/freeclaude",  label: "Free Claude Code", icon: <AgentAvatar agent="fcc" size={22} />,    accent: "#10b981", dim: "rgba(16,185,129,0.16)" },
  { href: "/fusion",      label: "Fusion",      icon: <Network size={18} />,                         accent: "#d4a574", dim: "rgba(212,165,116,0.16)" },
  { href: "/sakana",      label: "Sakana Fugu", icon: <Network size={18} />,                         accent: "#ff5f9e", dim: "rgba(255,95,158,0.16)" },
  { href: "/local",       label: "Local",       icon: <Cpu size={18} />,                             accent: "#5eead4", dim: "rgba(94,234,212,0.16)" },
  { href: "/engine",      label: "Local Engine", icon: <Boxes size={18} />,                           accent: "#38bdf8", dim: "rgba(56,189,248,0.16)" },
  { href: "/agent-kanban", label: "Agent Kanban", icon: <LayoutDashboard size={18} />,                accent: "#7dd3fc", dim: "rgba(125,211,252,0.16)" },
  // Personal
  { href: "/loop",     label: "Loop",     icon: <Repeat size={16} />,   accent: "#2dd4bf", dim: "rgba(45,212,191,0.16)" },
  // Calendar → materials → metrics loop; sits with its content siblings (SEO, Thumbnails, Video).
  { href: "/content-engine", label: "Content Engine", icon: <CalendarDays size={16} />, accent: "#e879f9", dim: "rgba(232,121,249,0.16)" },
  { href: "/seo",      label: "SEO",      icon: <TrendingUp size={16} />, accent: "#a3e635", dim: "rgba(163,230,53,0.16)" },
  { href: "/leads",    label: "Leads",    icon: <Users size={16} />,     accent: "#f59e0b", dim: "rgba(245,158,11,0.16)" },
  { href: "/opendesign", label: "Open Design", icon: <Palette size={16} />, accent: "#e879f9", dim: "rgba(232,121,249,0.16)" },
  { href: "/video",    label: "Video",    icon: <Film size={16} />,      accent: "#ef4444", dim: "rgba(239,68,68,0.16)" },
  { href: "/music",    label: "Music",    icon: <Music2 size={16} />,    accent: "#c084fc", dim: "rgba(192,132,252,0.16)" },
  { href: "/games",    label: "Game Studio", icon: <Gamepad2 size={16} />, accent: "#39ff8e", dim: "rgba(57,255,142,0.16)" },
  { href: "/thumbnails", label: "Thumbnails", icon: <ImageIcon size={16} />, accent: "#fb7185", dim: "rgba(251,113,133,0.16)" },
  { href: "/notebook", label: "Notebook", icon: <NotebookText size={16} />, accent: "#fde047", dim: "rgba(253,224,71,0.16)" },
  { href: "/kanban",   label: "Kanban",   icon: <Columns3 size={16} />,  accent: "#14b8a6", dim: "rgba(20,184,166,0.16)" },
  // Tasks V2 (SPEC-B): list + calendar + drag-drop board + agents strip. Lives in
  // "Self" by default (sectionOf fallback) — do NOT add to the section Sets.
  { href: "/tasks",    label: "Tasks",    icon: <ListTodo size={16} />,  accent: "#f97316", dim: "rgba(249,115,22,0.16)" },
  // Scratchpad V2 (SPEC-B B5): daily page, [ ]→task binding, @jarvis replies.
  // Lives in "Self" beside /tasks (sectionOf fallback) — not in any section Set.
  { href: "/today",    label: "Today",    icon: <NotebookPen size={16} />, accent: "#06b6d4", dim: "rgba(6,182,212,0.16)" },
  // WebMCP Engine (SPEC-C D3): build/test/version/publish MCP tool packages.
  // Lives in "Self" beside /tasks//today (sectionOf fallback) — not in any Set.
  { href: "/webmcp",   label: "WebMCP",   icon: <Hammer size={16} />, accent: "#b7852f", dim: "rgba(183,133,47,0.16)" },
  { href: "/memory",   label: "Memory",   icon: <Brain size={16} />,     accent: "#22d3ee", dim: "rgba(34,211,238,0.16)" },
  // Replaced Build Guide (2026-07-26) — a static how-to earned less shelf space than a
  // real shell. /guide still renders if you navigate to it directly.
  { href: "/terminal", label: "Terminal", icon: <TerminalSquare size={16} />, accent: "#5eead4", dim: "rgba(94,234,212,0.16)" },
];

const DEFAULT_ORDER = NAV.map((n) => n.href);
const BY_HREF: Record<string, NavItem> = Object.fromEntries(NAV.map((n) => [n.href, n]));
const AGENT_ROUTES = new Set(["/claude", "/openclaw", "/hermes", "/antigravity", "/codex", "/cursor", "/pi", "/ollama", "/freeclaude", "/fusion", "/sakana", "/local", "/engine"]);
const LS_ORDER = "agentos.sidebar.order";
const LS_HIDDEN = "agentos.sidebar.hidden";

// Sidebar grouping. Mission Control sits under the top "Workspace" header;
// Paperclip + AI Agent Mastermind + Pipeline + Deal Desk + Hire Engine + Agent Kanban get
// their own "Agent Orchestration" group; the model agents under "Agents"; everything else
// under "Self".
//
// NOTE: membership here is what decides the group — NOT position in NAV and not the saved
// drag order. A route missing from this set silently lands in "Self" no matter where it
// sits in the array, so add new orchestration modules here as well as to NAV.
const ORCHESTRATION_ROUTES = new Set(["/paperclip", "/room", "/pipeline", "/deals", "/marketing", "/hire", "/audit", "/brainstorm", "/idea-engine", "/jarvis", "/agent-kanban"]);
// SPEC-D §6.2: /integrations sits under Workspace (membership decided HERE).
const WORKSPACE_ROUTES = new Set(["/", "/integrations", "/automations"]);
function sectionOf(href: string): string {
  if (WORKSPACE_ROUTES.has(href)) return "Workspace";
  // "/agents" (the Tasklet-style module) owns the "Agents" section header; the
  // model CLI routes were renamed to "CLI Agents" to make room (2026-07-28).
  if (href === "/agents") return "Agents";
  if (ORCHESTRATION_ROUTES.has(href)) return "Agent Orchestration";
  if (AGENT_ROUTES.has(href)) return "CLI Agents";
  return "Self";
}

export default function Sidebar() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [order, setOrder] = useState<string[]>(DEFAULT_ORDER);
  const [hidden, setHidden] = useState<string[]>([]);
  const [customize, setCustomize] = useState(false);
  const [dragHref, setDragHref] = useState<string | null>(null);
  const [overHref, setOverHref] = useState<string | null>(null);
  const [version, setVersion] = useState("");
  useEffect(() => { fetch("/api/version").then((r) => r.json()).then((j) => setVersion(j.version || "")).catch(() => {}); }, []);

  // load saved prefs (client only)
  useEffect(() => {
    setMounted(true);
    try {
      const o = JSON.parse(localStorage.getItem(LS_ORDER) || "null");
      const h = JSON.parse(localStorage.getItem(LS_HIDDEN) || "null");
      if (Array.isArray(o)) setOrder(o.filter((x) => typeof x === "string"));
      if (Array.isArray(h)) setHidden(h.filter((x) => typeof x === "string"));
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { if (mounted) try { localStorage.setItem(LS_ORDER, JSON.stringify(order)); } catch {} }, [order, mounted]);
  useEffect(() => { if (mounted) try { localStorage.setItem(LS_HIDDEN, JSON.stringify(hidden)); } catch {} }, [hidden, mounted]);

  // saved order + any NAV items not yet in it (e.g. new pages added later) appended in default position
  const fullOrder = [
    ...order.filter((h) => BY_HREF[h]),
    ...DEFAULT_ORDER.filter((h) => !order.includes(h)),
  ];
  const visible = customize ? fullOrder : fullOrder.filter((h) => !hidden.includes(h));
  // group by section so each header shows ONCE and all its items sit together,
  // no matter how the saved drag-order interleaves them (fixes duplicate section labels)
  const SECTION_ORDER = ["Workspace", "Agents", "Agent Orchestration", "CLI Agents", "Self"];
  const list = SECTION_ORDER.flatMap((sec) => visible.filter((h) => sectionOf(h) === sec));

  function move(from: string, to: string) {
    if (from === to) return;
    const next = fullOrder.filter((h) => h !== from);
    const idx = to === "__end__" ? next.length : next.indexOf(to);
    next.splice(idx < 0 ? next.length : idx, 0, from);
    setOrder(next);
  }
  function toggleHidden(href: string) {
    setHidden((h) => (h.includes(href) ? h.filter((x) => x !== href) : [...h, href]));
  }
  function reset() { setOrder(DEFAULT_ORDER); setHidden([]); }

  return (
    <aside className="relative z-20 hidden md:flex flex-col w-[244px] shrink-0 h-screen overflow-hidden py-6 border-r border-[var(--color-border)] bg-[rgba(8,12,20,0.72)] backdrop-blur-2xl">
      {/* aurora top strip */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-32"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 0%, rgba(111,255,155,0.14), rgba(43,182,255,0.08) 45%, transparent 72%)",
        }}
      />

      <Link
        href="/"
        className="group relative flex items-center gap-3 border-b border-[var(--color-border)] px-5 pb-5 mb-5 shrink-0"
      >
        <div className="relative grid h-10 w-10 place-items-center overflow-hidden rounded-xl border border-[var(--color-border-strong)] bg-gradient-to-br from-[rgba(111,255,155,0.18)] via-[rgba(43,182,255,0.12)] to-[rgba(108,75,255,0.18)]">
          <motion.span
            aria-hidden
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.5, 0] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
            style={{
              background:
                "conic-gradient(from 0deg, transparent 0deg, rgba(111,255,155,0.55) 30deg, transparent 60deg)",
            }}
          />
          <SparklesIcon className="relative h-4 w-4 text-[var(--color-neon)] drop-shadow-[0_0_8px_rgba(111,255,155,0.6)]" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-[13px] font-semibold tracking-wide text-[var(--color-ink)]">
            Command Center
          </span>
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--color-ink-faint)]">
            Agentic OS · v0.2
          </span>
          {version && version !== "unknown" && (
            <span className="font-mono text-[9px] tracking-[0.18em] text-[var(--color-ink-faint)]" title="Pack build — compare against the newest in the AI Profit Boardroom">
              build {version}
            </span>
          )}
        </div>
      </Link>

      <div className="flex-1 min-h-0 overflow-y-auto sidebar-scroll">
      <div className="px-5 pb-1.5 flex items-center justify-between">
        <span className="sidebar-section-label">Workspace</span>
        <div className="flex items-center gap-2">
          {customize && (
            <button onClick={reset} title="Reset to default order" className="text-[9px] uppercase tracking-[0.15em] hover:opacity-100 opacity-70 transition" style={{ color: "var(--cream-dim)" }}>
              Reset
            </button>
          )}
          <button
            onClick={() => setCustomize((c) => !c)}
            title={customize ? "Done customizing" : "Customize sidebar — drag to reorder, hide items"}
            className="grid place-items-center w-6 h-6 rounded-md transition"
            style={{ color: customize ? "var(--gold)" : "var(--cream-dim)", background: customize ? "rgba(212,165,116,0.14)" : "transparent" }}
          >
            {customize ? <Check size={14} /> : <SlidersHorizontal size={14} />}
          </button>
        </div>
      </div>
      {customize && (
        <div className="px-5 pb-2 text-[10px] leading-snug" style={{ color: "var(--cream-mute)" }}>
          Drag <GripVertical size={10} className="inline -mt-0.5" /> to reorder · tap the eye to hide
        </div>
      )}

      <nav className="flex flex-col gap-0.5 relative">
        {list.map((href, i) => {
          const item = BY_HREF[href];
          if (!item) return null;
          const prevHref = i > 0 ? list[i - 1] : null;
          const sec = sectionOf(href);
          const prevSec = prevHref ? sectionOf(prevHref) : null;
          let sectionLabel: string | undefined = sec !== prevSec ? sec : undefined;
          // The top "Workspace" header already labels the first group — don't repeat it.
          if (i === 0 && sectionLabel === "Workspace") sectionLabel = undefined;

          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          const isHidden = hidden.includes(href);
          const isOver = overHref === href && dragHref !== href;

          return (
            <div key={href}>
              {sectionLabel && (
                <div className="sidebar-section-label mt-5 mb-1.5 px-5">
                  {sectionLabel}
                </div>
              )}

              {customize ? (
                <div
                  draggable
                  onDragStart={() => setDragHref(href)}
                  onDragEnter={() => setOverHref(href)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { if (dragHref) move(dragHref, href); setDragHref(null); setOverHref(null); }}
                  onDragEnd={() => { setDragHref(null); setOverHref(null); }}
                  className="sidebar-item relative group flex items-center gap-2 py-2.5 px-3 mx-2 rounded-lg cursor-grab active:cursor-grabbing"
                  style={{
                    opacity: dragHref === href ? 0.4 : isHidden ? 0.4 : 1,
                    borderTop: isOver ? "2px solid var(--gold)" : "2px solid transparent",
                    background: isOver ? "rgba(212,165,116,0.08)" : "transparent",
                  }}
                >
                  <GripVertical size={14} style={{ color: "var(--cream-mute)" }} className="shrink-0" />
                  <span className="shrink-0 grid place-items-center w-7 h-7 rounded-md" style={{ color: "var(--cream-dim)" }}>
                    {item.icon}
                  </span>
                  <span className="flex-1 truncate" style={{ textDecoration: isHidden ? "line-through" : "none" }}>{item.label}</span>
                  <button
                    onClick={() => toggleHidden(href)}
                    title={isHidden ? "Show" : "Hide"}
                    className="shrink-0 grid place-items-center w-6 h-6 rounded-md transition hover:bg-[rgba(255,255,255,0.06)]"
                    style={{ color: isHidden ? "var(--cream-mute)" : "var(--gold)" }}
                  >
                    {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              ) : (
                <Link
                  href={href}
                  className={cn(
                    "group relative flex items-center gap-3 py-2 px-5 transition mx-2 rounded-lg",
                    active
                      ? "text-[var(--color-neon)]"
                      : "text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] hover:bg-[rgba(255,255,255,0.02)]",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-active-pill"
                      className="absolute inset-0 -z-10 rounded-lg border border-[var(--color-neon)]/30 bg-[rgba(111,255,155,0.08)] shadow-[inset_0_0_30px_rgba(111,255,155,0.05)]"
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    />
                  )}
                  {active && (
                    <motion.span
                      aria-hidden
                      layoutId="nav-active-bar"
                      className="absolute -left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--color-neon)] shadow-[0_0_12px_var(--color-neon-glow)]"
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    />
                  )}
                  <span
                    className="shrink-0 grid place-items-center w-7 h-7 rounded-md transition group-hover:scale-110"
                    style={{ color: active ? "var(--color-neon)" : "var(--color-ink-dim)" }}
                  >
                    {item.icon}
                  </span>
                  <span className="text-[13px] font-medium">{item.label}</span>
                </Link>
              )}
            </div>
          );
        })}
        {customize && (
          <div
            onDragEnter={() => setOverHref("__end__")}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (dragHref) move(dragHref, "__end__"); setDragHref(null); setOverHref(null); }}
            className="h-6 mx-2 rounded-lg"
            style={{ borderTop: overHref === "__end__" ? "2px solid var(--gold)" : "2px solid transparent" }}
          />
        )}
      </nav>
      </div>

      <div className="shrink-0 pt-6 mx-5 border-t border-[var(--line-soft)]">
        <div className="sidebar-section-label mt-4 mb-2">Wired</div>
        <div className="text-[11px] leading-relaxed mono" style={{ color: "var(--cream-dim)" }}>
          claude · codex · cursor · pi<br />
          <span className="hand text-[1.15em]">+</span> Obsidian vault
        </div>
        <button
          onClick={async () => { try { await fetch("/api/auth/logout", { method: "POST" }); } catch {} window.location.href = "/login"; }}
          className="mt-3 inline-flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.15em] transition hover:opacity-100 opacity-70"
          style={{ color: "var(--cream-mute)" }}
          title="Sign out of this device"
        >
          <LogOut size={12} /> Sign out
        </button>
      </div>
    </aside>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  // hide a couple of agents on the mobile bar for space — href-based so reordering NAV can't shift which ones
  const HIDE_ON_MOBILE = new Set(["/openclaw", "/hermes"]);
  const items = NAV.filter((n) => !HIDE_ON_MOBILE.has(n.href));
  return (
    <nav className="md:hidden fixed bottom-3 left-1/2 -translate-x-1/2 z-40 panel panel-hot px-2 py-1.5 flex gap-1">
      {items.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className="grid place-items-center w-10 h-10 rounded-lg transition"
            style={{
              background: active ? item.dim : "transparent",
              color: active ? item.accent : "var(--fg-dim)",
            }}
          >
            {item.icon}
          </Link>
        );
      })}
    </nav>
  );
}
