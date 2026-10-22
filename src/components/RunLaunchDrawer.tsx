"use client";

// RunLaunchDrawer — the pre-launch settings drawer (roadmap S3).
//
// Owner decision 2026-09-02: configuration happens BEFORE a run launches, in
// this drawer, and the ONLY mid-run control is STOP (RunsTray). No live editing
// of constraints. The drawer is where skills get applied and guardrails
// added or removed. It renders exactly the fields lib/launchOptions.ts declares
// for the module (seat, skills from /api/skills, that module's guardrails,
// extra instructions), persists the last-used values to settings.launch.<module>
// on Launch (rule 16: visible in-app, no config file), and hands the same
// object to the caller, which sends it in the POST body.
//
// While a run for this module is in flight (the caller says so, or /api/runs
// lists one) every field is disabled and Launch is replaced by the STOP hint:
// the drawer is not a control surface for a live run.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Loader2, Rocket, Square, X, ShieldCheck, Sparkles, Cpu, PenLine } from "lucide-react";
import { useSettings } from "@/components/ConfigMenu";
import {
  LAUNCH_MODULE_DEFS, MAX_INSTRUCTIONS_CHARS, resolveLaunchOptions,
  type LaunchModule, type LaunchOptions,
} from "@/lib/launchOptions";

interface Props {
  module: LaunchModule;
  open: boolean;
  onClose: () => void;
  /** Called with the validated options after they were persisted. The caller launches. */
  onLaunch: (launch: LaunchOptions) => void | Promise<void>;
  /** The caller's own "in flight" flag (planning / generating / running). */
  busy?: boolean;
  /** Button text, e.g. "Plan calendar" / "Generate materials". */
  launchLabel: string;
  /** What is about to run, in the caller's words (goal, slot, card count). */
  summary?: ReactNode;
  accent?: string;
  title?: string;
}

interface InstalledSkill { name: string; description: string }

