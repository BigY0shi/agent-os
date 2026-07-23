"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import ConfigMenu, { useSettings, Field, TextInput, SaveBar } from "./ConfigMenu";
import { useInstalledAgents } from "./AgentPicker";

const ACCENT = "#34d399";
// The CLI agents wired for one-shot completion in the Pipeline (cliComplete in loopEngine).
const CLI_IDS = ["claude", "codex", "cursor", "pi", "hermes"];

// Pipeline provider picker. One dropdown chooses the engine that classifies, plans and
// builds your ideas: your local Ollama daemon (with a model + URL), one of your CLI
// subscriptions (no API key), or your MiniMax coding plan. Writes settings.pipeline.*.
export default function PipelineSettings() {
  const { settings, saving, save } = useSettings();
  const { agents } = useInstalledAgents();
  const [sel, setSel] = useState("ollama");            // "ollama" | "cli:<id>" | "minimax"
  const [model, setModel] = useState("");
  const [ollamaUrl, setOllamaUrl] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [modelsErr, setModelsErr] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const p = settings?.pipeline; if (!p) return;
    setModel(p.model || "");
    setOllamaUrl(p.ollamaUrl || "");
    setSel(p.provider === "cli" ? `cli:${p.agent || "claude"}` : (p.provider || "ollama"));
  }, [settings]);

  const isOllama = sel === "ollama";

  const loadModels = useCallback(async () => {
    setLoadingModels(true); setModelsErr(null);
    try {
      const q = ollamaUrl.trim() ? `?url=${encodeURIComponent(ollamaUrl.trim())}` : "";
      const r = await fetch(`/api/pipeline/models${q}`, { cache: "no-store" });
      const j = await r.json();
      setModels(Array.isArray(j.models) ? j.models : []);
      setModelsErr(j.ok ? null : (j.error || "Couldn't reach Ollama."));
    } catch { setModelsErr("Couldn't reach Ollama."); } finally { setLoadingModels(false); }
  }, [ollamaUrl]);

  useEffect(() => { if (isOllama) loadModels(); }, [isOllama, loadModels]);

  async function onSave() {
    const provider = sel.startsWith("cli:") ? "cli" : (sel as "ollama" | "minimax");
    const agent = sel.startsWith("cli:") ? sel.slice(4) : undefined;
    await save({ pipeline: { provider, ...(agent ? { agent } : {}), model: model.trim(), ollamaUrl: ollamaUrl.trim() } });
    setSaved(true); setTimeout(() => setSaved(false), 1800);
  }

  const installedCli = agents.filter((a) => CLI_IDS.includes(a.id) && a.installed);
  const selectStyle = { background: "var(--panel, rgba(255,255,255,0.02))", border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg, #e8e2f0)" };

  return (
    <ConfigMenu title="Pipeline settings" accent={ACCENT} buttonLabel="Configure">
      <p className="text-[11.5px] mb-4" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        Who classifies, plans and builds your ideas. It all runs on THIS machine and is reachable over your LAN (the dashboard calls these services server-side). No API keys — just your local Ollama or your own CLI subscriptions.
      </p>

      <Field label="Provider" hint="Ollama is local + free; the CLI agents use your own subscriptions; MiniMax uses your coding plan.">
        <select value={sel} onChange={(e) => setSel(e.target.value)}
          className="w-full text-[12.5px] rounded-md px-2.5 py-1.5 outline-none" style={selectStyle}>
          <option value="ollama">Ollama · local (this machine)</option>
          <optgroup label="Your CLI agents — no API key">
            {installedCli.length === 0 && <option disabled>No CLI agents detected</option>}
            {installedCli.map((a) => <option key={a.id} value={`cli:${a.id}`}>{a.label}</option>)}
          </optgroup>
          <option value="minimax">MiniMax · coding plan</option>
          {sel.startsWith("cli:") && !installedCli.some((a) => `cli:${a.id}` === sel) && (
            <option value={sel}>{sel.slice(4)} (not detected)</option>
          )}
        </select>
      </Field>

      {isOllama && (
        <>
          <Field label="Ollama model" hint="Blank = auto-detect (prefers a coder model, else the first installed).">
            <div className="flex gap-1.5">
              <select value={model} onChange={(e) => setModel(e.target.value)}
                className="flex-1 text-[12.5px] rounded-md px-2.5 py-1.5 outline-none" style={selectStyle}>
                <option value="">Auto-detect{loadingModels ? " (loading…)" : models[0] ? ` (→ ${models[0]})` : " (none installed)"}</option>
                {models.map((m) => <option key={m} value={m}>{m}</option>)}
                {model && !models.includes(model) && <option value={model}>{model} (saved)</option>}
              </select>
              <button type="button" onClick={loadModels} title="Refresh model list"
                className="px-2 rounded-md grid place-items-center" style={{ border: "1px solid var(--panel-border,#2a2436)", color: ACCENT }}>
                <RefreshCw size={13} className={loadingModels ? "animate-spin" : ""} />
              </button>
            </div>
          </Field>
          {modelsErr && <p className="text-[11px] -mt-2 mb-3.5" style={{ color: "#fca5b4" }}>{modelsErr}</p>}
          <Field label="Ollama URL" hint="Blank = http://localhost:11434 (this machine). Override for a different host / port.">
            <TextInput placeholder="http://localhost:11434" value={ollamaUrl} onChange={(e) => setOllamaUrl(e.target.value)} />
          </Field>
        </>
      )}

      <SaveBar saving={saving} saved={saved} onSave={onSave} accent={ACCENT} />
    </ConfigMenu>
  );
}
