"use client";

import { useEffect, useState } from "react";
import ConfigMenu, { useSettings, Field, TextInput, SaveBar } from "./ConfigMenu";
import AgentPicker from "./AgentPicker";

const ACCENT = "#ef4444";

// Video labs config — point b-roll generation at YOUR backends instead of grok/minimax:
//   • Eidolon LTX/WAN Studio (your Pinokio app) via its local endpoint
//   • a CLI agent driving generation through its Higgsfield skill/MCP (no API key)
export default function VideoSettings() {
  const { settings, saving, save } = useSettings();
  const [backend, setBackend] = useState<"eidolon" | "cli">("eidolon");
  const [model, setModel] = useState<"ltx" | "wan">("ltx");
  const [eidolonUrl, setEidolonUrl] = useState("");
  const [comfyUrl, setComfyUrl] = useState("");
  const [agent, setAgent] = useState("claude");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    const v = settings.video || {};
    setBackend(v.backend === "cli" ? "cli" : "eidolon");
    setModel(v.model === "wan" ? "wan" : "ltx");
    setEidolonUrl(v.eidolonUrl || "");
    setComfyUrl(v.comfyUrl || "http://127.0.0.1:8188");
    setAgent(v.agent || "claude");
  }, [settings]);

  async function onSave() {
    await save({ video: { backend, model, eidolonUrl: eidolonUrl.trim(), comfyUrl: comfyUrl.trim(), agent } });
    setSaved(true); setTimeout(() => setSaved(false), 1800);
  }

  return (
    <ConfigMenu title="Video labs settings" accent={ACCENT} buttonLabel="Configure">
      <p className="text-[11.5px] mb-4" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        Generate b-roll with your own backends — no API keys (except the local labs you run yourself).
      </p>

      <Field label="Backend">
        <div className="flex gap-2">
          {([["eidolon", "Eidolon LTX/WAN"], ["cli", "CLI agent + Higgsfield"]] as const).map(([b, l]) => (
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

      {backend === "eidolon" ? (
        <>
          <Field label="Model">
            <div className="flex gap-2">
              {([["ltx", "LTX-Video"], ["wan", "WAN"]] as const).map(([m, l]) => (
                <button key={m} onClick={() => setModel(m)}
                  className="px-3 h-8 rounded-lg text-[12px] font-medium transition"
                  style={model === m
                    ? { background: `${ACCENT}22`, border: `1px solid ${ACCENT}`, color: "var(--fg, #e8e2f0)" }
                    : { border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}>
                  {l}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Eidolon Studio endpoint" hint="Your Pinokio Eidolon LTX/WAN app's local URL (Gradio/API).">
            <TextInput placeholder="http://127.0.0.1:7860" value={eidolonUrl} onChange={(e) => setEidolonUrl(e.target.value)} />
          </Field>
          <Field label="ComfyUI endpoint" hint="Optional — direct ComfyUI API, if you run LTX/WAN there.">
            <TextInput placeholder="http://127.0.0.1:8188" value={comfyUrl} onChange={(e) => setComfyUrl(e.target.value)} />
          </Field>
        </>
      ) : (
        <Field label="CLI agent" hint="The agent that drives generation via its Higgsfield skill/MCP.">
          <AgentPicker value={agent} onChange={setAgent} kinds={["cli"]} accent={ACCENT} />
        </Field>
      )}

      <SaveBar saving={saving} saved={saved} onSave={onSave} accent={ACCENT} />
    </ConfigMenu>
  );
}