export default function RunLaunchDrawer({ module, open, onClose, onLaunch, busy = false, launchLabel, summary, accent = "#22d3ee", title }: Props) {
  const def = LAUNCH_MODULE_DEFS[module];
  const { settings, save } = useSettings();
  const [opts, setOpts] = useState<LaunchOptions | null>(null);
  const [installed, setInstalled] = useState<InstalledSkill[]>([]);
  const [inFlight, setInFlight] = useState<string | null>(null); // label of the live run, if any
  const [launching, setLaunching] = useState(false);
  const [err, setErr] = useState("");

  // Pre-fill from settings.launch.<module> (lenient: a stale stored value falls
  // back to defaults field by field, and the drawer shows what will actually run).
  useEffect(() => {
    if (!open || !settings) return;
    const stored = (settings as { launch?: Partial<Record<string, unknown>> }).launch?.[module];
    const r = resolveLaunchOptions(module, undefined, stored);
    setOpts(r.ok ? r.value : null);
  }, [open, settings, module]);

  // Installed skills (the same list the Config menu toggles come from).
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch("/api/skills", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (alive && Array.isArray(j?.installed)) setInstalled(j.installed); })
      .catch(() => { /* offline: the skills list is simply empty */ });
    return () => { alive = false; };
  }, [open]);

  // Is a run of this module already in flight? Then the drawer is read-only.
  const probe = useCallback(async () => {
    try {
      const r = await fetch("/api/runs?limit=40", { cache: "no-store" });
      const j = (await r.json()) as { ok?: boolean; runs?: { module: string; status: string; label: string }[] };
      const live = j.runs?.find((x) => x.module === module && x.status === "running");
      setInFlight(live ? live.label : null);
    } catch { setInFlight(null); }
  }, [module]);
  useEffect(() => {
    if (!open) return;
    void probe();
    const t = setInterval(() => void probe(), 4000);
    return () => clearInterval(t);
  }, [open, probe]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const locked = busy || !!inFlight || launching;
  const skillsOn = useMemo(() => new Set(opts?.skills ?? []), [opts]);

  const launch = async () => {
    if (!opts || locked) return;
    setErr("");
    setLaunching(true);
    try {
      // Persist first, so the drawer opens pre-filled next time even if the
      // route rejects the launch; then hand the same object to the caller.
      const saved = await save({ launch: { [module]: opts } } as never);
      if (!saved) setErr("Could not save the launch settings (offline?). Launching with them anyway.");
      await onLaunch(opts);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLaunching(false);
    }
  };

  if (!open) return null;

  const dim = "var(--fg-dim, #9aa3b2)";
  const dimmer = "var(--fg-dimmer, #6b6478)";
  const border = "1px solid var(--panel-border, #2a2436)";

  return (
    <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true" aria-label={`${def.label} launch settings`}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative h-full w-full max-w-[460px] overflow-y-auto p-5 shadow-2xl" style={{ background: "var(--bg, #0b0713)", borderLeft: `1px solid ${accent}55` }}>
        <div className="flex items-center justify-between mb-1">
          <div className="inline-flex items-center gap-2 text-[14px] font-semibold" style={{ color: "var(--fg, #e8e2f0)" }}>
            <Rocket size={15} style={{ color: accent }} /> {title ?? `Before launch · ${def.label}`}
          </div>
          <button onClick={onClose} className="hover:text-white" style={{ color: dimmer }} aria-label="Close"><X size={16} /></button>
        </div>
        <p className="text-[11px] mb-4 leading-relaxed" style={{ color: dimmer }}>
          Set the run up here. Once it launches the only control is <b>Stop</b>, in the runs tray. Last-used values are remembered per module.
        </p>

        {summary && (
          <div className="rounded-lg px-3 py-2 mb-4 text-[12px]" style={{ background: `${accent}14`, border: `1px solid ${accent}40`, color: "var(--fg, #e8e2f0)" }}>
            {summary}
          </div>
        )}

        {(busy || inFlight) && (
          <div className="rounded-lg px-3 py-2.5 mb-4 text-[12px] flex items-start gap-2" style={{ background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.4)", color: "#fbbf24" }}>
            <Square size={13} className="mt-0.5 shrink-0" />
            <span>
              A {def.label} run is in flight{inFlight ? `: ${inFlight}` : ""}. These settings are locked until it finishes or you press <b>Stop</b> in the runs tray.
            </span>
          </div>
        )}

        {!opts ? (
          <div className="text-[12px] inline-flex items-center gap-2" style={{ color: dim }}><Loader2 size={13} className="animate-spin" /> loading settings…</div>
        ) : (
          <fieldset disabled={locked} className="space-y-5 disabled:opacity-60">
            {/* Seat */}
            <section>
              <div className="text-[12px] font-semibold mb-1 inline-flex items-center gap-1.5" style={{ color: "var(--fg, #e8e2f0)" }}><Cpu size={12} style={{ color: accent }} /> Seat</div>
              <select
                value={opts.agent}
                onChange={(e) => setOpts({ ...opts, agent: e.target.value })}
                className="w-full text-[12.5px] rounded-md px-2.5 py-1.5 outline-none"
                style={{ background: "var(--bg, #0b0713)", border, color: "var(--fg, #e8e2f0)" }}
              >
                {def.seats.map((s) => <option key={s.id} value={s.id} style={{ background: "#14101c" }}>{s.label}</option>)}
              </select>
            </section>

            {/* Skills */}
            <section>
              <div className="text-[12px] font-semibold mb-1 inline-flex items-center gap-1.5" style={{ color: "var(--fg, #e8e2f0)" }}><Sparkles size={12} style={{ color: accent }} /> Skills for this run</div>
              <p className="text-[10.5px] mb-1.5" style={{ color: dimmer }}>
                Applied on top of the global and module skills from the Config menu. Same text, whichever seat runs.
              </p>
              {installed.length === 0 ? (
                <div className="text-[11.5px]" style={{ color: dimmer }}>No skills installed at ~/.agentic-os/skills.</div>
              ) : (
                <div className="space-y-1.5">
                  {installed.map((s) => (
                    <label key={s.name} className="flex items-start gap-2 text-[12px] cursor-pointer select-none" style={{ color: "var(--fg, #e8e2f0)" }}>
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={skillsOn.has(s.name)}
                        onChange={() => {
                          const next = new Set(skillsOn);
                          if (next.has(s.name)) next.delete(s.name); else next.add(s.name);
                          setOpts({ ...opts, skills: [...next] });
                        }}
                        style={{ accentColor: accent }}
                      />
                      <span className="min-w-0">
                        <span className="font-medium">{s.name}</span>
                        {s.description && <span className="block text-[10.5px] truncate" title={s.description} style={{ color: dimmer }}>{s.description}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </section>

            {/* Guardrails */}
            <section>
              <div className="text-[12px] font-semibold mb-1 inline-flex items-center gap-1.5" style={{ color: "var(--fg, #e8e2f0)" }}><ShieldCheck size={12} style={{ color: accent }} /> Guardrails</div>
              <div className="space-y-2.5">
                {def.guardrails.map((g) => (
                  <label key={g.key} className="flex items-center justify-between gap-3 text-[12px]" style={{ color: "var(--fg, #e8e2f0)" }}>
                    <span className="min-w-0">
                      <span className="block">{g.label}</span>
                      <span className="block text-[10.5px]" style={{ color: dimmer }}>{g.hint}</span>
                    </span>
                    {g.kind === "boolean" ? (
                      <input
                        type="checkbox"
                        checked={opts.guardrails[g.key] === true}
                        onChange={(e) => setOpts({ ...opts, guardrails: { ...opts.guardrails, [g.key]: e.target.checked } })}
                        style={{ accentColor: accent }}
                      />
                    ) : (
                      <input
                        type="number"
                        min={g.min}
                        max={g.max}
                        value={Number(opts.guardrails[g.key])}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (!Number.isFinite(v)) return;
                          const clamped = Math.min(g.max ?? v, Math.max(g.min ?? v, v));
                          setOpts({ ...opts, guardrails: { ...opts.guardrails, [g.key]: clamped } });
                        }}
                        className="w-20 text-[12px] rounded-md px-2 py-1 outline-none text-right"
                        style={{ background: "var(--bg, #0b0713)", border, color: "var(--fg, #e8e2f0)" }}
                      />
                    )}
                  </label>
                ))}
              </div>
            </section>

            {/* Instructions */}
            <section>
              <div className="text-[12px] font-semibold mb-1 inline-flex items-center gap-1.5" style={{ color: "var(--fg, #e8e2f0)" }}><PenLine size={12} style={{ color: accent }} /> Extra instructions</div>
              <textarea
                value={opts.instructions}
                maxLength={MAX_INSTRUCTIONS_CHARS}
                onChange={(e) => setOpts({ ...opts, instructions: e.target.value })}
                rows={3}
                placeholder="Anything the seat must honor on this run. Appended to the prompt."
                className="w-full text-[12.5px] rounded-md px-2.5 py-1.5 outline-none resize-y"
                style={{ background: "var(--panel, rgba(255,255,255,0.02))", border, color: "var(--fg, #e8e2f0)" }}
              />
              <div className="text-[10px] text-right" style={{ color: dimmer }}>{opts.instructions.length}/{MAX_INSTRUCTIONS_CHARS}</div>
            </section>
          </fieldset>
        )}

        {err && <div className="text-[12px] mt-3" style={{ color: "#f87171" }}>{err}</div>}

        <div className="flex items-center gap-2 mt-5">
          {locked && !launching ? (
            <div className="text-[12px] inline-flex items-center gap-1.5" style={{ color: "#fbbf24" }}>
              <Square size={12} /> In flight. Stop it from the runs tray.
            </div>
          ) : (
            <button
              onClick={() => void launch()}
              disabled={!opts || locked}
              className="inline-flex items-center gap-1.5 px-4 h-9 rounded-lg text-[13px] font-semibold disabled:opacity-50"
              style={{ background: accent, color: "#04221c" }}
            >
              {launching ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={14} />}
              {launching ? "Launching…" : launchLabel}
            </button>
          )}
          <button onClick={onClose} className="px-3 h-9 rounded-lg text-[12.5px]" style={{ color: dim, border }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
