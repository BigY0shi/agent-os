"use client";

import { HeroGreeting } from "./dashboard/HeroGreeting";
import { KPIGrid } from "./dashboard/KPIGrid";
import { TelemetryPanel } from "./dashboard/TelemetryPanel";
import { AssistantPanel } from "./dashboard/AssistantPanel";
import { DealDeskSummary } from "./dashboard/DealDeskSummary";
import { SystemMap } from "./dashboard/SystemMap";
import { MiniTimeline } from "./dashboard/MiniTimeline";
import { MissionStripe } from "./dashboard/MissionStripe";

export default function Overview() {
  return (
    <div className="flex flex-col gap-5 mt-4">
      <HeroGreeting />
      <MissionStripe />
      <KPIGrid />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.4fr_1fr]">
        <TelemetryPanel />
        <AssistantPanel />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.1fr_1fr_1.1fr]">
        <DealDeskSummary />
        <SystemMap />
        <MiniTimeline />
      </div>
    </div>
  );
}
