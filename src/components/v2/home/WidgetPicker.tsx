"use client";

// ── WidgetPicker (SPEC-D §6.5, H2.2) ────────────────────────────────────────
// Edit-mode "+ Add widget": a modal grid of registry entries (GET
// /api/v2/widgets). Entries whose data route reports { available: false } are
// shown GREYED WITH THE REASON (honest catalog — the picker never pretends a
// source exists), but stay addable: placeholder-contract widgets render their
// empty-state panel once placed (H3.2 verify line). dataKind 'none' entries
// (the legacy-* wrappers) are always available — their components fetch as
// they already do.

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import type { WidgetData, WidgetDef } from "@/lib/v2/widgets/types";

interface PickerEntry {
  def: WidgetDef;
  /** null while probing; '' = available; anything else = unavailable reason. */
  reason: string | null;
}

export default function WidgetPicker({
  onAdd,
  onClose,
}: {
  onAdd: (def: WidgetDef) => void;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<PickerEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v2/widgets", { cache: "no-store" });
        const j = (await res.json()) as { widgets?: WidgetDef[] };
        const defs = Array.isArray(j.widgets) ? j.widgets : [];
        if (cancelled) return;
        setEntries(defs.map((def) => ({ def, reason: def.dataKind === "none" ? "" : null })));

        // Probe availability per endpoint widget (default/empty config) —
        // greyed-with-reason comes straight from the honest data envelope.
        await Promise.all(
          defs
            .filter((def) => def.dataKind === "endpoint")
            .map(async (def) => {
              let reason = "";
              try {
                const r = await fetch(`/api/v2/widgets/${def.slug}/data`, { cache: "no-store" });
                const d = (await r.json()) as WidgetData;
                if (d && d.available === false) reason = d.reason;
              } catch {
                reason = "data route unreachable";
              }
              if (!cancelled) {
                setEntries((cur) =>
                  cur ? cur.map((e) => (e.def.slug === def.slug ? { ...e, reason } : e)) : cur,
                );
              }
            }),
        );
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
      role="dialog"
      aria-label="Add widget"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-xl p-4"
        style={{
          border: "1px solid var(--panel-border, #2a2436)",
          background: "var(--panel-solid, #17121f)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="font-mono text-[11px] uppercase tracking-wider" style={{ color: "var(--fg-dim, #9aa)" }}>
            Add widget
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-md"
            style={{ border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}
            aria-label="Close the widget picker"
          >
            <X size={13} />
          </button>
        </div>

        {entries === null ? (
          <div className="font-mono text-[11px] py-4" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
            {failed ? "widget catalog unreachable" : "loading catalog…"}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {entries.map(({ def, reason }) => {
              const unavailable = typeof reason === "string" && reason.length > 0;
              return (
                <button
                  key={def.slug}
                  type="button"
                  onClick={() => onAdd(def)}
                  className="rounded-lg px-3 py-2.5 text-left"
                  style={{
                    border: "1px solid var(--panel-border, #2a2436)",
                    opacity: unavailable ? 0.55 : 1,
                    background: "var(--panel, rgba(255,255,255,0.02))",
                  }}
                  title={unavailable ? reason : `Add '${def.title}'`}
                >
                  <div className="flex items-center gap-2">
                    <Plus size={12} style={{ color: "#7dd3a8" }} aria-hidden />
                    <span className="text-[13px] font-medium" style={{ color: "var(--fg, #e8e2f0)" }}>
                      {def.title}
                    </span>
                    <span className="ml-auto font-mono text-[9px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                      {def.slug}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] leading-snug" style={{ color: "var(--fg-dim, #9aa)" }}>
                    {def.description}
                  </div>
                  {reason === null ? (
                    <div className="mt-1 font-mono text-[10px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                      checking source…
                    </div>
                  ) : unavailable ? (
                    <div className="mt-1 font-mono text-[10px]" style={{ color: "#fbbf24" }}>
                      not available: {reason}
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
