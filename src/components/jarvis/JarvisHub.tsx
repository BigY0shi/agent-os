"use client";

// The Jarvis module shell (S12, _design/jarvis-v3-plan.md): one page, several tabs.
// Console is the original JarvisView. Oracle, News Radar and Outreach moved here from
// the Hermes module on 2026-09-28 (their components and APIs are unchanged). The tab
// lives in `?tab=` so Jarvis's own screen control and old bookmarks can deep-link.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { gsap } from "gsap";
import { Cpu, Moon, Radar, Mail, History, Plug, SlidersHorizontal, Target, Building2, FolderOpen, CalendarClock } from "lucide-react";
import JarvisView from "@/components/JarvisView";
import OracleView from "@/components/OracleView";
import NewsView from "@/components/NewsView";
import HermesOutreach from "@/components/HermesOutreach";
import SessionsTab from "@/components/jarvis/SessionsTab";
import ControlRoomTab from "@/components/jarvis/ControlRoomTab";
import McpTab from "@/components/jarvis/McpTab";
import MissionsTab from "@/components/jarvis/MissionsTab";
import CrewTab from "@/components/jarvis/CrewTab";
import FilesTab from "@/components/jarvis/FilesTab";
import StandingOrdersTab from "@/components/jarvis/StandingOrdersTab";

export type JarvisTab = "console" | "oracle" | "radar" | "outreach" | "sessions" | "mcp" | "control" | "goals" | "crew" | "files" | "orders";

interface TabDef { key: JarvisTab; label: string; icon: ReactNode; render: () => ReactNode }

/** Tabs register here as their slices land; nothing is listed before it works. */
export const JARVIS_TABS: TabDef[] = [
  { key: "console", label: "Console", icon: <Cpu size={13} />, render: () => <JarvisView /> },
  { key: "oracle", label: "Oracle", icon: <Moon size={13} />, render: () => <OracleView /> },
  { key: "radar", label: "News Radar", icon: <Radar size={13} />, render: () => <NewsView /> },
  { key: "outreach", label: "Outreach", icon: <Mail size={13} />, render: () => <HermesOutreach /> },
  { key: "sessions", label: "Sessions", icon: <History size={13} />, render: () => <SessionsTab /> },
  { key: "goals", label: "Missions", icon: <Target size={13} />, render: () => <MissionsTab /> },
  { key: "crew", label: "Crew", icon: <Building2 size={13} />, render: () => <CrewTab /> },
  { key: "files", label: "Files", icon: <FolderOpen size={13} />, render: () => <FilesTab /> },
  { key: "orders", label: "Standing orders", icon: <CalendarClock size={13} />, render: () => <StandingOrdersTab /> },
  { key: "mcp", label: "MCP", icon: <Plug size={13} />, render: () => <McpTab /> },
  { key: "control", label: "Control Room", icon: <SlidersHorizontal size={13} />, render: () => <ControlRoomTab /> },
];

// Icons for tabs that later slices add; kept here so the bar stays visually consistent.
export const FUTURE_TAB_ICONS: Partial<Record<JarvisTab, ReactNode>> = {
};

function isTab(v: string | null): v is JarvisTab {
  return !!v && JARVIS_TABS.some((t) => t.key === v);
}

export default function JarvisHub() {
  const router = useRouter();
  const params = useSearchParams();
  const fromUrl = params.get("tab");
  const [tab, setTab] = useState<JarvisTab>(isTab(fromUrl) ? fromUrl : "console");
  const stageRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  // URL -> state (back/forward, Jarvis navigating to /jarvis?tab=...)
  // No ?tab= means Console, so /jarvis?c=<id> (Sessions -> Resume in Console) lands there.
  useEffect(() => { const want: JarvisTab = isTab(fromUrl) ? fromUrl : "console"; if (want !== tab) setTab(want); }, [fromUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = useCallback((next: JarvisTab) => {
    setTab(next);
    const q = new URLSearchParams(window.location.search);
    if (next === "console") q.delete("tab"); else q.set("tab", next);
    const qs = q.toString();
    router.replace(`/jarvis${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [router]);

  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // Title: word-by-word reveal once. The accessible name is the unsplit h1 text.
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el || reduced) return;
    const words = el.querySelectorAll("[data-word]");
    const tl = gsap.fromTo(words, { yPercent: 110, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.7, stagger: 0.06, ease: "power3.out" });
    return () => { tl.kill(); };
  }, [reduced]);

  // Tab entrance: the stage settles, then its glass cards rise in a short stagger.
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el || reduced) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(el, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.45, ease: "power2.out" });
      const cards = el.querySelectorAll(".glass, .glass-strong, .panel");
      if (cards.length) gsap.fromTo(cards, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.035, ease: "power2.out", delay: 0.08, clearProps: "transform,opacity" });
    }, el);
    return () => ctx.revert();
  }, [tab, reduced]);

  const active = JARVIS_TABS.find((t) => t.key === tab) ?? JARVIS_TABS[0];

  return (
    <div className="space-y-5" data-jarvis-hub>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="glass-eyebrow">Agent orchestration · resident agent</div>
          <h1
            ref={titleRef}
            aria-label="Jarvis"
            className="type-display mt-1 overflow-hidden text-[34px] leading-none uppercase tracking-[0.04em]"
          >
            <span aria-hidden className="inline-flex">
              {"Jarvis".split("").map((ch, i) => (
                <span key={i} data-word className="inline-block">{ch}</span>
              ))}
            </span>
          </h1>
        </div>
        <nav role="tablist" aria-label="Jarvis sections" className="glass-tabs">
          {JARVIS_TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={tab === t.key}
              aria-controls={`jarvis-panel-${t.key}`}
              id={`jarvis-tab-${t.key}`}
              onClick={() => choose(t.key)}
              className="glass-tab inline-flex items-center gap-1.5"
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <div
        ref={stageRef}
        role="tabpanel"
        id={`jarvis-panel-${active.key}`}
        aria-labelledby={`jarvis-tab-${active.key}`}
        key={active.key}
      >
        {active.render()}
      </div>
    </div>
  );
}
