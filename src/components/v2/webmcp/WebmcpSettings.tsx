"use client";

// SPEC-C D3 — WebMCP settings gear (rule 16: every knob has an in-app gear).
// Rendered as ConfigMenu children. Maps to settings.webmcp via the standard
// PATCH /api/settings deep-merge. Toggles persist immediately; the number
// field saves via the SaveBar (MemorySettings idiom).

import { useEffect, useState } from "react";
import { useSettings, Field, TextInput, SaveBar } from "@/components/ConfigMenu";
import { WEBMCP_ACCENT } from "./shared";

export default function WebmcpSettings() {
  const { settings, saving, save } = useSettings();
  const [timeoutDraft, setTimeoutDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const webmcp = (settings?.webmcp ?? {}) as {
    sandboxTimeoutMs?: number;
    allowJsHandlers?: boolean;
    llmGetActions?: boolean;
    wizardAgent?: string;
    wizardFallback?: string;
  };
  // S7 wizard seats. One-shot CLI agents (antigravity prints nothing to a pipe); the
  // fallback is the owner's choice and every wizard reply says who answered (rule 20).
  const WIZARD_AGENT_OPTIONS = ["claude", "codex", "cursor", "pi", "hermes"];
  const wizardAgent = (webmcp.wizardAgent || "claude").toLowerCase();
  const wizardFallback = (webmcp.wizardFallback || "codex").toLowerCase();
  const selectStyle: React.CSSProperties = {
    background: "var(--panel, rgba(255,255,255,0.03))",
    border: "1px solid var(--panel-border, #2a2436)",
    color: "var(--fg, #e8e2f0)",
  };
  const allowJs = webmcp.allowJsHandlers !== false;
  const llmGetActions = webmcp.llmGetActions !== false;

  useEffect(() => {
    if (settings && timeoutDraft === null) {
      setTimeoutDraft(String(webmcp.sandboxTimeoutMs ?? 5000));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const saveTimeout = async () => {
    const n = Number(timeoutDraft);
    const sandboxTimeoutMs = Number.isFinite(n) && n >= 250 ? Math.round(n) : 5000;
    setTimeoutDraft(String(sandboxTimeoutMs));
    await save({ webmcp: { ...webmcp, sandboxTimeoutMs } });
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  return (
    <div>
      <Field
        label="JS sandbox timeout (ms)"
        hint="Wall-clock cap for 'js' handler runs (node:vm). Default 5000."
      >
        <TextInput
          value={timeoutDraft ?? ""}
          onChange={(e) => setTimeoutDraft(e.target.value)}
          inputMode="numeric"
          placeholder="5000"
        />
      </Field>
      <SaveBar saving={saving} saved={saved} onSave={saveTimeout} accent={WEBMCP_ACCENT} />

      <label className="mt-4 flex items-start gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={allowJs}
          onChange={(e) => save({ webmcp: { ...webmcp, allowJsHandlers: e.target.checked } })}
          className="mt-[2px]"
          style={{ accentColor: WEBMCP_ACCENT }}
        />
        <span>
          <span className="block text-[12px] font-medium" style={{ color: "var(--fg, #e8e2f0)" }}>
            Allow JS handlers
          </span>
          <span className="block text-[10.5px] leading-relaxed" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
            Gates creation of &apos;js&apos;-kind tools. The sandbox is crash/timeout isolation only — NOT a
            security boundary; code runs with server privileges on this single-user box.
          </span>
        </span>
      </label>

      <label className="mt-3 flex items-start gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={llmGetActions}
          onChange={(e) => save({ webmcp: { ...webmcp, llmGetActions: e.target.checked } })}
          className="mt-[2px]"
          style={{ accentColor: WEBMCP_ACCENT }}
        />
        <span>
          <span className="block text-[12px] font-medium" style={{ color: "var(--fg, #e8e2f0)" }}>
            LLM-filtered tool discovery
          </span>
          <span className="block text-[10.5px] leading-relaxed" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
            get_actions picks the 1–3 most relevant tools via the memory-provider model (low tier).
            Off = plain keyword scoring. LLM failures always fall back to the full tool list, never fewer.
          </span>
        </span>
      </label>

      <Field label="Wizard agent" hint="Digests the description, proposes the tool list, emits the JSON and proofreads. Default claude.">
        <select value={wizardAgent} onChange={(e) => save({ webmcp: { ...webmcp, wizardAgent: e.target.value } })} className="w-full rounded-lg px-2.5 h-8 text-[12px] outline-none" style={selectStyle}>
          {WIZARD_AGENT_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </Field>
      <Field label="Wizard fallback" hint="Answers when the wizard agent fails; the reply says who answered and why. none = the step fails instead. Default codex.">
        <select value={wizardFallback} onChange={(e) => save({ webmcp: { ...webmcp, wizardFallback: e.target.value } })} className="w-full rounded-lg px-2.5 h-8 text-[12px] outline-none" style={selectStyle}>
          {[...WIZARD_AGENT_OPTIONS, "none"].map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </Field>
    </div>
  );
}
