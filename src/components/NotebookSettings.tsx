"use client";

import { useEffect, useState } from "react";
import ConfigMenu, { useSettings, Field, TextInput, SaveBar } from "./ConfigMenu";

const ACCENT = "#fde047";

// Notebook (NotebookLM) connection config. Point the dashboard at YOUR notebooklm-mcp
// install + default notebook. No API key — NotebookLM auths via your own `nlm login`.
export default function NotebookSettings() {
  const { settings, saving, save } = useSettings();
  const [nlmBin, setNlmBin] = useState("");
  const [notebookId, setNotebookId] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    const n = settings.notebook || {};
    setNlmBin(n.nlmBin || ""); setNotebookId(n.notebookId || "");
  }, [settings]);

  async function onSave() {
    await save({ notebook: { nlmBin: nlmBin.trim(), notebookId: notebookId.trim() } });
    setSaved(true); setTimeout(() => setSaved(false), 1800);
  }

  return (
    <ConfigMenu title="Notebook settings" accent={ACCENT} buttonLabel="Configure">
      <p className="text-[11.5px] mb-4" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        Connect the dashboard to your NotebookLM. Auth is via your own <span className="mono">nlm login</span> — no API key.
      </p>
      <Field label="notebooklm-mcp binary" hint="Override the auto-detected path if needed. Takes effect after a restart.">
        <TextInput placeholder="e.g. notebooklm-mcp  or  full path" value={nlmBin} onChange={(e) => setNlmBin(e.target.value)} />
      </Field>
      <Field label="Default notebook ID" hint="Optional — the notebook to open by default.">
        <TextInput placeholder="notebook id" value={notebookId} onChange={(e) => setNotebookId(e.target.value)} />
      </Field>
      <SaveBar saving={saving} saved={saved} onSave={onSave} accent={ACCENT} />
    </ConfigMenu>
  );
}
