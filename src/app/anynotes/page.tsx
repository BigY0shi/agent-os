import { Suspense } from "react";
import AnyNotesView from "@/components/v2/anynotes/AnyNotesView";

// /anynotes (SPEC-F I3.3/I3.4) — the capture inbox: paste a URL, drop or paste
// a screenshot, jot a text note; talk to Jarvis in each note's reply thread.
// The view reads ?capture= (bookmarklet auto-capture) and ?note= (detail deep
// link, the route I4.1's attention.flag points at), so useSearchParams needs a
// Suspense boundary (Next CSR-bailout requirement — same as /agents/[id]).

export const metadata = { title: "AnyNotes · Agentic OS" };

export default function AnyNotesRoute() {
  return (
    <div className="min-h-[calc(100vh-220px)]">
      <Suspense fallback={null}>
        <AnyNotesView />
      </Suspense>
    </div>
  );
}
