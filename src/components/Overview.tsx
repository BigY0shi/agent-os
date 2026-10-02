"use client";

import { useEffect, useState } from "react";
import { HeroGreeting } from "./dashboard/HeroGreeting";
import AttentionHero from "./v2/home/AttentionHero";
import HomeGrid from "./v2/home/HomeGrid";
import ScratchpadSlot from "./v2/home/ScratchpadSlot";
import { CockpitBand, SystemPulse } from "./v2/home/Cockpit";

// Jarvis is the homepage's centerpiece: the warm voice assistant gets the wide
// slot right under the hero (it replaced the placeholder AssistantPanel), with
// telemetry beside it and the operational panels below.
//
// H1.1 (SPEC-D §6.4): that composition now lives in the widget grid — every
// panel is wrapped as a legacy-* widget (src/components/v2/home/
// widgetComponents.tsx imports them unchanged) and DEFAULT_HOME_CELLS
// reproduces the exact order above (Mission → Jarvis M | Telemetry S → KPI →
// Todo → Deals | SystemMap | Timeline), so nothing is visually lost by
// default and the layout is now customizable (drag/resize/add/remove).
//
// S18 (2026-09-29, owner: "no information on the initial load", "scroll past that
// gigantic scratch pad"): three views. Cockpit (default) puts measured telemetry
// right under the greeting, then attention, the widget grid, and the scratchpad LAST;
// Health (S27, grown from the S18 System pulse view) is the full machine view; Scratchpad is the pad on its own. The chosen
// view is remembered per browser (a convenience; it falls back to Cockpit).
type View = "cockpit" | "pulse" | "scratchpad";
const VIEWS: [View, string][] = [["cockpit", "Cockpit"], ["pulse", "Health"], ["scratchpad", "Scratchpad"]];
const KEY = "agentos.home.view";

export default function Overview() {
  const [view, setView] = useState<View>("cockpit");
  useEffect(() => {
    try { const v = localStorage.getItem(KEY) as View | null; if (v && VIEWS.some(([k]) => k === v)) setView(v); } catch { /* storage blocked */ }
  }, []);
  const pick = (v: View) => { setView(v); try { localStorage.setItem(KEY, v); } catch { /* storage blocked */ } };

  return (
    <div className="flex flex-col gap-5 mt-4">
      <HeroGreeting />
      <div role="tablist" aria-label="Mission Control views" className="glass-tabs self-start">
        {VIEWS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => pick(k)} className="glass-tab">{label}</button>
        ))}
      </div>
      {view === "cockpit" && (
        <>
          <CockpitBand />
          <AttentionHero />
          <HomeGrid />
          <ScratchpadSlot />
        </>
      )}
      {view === "pulse" && <SystemPulse />}
      {view === "scratchpad" && <ScratchpadSlot />}
    </div>
  );
}
