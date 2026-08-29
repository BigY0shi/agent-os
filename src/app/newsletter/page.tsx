import { Suspense } from "react";
import NewsletterView from "@/components/v2/newsletter/NewsletterView";

// /newsletter (SPEC-F K4.2/K4.3) — the daily paper assembled from newsletters
// delivered to per-source addy.io aliases, plus the subscription manager.
// The view reads ?tab= and ?date= (the archive deep link), so useSearchParams
// needs a Suspense boundary (Next CSR-bailout requirement — same as /anynotes).

export const metadata = { title: "Newsletter · Agentic OS" };

export default function NewsletterRoute() {
  return (
    <div className="min-h-[calc(100vh-220px)]">
      <Suspense fallback={null}>
        <NewsletterView />
      </Suspense>
    </div>
  );
}
