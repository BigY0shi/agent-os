import AutomationsView from "@/components/v2/automations/AutomationsView";

// Automations (SPEC-D G5.3 §6.3) — "When [trigger] if [conditions] then
// [actions]" rules over the integration/system event stream: rule list with
// sentence rendering, structured builder (trigger picker · condition rows ·
// action rows incl. run_tool with its destructive-confirm checkbox ·
// test-with-sample panel), runs drawer.
export default function AutomationsRoute() {
  return (
    <div className="min-h-[calc(100vh-220px)]">
      <AutomationsView />
    </div>
  );
}
