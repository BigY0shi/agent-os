import ScratchpadView from "@/components/v2/pages/ScratchpadView";

// Scratchpad V2 (SPEC-B B5) — daily page with [ ]→task binding and @jarvis
// mention replies over /api/v2/pages/*. One page per day in the user's tz.
export default function TodayRoute() {
  return (
    <div className="min-h-[calc(100vh-220px)]">
      <ScratchpadView />
    </div>
  );
}
