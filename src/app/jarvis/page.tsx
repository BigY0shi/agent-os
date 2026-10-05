import { Suspense } from "react";
import JarvisHub from "@/components/jarvis/JarvisHub";

export const metadata = { title: "Jarvis · Agentic OS" };

// Standalone since 2026-07-27 (previously a sub-tab of /hermes). Tabbed since
// 2026-09-28: Console, Oracle, News Radar, Outreach, and the S13-S17 tabs as they land.
// Suspense: JarvisHub reads ?tab= with useSearchParams.
export default function JarvisPage() {
  return (
    <Suspense fallback={null}>
      <JarvisHub />
    </Suspense>
  );
}
