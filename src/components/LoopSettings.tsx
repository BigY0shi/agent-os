"use client";

import { useEffect, useState } from "react";
import ConfigMenu, { useSettings, Field, TextInput, SaveBar } from "./ConfigMenu";
import { WORKERS, JUDGES, DEFAULT_WORKER, DEFAULT_JUDGE, normalizeJudge } from "@/lib/loopModels";

const ACCENT = "#2dd4bf";
const selectStyle = { background: "var(--panel, rgba(255,255,255,0.02))", border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg, #e8e2f0)" };
const clamp = (n: number, lo: number, hi: number, d: number) => (Number.isFinite(n) && n > 0 ? Math.min(hi, Math.max(lo, Math.round(n))) : d);

// Loop config (rule 16; owner 2026-09-30: "every parameter needs to be in the settings").
// Builder + judge defaults, the judge fallback (the owner's own choice, rule 20, labelled in
// every verdict it grades), the Ollama Cloud model, and the run limits. Read per request by
// /api/loop/run, so a save takes effect on the next run with no rebuild.
export default function LoopSettings() {
  const { settings, saving, save } = useSettings();
  const [builder, setBuilder] = useState(DEFAULT_WORKER);
  const [judge, setJudge] = useState(DEFAULT_JUDGE);
  const [fallback, setFallback] = useState<"none" | "ollama-cloud">("none");
  const [ollamaModel, setOllamaModel] = useState("");
  const [maxRounds, setMaxRounds] = useState("4");
  const [builderSec, setBuilderSec] = useState("240");
  const [judgeSec, setJudgeSec] = useState("180");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    const l = (settings.loop || {}) as Record<string, unknown>;
    setBuilder(String(l.builder || DEFAULT_WORKER));
    setJudge(normalizeJudge(String(l.judge || DEFAULT_JUDGE)));
    setFallback(l.judgeFallback === "ollama-cloud" ? "ollama-cloud" : "none");
    setOllamaModel(String(l.ollamaModel || ""));
    setMaxRounds(String(l.maxRounds ?? 4));
    setBuilderSec(String(l.builderTimeoutSec ?? 240));
    setJudgeSec(String(l.judgeTimeoutSec ?? 180));
  }, [settings]);

  async function onSave() {
    await save({
      loop: {
        builder, judge, judgeFallback: fallback, ollamaModel: ollamaModel.trim(),
        maxRounds: clamp(Number(maxRounds), 2, 8, 4),
        builderTimeoutSec: clamp(Number(builderSec), 30, 1800, 240),
        judgeTimeoutSec: clamp(Number(judgeSec), 30, 1800, 180),
      },
    });
    setSaved(true); setTimeout(() => setSaved(false), 1800);
  }

  return (
    <ConfigMenu title="Loop settings" accent={ACCENT} buttonLabel="Configure">
      <p className="text-[11.5px] mb-4" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        The Loop runs on your CLI agents (your subscriptions, no API keys). The judge can also be Ollama Cloud.
      </p>
      <Field label="Default builder" hint="The CLI agent that builds. The page starts on this; you can still switch per run.">
        <select value={builder} onChange={(e) => setBuilder(e.target.value)} className="w-full text-[12.5px] rounded-md px-2.5 py-1.5 outline-none" style={selectStyle}>
          {WORKERS.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
        </select>
      </Field>
      <Field label="Default judge" hint="Who grades each round. Codex is a good independent critic.">
        <select value={judge} onChange={(e) => setJudge(e.target.value)} className="w-full text-[12.5px] rounded-md px-2.5 py-1.5 outline-none" style={selectStyle}>
          {JUDGES.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
        </select>
      </Field>
      <Field label="Judge fallback" hint="If a CLI judge returns nothing usable: fail the round (None), or let Ollama Cloud grade it. A fallback grade always says so in the round.">
        <select value={fallback} onChange={(e) => setFallback(e.target.value === "ollama-cloud" ? "ollama-cloud" : "none")} className="w-full text-[12.5px] rounded-md px-2.5 py-1.5 outline-none" style={selectStyle}>
          <option value="none">None: the round fails with the reason</option>
          <option value="ollama-cloud">Ollama Cloud (needs OLLAMA_API_KEY)</option>
        </select>
      </Field>
      <Field label="Ollama Cloud model" hint="For the Ollama Cloud judge and fallback. Blank = picked from your account's models (Kimi K2.6 first, then MiniMax M3, then GLM).">
        <TextInput placeholder="e.g. kimi-k2.6:cloud (blank = auto)" value={ollamaModel} onChange={(e) => setOllamaModel(e.target.value)} />
      </Field>
      <Field label="Default max rounds" hint="2 to 8.">
        <TextInput type="number" min={2} max={8} value={maxRounds} onChange={(e) => setMaxRounds(e.target.value)} />
      </Field>
      <Field label="Builder time limit (seconds)" hint="How long the builder may take per round (30 to 1800).">
        <TextInput type="number" min={30} max={1800} value={builderSec} onChange={(e) => setBuilderSec(e.target.value)} />
      </Field>
      <Field label="Judge time limit (seconds)" hint="How long a CLI judge may take per round (30 to 1800).">
        <TextInput type="number" min={30} max={1800} value={judgeSec} onChange={(e) => setJudgeSec(e.target.value)} />
      </Field>
      <SaveBar saving={saving} saved={saved} onSave={onSave} accent={ACCENT} />
    </ConfigMenu>
  );
}
