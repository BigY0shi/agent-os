"use client";

import { useEffect, useState } from "react";
import ConfigMenu, { useSettings, Field, SaveBar, TextInput } from "./ConfigMenu";
import AgentPicker from "./AgentPicker";

const ACCENT = "#fb7185";

// Thumbnails config — generate on a CLI agent's image skill/MCP (no API key) instead of
// OpenAI gpt-image-2. The CLI path is the default per the user's choice.
export default function ThumbnailSettings() {
  const { settings, saving, save } = useSettings();
  const [backend, setBackend] = useState<"cli" | "gpt-image">("cli");
  const [agent, setAgent] = useState("claude");
  const [promptModel, setPromptModel] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    const t = (settings.thumbnails || {}) as { backend?: string; agent?: string; promptModel?: string };
    setBackend(t.backend === "gpt-image" ? "gpt-image" : "cli");
    setAgent(t.agent || "claude");
    setPromptModel(t.promptModel || "");
  }, [settings]);

  async function onSave() {
    await save({ thumbnails: { backend, agent, promptModel: promptModel.trim() } });
    setSaved(true); setTimeout(() => setSaved(false), 1800);
  }

  return (
    <ConfigMenu title="Thumbnails settings" accent={ACCENT} buttonLabel="Configure">
      <p className="text-[11.5px] mb-4" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        Generate thumbnails on your own backend. The CLI-agent path uses your subscription (no API key).
      </p>
      <Field label="Backend">
        <div className="flex gap-2">
          {([["cli", "CLI agent (image skill)"], ["gpt-image", "OpenAI gpt-image-2"]] as const).map(([b, l]) => (
            <button key={b} onClick={() => setBackend(b)}
              className="px-3 h-8 rounded-lg text-[12px] font-medium transition"
              style={backend === b
                ? { background: `${ACCENT}22`, border: `1px solid ${ACCENT}`, color: "var(--fg, #e8e2f0)" }
                : { border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}>
              {l}
            </button>
          ))}
        </div>
      </Field>
      {backend === "cli" ? (
        <Field label="Image agent" hint="The CLI agent that generates thumbnails via its image MCP/skill (e.g. Higgsfield).">
          <AgentPicker value={agent} onChange={setAgent} kinds={["cli"]} accent={ACCENT} />
        </Field>
      ) : (
        <p className="text-[11px] mb-3" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
          Uses OpenAI gpt-image-2 — needs <span className="mono">OPENAI_API_KEY</span> in <span className="mono">~/.claude/skills/youtube-thumbnails/.env</span>. (The one API-key path; CLI is the no-key default.)
        </p>
      )}
      <Field label="Prompt model (OpenAI)" hint="The chat model that reads the reference image and writes the image prompt (lib/thumbnailPrompt.ts). Blank = gpt-4o-mini. Needs the same OPENAI_API_KEY.">
        <TextInput value={promptModel} placeholder="gpt-4o-mini" onChange={(e) => setPromptModel(e.target.value)} />
      </Field>
      <SaveBar saving={saving} saved={saved} onSave={onSave} accent={ACCENT} />
    </ConfigMenu>
  );
}
