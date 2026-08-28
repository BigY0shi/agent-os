"use client";

// F5.2 Overview tab — lifecycle stepper (guarded transitions: Deploy runs the
// chunk-3 guard; its 409 is surfaced verbatim, warning mode banners),
// persona/harness summary cards, quick actions.

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { AgentDef, BandStatus, RunMeta } from "@/lib/agentsTypes";
import { INTELLIGENCE_META } from "@/lib/agentsTypes";
import { AGENTS_ACCENT, LIFECYCLE_META, lifecycleOf } from "../shared";

const STEPPER: Array<keyof typeof LIFECYCLE_META> = ["ideation", "forge", "test", "deployed"];

export default function OverviewTab({
  agent,
  system,
  band,
  detail,
  runs,
  patch,
  onRunNow,
  onExile,
}: {
  agent: AgentDef;
  system: string;
  band: BandStatus;
  detail?: string;
  runs: RunMeta[];
  patch: (p: Record<string, unknown>) => Promise<{ ok: boolean; error?: string; warning?: string }>;
  onRunNow: () => Promise<string | null>;
  onExile: () => Promise<void> | void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [harnessName, setHarnessName] = useState<string | null>(null);
  const lc = lifecycleOf(agent);

  useEffect(() => {
    if (!agent.harnessId) { setHarnessName(null); return; }
    fetch("/api/v2/harnesses", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      const h = Array.isArray(j.harnesses) ? j.harnesses.find((x: { id: string }) => x.id === agent.harnessId) : null;
      setHarnessName(h?.name ?? agent.harnessId ?? null);
    }).catch(() => setHarnessName(agent.harnessId ?? null));
  }, [agent.harnessId]);

  async function transition(to: string) {
    setErr(null); setWarning(null);
    const res = await patch({ lifecycle: to });
    if (!res.ok) setErr(res.error ?? "transition failed");
    else if (res.warning) setWarning(res.warning);
  }

  const doneRuns = runs.filter((r) => r.status === "done").length;

  return (
    <div className="space-y-4">
      {/* Lifecycle stepper */}
      <div className="rounded-xl border p-3.5" style={{ borderColor: "var(--panel-border)", background: "rgba(255,255,255,0.02)" }}>
        <div className="text-[10px] font-mono uppercase tracking-widest mb-2.5" style={{ color: "var(--fg-dimmer)" }}>Lifecycle</div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {STEPPER.map((step, i) => (
            <span key={step} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-[10px]" style={{ color: "var(--fg-dimmer)" }}>→</span>}
              <button onClick={() => void transition(step)} disabled={lc === step}
                title={step === "deployed" ? "Deploy — requires a successful test run (or warning mode)" : `Move to ${step}`}
                className="px-2.5 h-7 rounded-md border text-[11px] font-mono transition disabled:cursor-default"
                style={{
                  borderColor: lc === step ? LIFECYCLE_META[step].color : "var(--panel-border)",
                  color: lc === step ? LIFECYCLE_META[step].color : "var(--fg-dim)",
                  background: lc === step ? `${LIFECYCLE_META[step].color}18` : "transparent",
                }}>
                {LIFECYCLE_META[step].label}
              </button>
            </span>
          ))}
          <button onClick={() => void transition("retired")} disabled={lc === "retired"}
            className="ml-2 px-2.5 h-7 rounded-md border text-[11px] font-mono disabled:cursor-default"
            style={{ borderColor: lc === "retired" ? LIFECYCLE_META.retired.color : "var(--panel-border)", color: lc === "retired" ? LIFECYCLE_META.retired.color : "var(--fg-dimmer)" }}>
            retire
          </button>
        </div>
        <div className="text-[11px] mt-2 font-mono" style={{ color: "var(--fg-dimmer)" }}>
          {doneRuns} successful run{doneRuns === 1 ? "" : "s"} · triggers {lc === "deployed" ? "live" : "parked (test/forge lifecycles skip the trigger tick)"}
        </div>
        {err && (
          <div className="mt-2 rounded-lg border px-3 py-2 text-[12px] text-rose-300 flex items-center gap-2" style={{ borderColor: "rgba(248,113,113,0.5)", background: "rgba(248,113,113,0.06)" }}>
            <AlertTriangle size={13} /> {err}
          </div>
        )}
        {warning && (
          <div className="mt-2 rounded-lg border px-3 py-2 text-[12px] text-amber-300 flex items-center gap-2" style={{ borderColor: "rgba(251,191,36,0.5)", background: "rgba(251,191,36,0.06)" }}>
            <AlertTriangle size={13} /> {warning}
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border p-3.5" style={{ borderColor: "var(--panel-border)", background: "rgba(255,255,255,0.02)" }}>
          <div className="text-[10px] font-mono uppercase tracking-widest mb-1.5" style={{ color: "var(--fg-dimmer)" }}>Harness</div>
          <div className="text-[13px]" style={{ color: "var(--fg)" }}>{harnessName ?? "none (plain single run)"}</div>
          <div className="text-[11px] mt-1 font-mono" style={{ color: "var(--fg-dimmer)" }}>
            {INTELLIGENCE_META[agent.intelligence].label} · provider {agent.provider ? (agent.provider.kind === "cli" ? `cli:${agent.provider.agent}` : agent.provider.kind === "ollama" ? `ollama:${agent.provider.model}` : "sdk") : "sdk"}
          </div>
        </div>
        <div className="rounded-xl border p-3.5" style={{ borderColor: "var(--panel-border)", background: "rgba(255,255,255,0.02)" }}>
          <div className="text-[10px] font-mono uppercase tracking-widest mb-1.5" style={{ color: "var(--fg-dimmer)" }}>Persona</div>
          {agent.persona ? (
            <>
              <div className="text-[13px]" style={{ color: "var(--fg)" }}>{agent.persona.name}</div>
              <div className="text-[11px] mt-1 line-clamp-2" style={{ color: "var(--fg-dim)" }}>{agent.persona.voiceRules}</div>
            </>
          ) : (
            <div className="text-[12px]" style={{ color: "var(--fg-dimmer)" }}>none — default voice</div>
          )}
        </div>
      </div>

      {/* Status + instructions */}
      <div className="rounded-xl border p-3.5" style={{ borderColor: "var(--panel-border)", background: "rgba(255,255,255,0.02)" }}>
        <div className="text-[10px] font-mono uppercase tracking-widest mb-1.5" style={{ color: "var(--fg-dimmer)" }}>
          Now: {band}{detail ? ` · ${detail}` : ""}
        </div>
        {agent.description && <div className="text-[12.5px] mb-2" style={{ color: "var(--fg-dim)" }}>{agent.description}</div>}
        <pre className="text-[12px] leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto" style={{ color: "var(--fg-dim)" }}>{system || "(no instructions)"}</pre>
      </div>

      {/* Quick actions */}
      <div className="flex items-center gap-3">
        <button onClick={() => void onRunNow()} className="text-[12px] text-emerald-300">Run now</button>
        <button onClick={() => void patch({ enabled: !agent.enabled })} className="text-[12px]" style={{ color: AGENTS_ACCENT }}>
          {agent.enabled ? "Pause (disable)" : "Resume (enable)"}
        </button>
        <button onClick={() => void onExile()} className="text-[12px] text-rose-300/70 hover:text-rose-300 transition">Exile agent</button>
      </div>
    </div>
  );
}
