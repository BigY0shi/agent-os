"use client";

import { useEffect, useState } from "react";
import ConfigMenu, { useSettings, Field, TextInput, SaveBar } from "./ConfigMenu";
import { isMaskedSecret } from "@/lib/settingsRedact";

const ACCENT = "#6CA8FF";

// Ollama settings (S30; owner 2026-09-30: "every parameter needs to be in the settings").
// One block, settings.ollama, shared by every module that talks to Ollama: this page, the
// Room, Brainstorm, the Loop judge, Memory, Agents and Free Claude Code. The key is write-only:
// it comes back masked (first 5 characters + ********) and a save of the mask keeps the stored
// key. Settings win over the environment; a blank field falls back to the env var named in
// its hint, then the default. Read per request (lib/ollamaCloud.ts), no rebuild, no restart.
export default function OllamaSettings() {
  const { settings, saving, save } = useSettings();
  const [apiKey, setApiKey] = useState("");
  const [host, setHost] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [localUrl, setLocalUrl] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    const o = (settings.ollama || {}) as { apiKey?: string; host?: string; defaultModel?: string; localUrl?: string };
    setApiKey(o.apiKey || "");
    setHost(o.host || "");
    setDefaultModel(o.defaultModel || "");
    setLocalUrl(o.localUrl || "");
  }, [settings]);

  async function onSave() {
    await save({ ollama: { apiKey: apiKey.trim(), host: host.trim(), defaultModel: defaultModel.trim(), localUrl: localUrl.trim() } });
    setSaved(true); setTimeout(() => setSaved(false), 1800);
  }

  return (
    <ConfigMenu title="Ollama settings" accent={ACCENT} buttonLabel="Configure">
      <p className="text-[11.5px] mb-4" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        Shared by every module that uses Ollama: this page, the Room, Brainstorm, the Loop judge, Memory, Agents and Free Claude Code. A saved value wins over the environment variable; blank falls back to it.
      </p>
      <Field label="Ollama Cloud key" hint="Your ollama.com API key. Stored write-only: shown as its first 5 characters + ********, never returned in full. Blank = OLLAMA_API_KEY (or OLLAMA_CLOUD_KEY) from the environment.">
        <TextInput type={isMaskedSecret(apiKey) ? "text" : "password"} placeholder="paste your Ollama Cloud key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" />
      </Field>
      <Field label="Ollama Cloud host" hint="Blank = OLLAMA_CLOUD_HOST, else https://ollama.com.">
        <TextInput placeholder="https://ollama.com" value={host} onChange={(e) => setHost(e.target.value)} />
      </Field>
      <Field label="Default model" hint="Used when a page sends no model: this chat (else qwen3-coder:480b) and a Room agent set to auto when none of its preferences match (else your account's first model). Blank = OLLAMA_CLOUD_MODEL.">
        <TextInput placeholder="e.g. qwen3-coder:480b" value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} />
      </Field>
      <Field label="Local Ollama URL" hint="The local daemon for Memory (ollama-local), the Agents ollama provider and Free Claude Code. Blank = OLLAMA_URL, else http://127.0.0.1:11434. Pipeline has its own URL in its gear.">
        <TextInput placeholder="http://127.0.0.1:11434" value={localUrl} onChange={(e) => setLocalUrl(e.target.value)} />
      </Field>
      <SaveBar saving={saving} saved={saved} onSave={onSave} accent={ACCENT} />
      <p className="text-[10.5px] mt-3 leading-relaxed" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        Takes effect on the next call. No rebuild or restart.
      </p>
    </ConfigMenu>
  );
}
