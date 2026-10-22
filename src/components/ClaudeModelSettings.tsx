"use client";

import { useEffect, useState } from "react";
import ConfigMenu, { useSettings, Field, TextInput, SaveBar } from "./ConfigMenu";
import { ULTRACODE_MODELS, isUltracodeModel } from "@/lib/ultracodeModels";

const ACCENT = "#d97757";
const CUSTOM = "__custom__";
const DEFAULT_MODEL = "claude-opus-4-8";
const selectStyle = { background: "var(--panel, rgba(255,255,255,0.02))", border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg, #e8e2f0)" };

// The Claude chat model (S30; owner 2026-09-30: "every parameter needs to be in the settings").
// Every `claude -p --model` call outside Ultracode uses it: this chat, Deal Desk, Hire, Idea
// Engine, SEO, video, the Loop builder, Jarvis's brain, and any blank "Deep tier" / writer
// field. The picker offers the same four models as Ultracode plus a custom id; saved to
// settings.claude.model and read per request, so it applies to the next call. When
// AGENTIC_OS_CLAUDE_MODEL or config.json's claudeModel is set, that older override wins and
// the note here says so (GET /api/claude/model), rather than showing a choice not in use.
export default function ClaudeModelSettings() {
  const { settings, saving, save } = useSettings();
  const [choice, setChoice] = useState(DEFAULT_MODEL);
  const [custom, setCustom] = useState("");
  const [live, setLive] = useState<{ model: string; source: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
    const m = String(((settings.claude || {}) as { model?: string }).model || DEFAULT_MODEL);
    if (ULTRACODE_MODELS.some((x) => x.id === m)) { setChoice(m); setCustom(""); }
    else { setChoice(CUSTOM); setCustom(m); }
  }, [settings]);

  const loadLive = () => fetch("/api/claude/model", { cache: "no-store" }).then((r) => r.json()).then((j) => { if (j?.model) setLive({ model: j.model, source: j.source }); }).catch(() => {});
  useEffect(() => { void loadLive(); }, []);

  async function onSave() {
    const model = (choice === CUSTOM ? custom : choice).trim();
    if (!isUltracodeModel(model)) { setErr(`"${model}" is not a claude model id (claude-… or an alias like opus, sonnet, fable, haiku).`); return; }
    setErr(null);
    await save({ claude: { model } });
    await loadLive();
    setSaved(true); setTimeout(() => setSaved(false), 1800);
  }

  const overridden = live && (live.source === "env" || live.source === "config.json");

  return (
    <ConfigMenu title="Claude model" accent={ACCENT} buttonLabel="Model">
      <p className="text-[11.5px] mb-4" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        The model for every Claude call outside Ultracode: this chat, Deal Desk, Hire Engine, Idea Engine, SEO, video, the Loop builder and Jarvis. Applies to the next call, no restart.
      </p>
      {overridden && (
        <p role="status" className="text-[11px] mb-3 rounded-md px-2.5 py-2" style={{ border: `1px solid ${ACCENT}66`, color: "var(--fg, #e8e2f0)" }}>
          Overridden: <span className="mono">{live.model}</span> is in use because {live.source === "env" ? "AGENTIC_OS_CLAUDE_MODEL is set in the environment" : "claudeModel is set in ~/.agentic-os/config.json"}. Clear that to use the choice below.
        </p>
      )}
      <Field label="Model" hint="Opus 5.5, Sonnet 5.5, Fable 5.1, Opus 5, or a custom id. Default claude-opus-4-8.">
        <select value={choice} onChange={(e) => setChoice(e.target.value)} className="w-full text-[12.5px] rounded-md px-2.5 py-1.5 outline-none" style={selectStyle}>
          {ULTRACODE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          <option value={CUSTOM}>Custom…</option>
        </select>
      </Field>
      {choice === CUSTOM && (
        <Field label="Custom model id" hint="A full claude model id, or an alias the CLI accepts (opus, sonnet, fable, haiku).">
          <TextInput value={custom} placeholder={DEFAULT_MODEL} onChange={(e) => setCustom(e.target.value)} />
        </Field>
      )}
      {err && <p role="alert" className="text-[11px] mb-3 text-red-300">{err}</p>}
      <SaveBar saving={saving} saved={saved} onSave={onSave} accent={ACCENT} />
      {live && !overridden && (
        <p className="text-[10.5px] mt-3" style={{ color: "var(--fg-dimmer, #6b6478)" }}>In use now: <span className="mono">{live.model}</span>{live.source === "default" ? " (default)" : ""}.</p>
      )}
    </ConfigMenu>
  );
}
