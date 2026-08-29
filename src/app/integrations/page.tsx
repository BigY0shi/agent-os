import { Suspense } from "react";
import IntegrationsView from "@/components/v2/integrations/IntegrationsView";

// Integrations (SPEC-D G1 §6.1) — connector catalog over /api/v2/integrations:
// connect (OAuth / api-key / local), per-account tools ([Try] with a
// destructive-confirm gate), activity, sync runs, memory rules, call logs.
// Suspense wraps the view because it reads useSearchParams (?connected/?error
// from the OAuth callback bounce).
export default function IntegrationsRoute() {
  return (
    <div className="min-h-[calc(100vh-220px)]">
      <Suspense fallback={null}>
        <IntegrationsView />
      </Suspense>
    </div>
  );
}
