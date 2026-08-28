"use client";

// ── ScratchpadSlot (SPEC-D §6.4, H1.1) ──────────────────────────────────────
// The B5 daily-scratchpad surface slot on the Overview page. Feature-detects
// the /today page module via a dynamic import try/catch (§6.4) — the module
// EXISTS since Phase 2 (src/components/v2/pages/ScratchpadView), so the live
// path renders it; the catch arm keeps the Overview alive if the module is
// ever absent/broken (dashed placeholder, never a crash).
// settings.home.showScratchpad === false hides the slot entirely.

import React, { Suspense, useMemo } from "react";
import Link from "next/link";
import { NotebookPen } from "lucide-react";
import { useSettings } from "@/components/ConfigMenu";

function ScratchpadMissing() {
  return (
    <div
      className="rounded-xl px-4 py-3 text-[12px]"
      style={{ border: "1px dashed var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}
    >
      Today's scratchpad arrives with Tasks V2.
    </div>
  );
}

export default function ScratchpadSlot() {
  const { settings } = useSettings();

  // Feature-detect once per mount: import failure → placeholder, not a crash.
  const LazyScratchpad = useMemo(
    () =>
      React.lazy(() =>
        import("@/components/v2/pages/ScratchpadView")
          .then((m) => ({ default: m.default }))
          .catch(() => ({ default: ScratchpadMissing })),
      ),
    [],
  );

  // Default true; only an explicit false hides the slot (§6.4 toggle).
  if ((settings?.home as { showScratchpad?: boolean } | undefined)?.showScratchpad === false) {
    return null;
  }

  return (
    <section aria-label="Today's scratchpad">
      <div className="mb-2 flex items-center justify-between">
        <div
          className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider"
          style={{ color: "#93c5fd" }}
        >
          <NotebookPen size={12} /> Today
        </div>
        <Link
          href="/today"
          className="font-mono text-[10px] hover:underline"
          style={{ color: "var(--fg-dimmer, #6b6478)" }}
        >
          open /today →
        </Link>
      </div>
      <Suspense
        fallback={
          <div className="font-mono text-[11px] py-2" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
            loading scratchpad…
          </div>
        }
      >
        <LazyScratchpad />
      </Suspense>
    </section>
  );
}
