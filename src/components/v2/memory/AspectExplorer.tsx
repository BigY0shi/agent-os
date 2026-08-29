"use client";

import { useCallback, useEffect, useState } from "react";
import { Layers, Loader2 } from "lucide-react";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";
import { GRAPH_ASPECTS, VOICE_ASPECTS } from "@/lib/v2/memory/types";
import { ASPECT_COLORS, EmptyState, Eyebrow, fmtDate } from "./shared";

// ── AspectExplorer (SPEC-A A8.3) ─────────────────────────────────────────────
// 12 aspect cards with counts. LOAD-BEARING SPLIT: graph aspects (statements
// table) and voice aspects (voice_aspects table) are queried SEPARATELY — the
// stats route's additive ?facet=aspects returns {graph, voice} as two lists
// and this component never blends them ('Task' deliberately appears in both).
// Click a card → filtered fact list from ?facet=aspects&aspect=&store=.

interface AspectCount { aspect: string; current: number; invalidated: number }
interface FactRow { uuid: string; fact: string; aspect: string; validAt: string; invalidAt: string | null }

type Store = "graph" | "voice";

export default function AspectExplorer() {
  const [counts, setCounts] = useState<{ graph: AspectCount[]; voice: AspectCount[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<{ store: Store; aspect: string } | null>(null);
  const [facts, setFacts] = useState<FactRow[] | null>(null);
  const [factsLoading, setFactsLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/v2/memory/stats?facet=aspects", { cache: "no-store" });
      const j = await r.json();
      if (Array.isArray(j?.graph) && Array.isArray(j?.voice)) {
        setCounts({ graph: j.graph, voice: j.voice });
        setFailed(false);
      }
    } catch { setFailed(true); }
  }, []);

  usePollWhileVisible(refresh, 5000, []);

  useEffect(() => {
    if (!selected) { setFacts(null); return; }
    let alive = true;
    setFactsLoading(true);
    fetch(`/api/v2/memory/stats?facet=aspects&aspect=${encodeURIComponent(selected.aspect)}&store=${selected.store}&limit=200`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && Array.isArray(j?.facts)) setFacts(j.facts as FactRow[]); })
      .catch(() => { /* unreachable */ })
      .finally(() => { if (alive) setFactsLoading(false); });
    return () => { alive = false; };
  }, [selected]);

  const countFor = (store: Store, aspect: string): AspectCount => {
    const list = store === "graph" ? counts?.graph : counts?.voice;
    return list?.find((c) => c.aspect === aspect) ?? { aspect, current: 0, invalidated: 0 };
  };

  function Cards({ store, aspects, title, blurb }: { store: Store; aspects: readonly string[]; title: string; blurb: string }) {
    return (
      <div className="mb-6">
        <div className="flex items-baseline gap-2.5 mb-2">
          <Eyebrow>{title}</Eyebrow>
          <span className="text-[10.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>{blurb}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-2">
          {aspects.map((aspect) => {
            const c = countFor(store, aspect);
            const color = ASPECT_COLORS[aspect] ?? "#9aa";
            const active = selected?.store === store && selected.aspect === aspect;
            return (
              <button
                key={`${store}:${aspect}`}
                onClick={() => setSelected(active ? null : { store, aspect })}
                className="text-left rounded-lg px-3 py-2.5 transition hover:brightness-125"
                style={{
                  border: `1px solid ${active ? color : "var(--panel-border, #2a2436)"}`,
                  background: active ? `${color}10` : "var(--panel, rgba(255,255,255,0.02))",
                }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-[11.5px] font-semibold truncate" style={{ color: "var(--fg, #e8e2f0)" }}>{aspect}</span>
                </div>
                <div className="mt-1.5 text-[18px] font-semibold tracking-tight" style={{ color: counts ? "var(--fg, #e8e2f0)" : "var(--fg-dimmer, #6b6478)" }}>
                  {counts ? c.current : "—"}
                </div>
                <div className="font-mono text-[9.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                  {counts && c.invalidated > 0 ? `+${c.invalidated} invalidated` : "current facts"}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div>
      {failed && !counts && <EmptyState icon={<Layers size={22} />} title="Feed unreachable" />}
      <Cards store="graph" aspects={GRAPH_ASPECTS} title="World graph" blurb="atomic SPO statements — what memory knows about your world" />
      <Cards store="voice" aspects={VOICE_ASPECTS} title="Voice" blurb="stored whole, never split — how you want things done" />

      {selected && (
        <div className="rounded-xl p-4" style={{ border: `1px solid ${ASPECT_COLORS[selected.aspect] ?? "#9aa"}44`, background: "var(--panel, rgba(255,255,255,0.02))" }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full" style={{ background: ASPECT_COLORS[selected.aspect] ?? "#9aa" }} />
            <span className="text-[13px] font-semibold" style={{ color: "var(--fg, #e8e2f0)" }}>
              {selected.aspect} · {selected.store === "graph" ? "world graph" : "voice"}
            </span>
            {factsLoading && <Loader2 size={13} className="animate-spin" style={{ color: "var(--fg-dimmer, #6b6478)" }} />}
          </div>
          {facts === null ? (
            <div className="text-[11.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>loading facts…</div>
          ) : facts.length === 0 ? (
            <div className="text-[11.5px]" style={{ color: "var(--fg-dimmer, #6b6478)" }}>no facts recorded for this aspect yet</div>
          ) : (
            <div className="flex flex-col gap-1.5 max-h-[420px] overflow-y-auto pr-1">
              {facts.map((f) => (
                <div key={f.uuid} className="flex items-baseline gap-2 text-[12.5px] leading-relaxed">
                  <span
                    className={f.invalidAt ? "line-through" : undefined}
                    style={{ color: f.invalidAt ? "var(--fg-dimmer, #6b6478)" : "var(--fg, #e8e2f0)" }}
                  >
                    {f.fact}
                  </span>
                  <span className="ml-auto font-mono text-[10px] shrink-0" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
                    {f.invalidAt ? `until ${fmtDate(f.invalidAt)}` : fmtDate(f.validAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
