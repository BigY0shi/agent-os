"use client";

import { HeroGreeting } from "./dashboard/HeroGreeting";
import AttentionHero from "./v2/home/AttentionHero";
import HomeGrid from "./v2/home/HomeGrid";
import ScratchpadSlot from "./v2/home/ScratchpadSlot";

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
// Page spine: HeroGreeting → AttentionHero (H4) → ScratchpadSlot (B5 surface,
// settings.home.showScratchpad toggle) → HomeGrid (H2).
export default function Overview() {
  return (
    <div className="flex flex-col gap-5 mt-4">
      <HeroGreeting />
      <AttentionHero />
      <ScratchpadSlot />
      <HomeGrid />
    </div>
  );
}
