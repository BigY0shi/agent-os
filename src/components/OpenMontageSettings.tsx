"use client";

import { useEffect, useState } from "react";
import ConfigMenu, { useSettings, Field, TextInput, SaveBar } from "./ConfigMenu";
import AgentPicker from "./AgentPicker";

const ACCENT = "#f97316";

// OpenMontage gear (rule 16): the checkout, the python used for preflight and
// the dependency check, where projects land, which CLI drives a run, and the
// owner-chosen labelled fallback (rule 20).
export default function OpenMontageSettings({ defaults }: { defaults?: { repoPath: string; outputDir: string } }) {
  const { settings, saving, save } = useSettings();
  const [repoPath, setRepoPath] = useState("");
  const [pythonBin, setPythonBin] = useState("python");
  const [outputDir, setOutputDir] = useState("");
  const [agent, setAgent] = useState("claude");
  const [fallbackAgent, setFallbackAgent] = useState<"codex" | "none">("codex");
  const [timeoutMin, setTimeoutMin] = useState("90");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    const o = (settings.openmontage || {}) as Record<string, unknown>;
    setRepoPath(typeof o.repoPath === "string" ? o.repoPath : "");
    setPythonBin(typeof o.pythonBin === "string" && o.pythonBin ? o.pythonBin : "python");
    setOutputDir(typeof o.outputDir === "string" ? o.outputDir : "");
    setAgent(typeof o.agent === "string" && o.agent ? o.agent : "claude");
    setFallbackAgent(o.fallbackAgent === "none" ? "none" : "codex");
    setTimeoutMin(String(typeof o.timeoutMin === "number" && o.timeoutMin > 0 ? o.timeoutMin : 90));
  }, [settings]);

  async function onSave() {
    const t = Number(timeoutMin);
    await save({ openmontage: {
      repoPath: repoPath.trim(), pythonBin: pythonBin.trim() || "python", outputDir: outputDir.trim(),
      agent, fallbackAgent, timeoutMin: Number.isFinite(t) && t > 0 ? Math.round(t) : 90,
    } });
    setSaved(true); setTimeout(() => setSaved(false), 1800);
  }

  const pill = (active: boolean) => active
    ? { background: `${ACCENT}22`, border: `1px solid ${ACCENT}`, color: "var(--fg, #e8e2f0)" }
    : { border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" };

  return (
    <ConfigMenu title="OpenMontage settings" accent={ACCENT} buttonLabel="Configure">
      <p className="text-[11.5px] mb-4" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        Your own OpenMontage checkout, driven by your own CLI agent. Nothing is installed from here.
      </p>
      <Field label="Repo path" hint={`The OpenMontage clone (holds AGENT_GUIDE.md and pipeline_defs/). Empty = ${defaults?.repoPath || "~/Documents/OpenMontage"}.`}>
        <TextInput placeholder={defaults?.repoPath || "C:/Users/you/Documents/OpenMontage"} value={repoPath} onChange={(e) => setRepoPath(e.target.value)} />
      </Field>
      <Field label="Python executable" hint="Used for Preflight and the dependency check. On Windows this is python, or the checkout's .venv/Scripts/python.exe.">
        <TextInput placeholder="python" value={pythonBin} onChange={(e) => setPythonBin(e.target.value)} />
      </Field>
      <Field label="Output directory" hint={`Where projects/<id>/ are written and listed. Empty = ${defaults?.outputDir || "<repo>/projects"}, which is what the Backlot board watches.`}>
        <TextInput placeholder={defaults?.outputDir || "<repo>/projects"} value={outputDir} onChange={(e) => setOutputDir(e.target.value)} />
      </Field>
      <Field label="CLI agent" hint="Drives the pipeline inside the checkout (AGENT_GUIDE.md Rule Zero: the agent is the orchestrator).">
        <AgentPicker value={agent} onChange={setAgent} kinds={["cli"]} includeIds={["claude", "codex", "cursor", "hermes"]} accent={ACCENT} />
      </Field>
      <Field label="Fallback agent" hint="Only when the chosen CLI cannot start. The run says who actually ran.">
        <div className="flex gap-2">
          {([["codex", "Codex"], ["none", "None (fail instead)"]] as const).map(([v, l]) => (
            <button key={v} onClick={() => setFallbackAgent(v)} className="px-3 h-8 rounded-lg text-[12px] font-medium transition" style={pill(fallbackAgent === v)}>{l}</button>
          ))}
        </div>
      </Field>
      <Field label="Run timeout (minutes)" hint="A pipeline still running after this is killed and marked error.">
        <TextInput inputMode="numeric" placeholder="90" value={timeoutMin} onChange={(e) => setTimeoutMin(e.target.value)} />
      </Field>
      <SaveBar saving={saving} saved={saved} onSave={onSave} accent={ACCENT} />
    </ConfigMenu>
  );
}
